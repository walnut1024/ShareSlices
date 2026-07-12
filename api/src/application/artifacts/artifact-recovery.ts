import { createHash, randomUUID } from "node:crypto";
import type { ArtifactAccepted } from "./artifact-intake.js";
import type { ArtifactRepositories, UploadPolicySnapshot } from "./repositories.js";
import type { ObjectBody, ObjectStorage } from "../../storage/index.js";

type RecoveryRepositories = Pick<
  ArtifactRepositories,
  "artifacts" | "shareLinks" | "uploadSessions" | "idempotency" | "recovery"
>;

type ArtifactRecoveryOptions = {
  repositories: RecoveryRepositories;
  storage: ObjectStorage;
  viewerOrigin: string;
  maxProcessingAttempts: number;
};

export type ArtifactRecoveryErrorCode =
  | "artifact_not_found"
  | "upload_session_not_found"
  | "invalid_artifact_state"
  | "invalid_idempotency_key"
  | "operation_in_progress"
  | "idempotency_conflict"
  | "invalid_requested_entry"
  | "archive_too_large";

export class ArtifactRecoveryError extends Error {
  constructor(readonly code: ArtifactRecoveryErrorCode) {
    super(code);
    this.name = "ArtifactRecoveryError";
  }
}

type RetryInput = {
  ownerUserId: string;
  uploadSessionId: string;
  idempotencyKey: string;
};

type ReplaceInput = {
  ownerUserId: string;
  artifactId: string;
  idempotencyKey: string;
  body: ObjectBody;
  policy: UploadPolicySnapshot;
  requestedEntry?: string | null | Promise<string | null>;
  completed?: Promise<void>;
};

function validateKey(key: string): void {
  if (key.trim().length < 1 || key.length > 255) {
    throw new ArtifactRecoveryError("invalid_idempotency_key");
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRequestedEntry(value: string | null): string | null {
  if (value === null) return null;
  const entry = value.trim();
  if (!entry || entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((part) => !part || part === "..")) {
    throw new ArtifactRecoveryError("invalid_requested_entry");
  }
  return entry;
}

async function hashBody(body: ObjectBody, maxBytes: number): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of body) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxBytes) {
      throw new ArtifactRecoveryError("archive_too_large");
    }
    digest.update(chunk);
  }
  return { sizeBytes, sha256: digest.digest("hex") };
}

function acceptedResponse(value: Record<string, unknown> | null): ArtifactAccepted {
  if (!value) {
    throw new Error("Completed idempotency record has no response body.");
  }
  return value as ArtifactAccepted;
}

async function discardRaw(storage: ObjectStorage, key: string): Promise<void> {
  await storage.deleteObject(key).catch(() => undefined);
}

export class ArtifactRecoveryService {
  readonly #repositories: RecoveryRepositories;
  readonly #storage: ObjectStorage;
  readonly #viewerOrigin: string;
  readonly #maxProcessingAttempts: number;

  constructor(options: ArtifactRecoveryOptions) {
    this.#repositories = options.repositories;
    this.#storage = options.storage;
    this.#viewerOrigin = options.viewerOrigin;
    this.#maxProcessingAttempts = options.maxProcessingAttempts;
  }

  async retry(input: RetryInput): Promise<ArtifactAccepted> {
    validateKey(input.idempotencyKey);
    const session = await this.#repositories.uploadSessions.findOwned(
      input.ownerUserId,
      input.uploadSessionId
    );
    if (!session) {
      throw new ArtifactRecoveryError("upload_session_not_found");
    }
    if (
      session.state !== "failed" ||
      !session.retryable ||
      session.supersededAt ||
      (await this.#repositories.artifacts.hasReadyVersion(session.artifactId))
    ) {
      throw new ArtifactRecoveryError("invalid_artifact_state");
    }
    const shareLink = await this.#repositories.shareLinks.findActiveByArtifact(session.artifactId);
    if (!shareLink) {
      throw new Error("Artifact has no active Share link.");
    }

    const requestHash = hash(`retry:${input.uploadSessionId}`);
    const claim = await this.#repositories.idempotency.claimPending({
      id: `idem_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: input.ownerUserId,
      operation: "retry_upload",
      targetResourceId: input.uploadSessionId,
      key: input.idempotencyKey,
      provisionalRequestHash: requestHash
    });
    if (claim.kind === "existing") {
      if (claim.record.state === "pending") {
        throw new ArtifactRecoveryError("operation_in_progress");
      }
      if (claim.record.requestHash !== requestHash) {
        throw new ArtifactRecoveryError("idempotency_conflict");
      }
      return acceptedResponse(claim.record.responseBody);
    }

    const response = this.#response(session.artifactId, session.id, shareLink.slug);
    try {
      await this.#repositories.recovery.queueManualRetry({
        uploadSessionId: session.id,
        processingJobId: `job_${randomUUID().replaceAll("-", "")}`,
        maxAttempts: this.#maxProcessingAttempts,
        idempotencyRecordId: claim.record.id,
        requestHash,
        responseStatus: 202,
        responseBody: response
      });
      return response;
    } catch (error) {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw error;
    }
  }

  async replace(input: ReplaceInput): Promise<ArtifactAccepted> {
    validateKey(input.idempotencyKey);
    const artifact = await this.#repositories.artifacts.findOwned(input.ownerUserId, input.artifactId);
    if (!artifact) {
      throw new ArtifactRecoveryError("artifact_not_found");
    }
    const current = await this.#repositories.uploadSessions.findCurrent(input.artifactId);
    const hasReadyVersion = await this.#repositories.artifacts.hasReadyVersion(input.artifactId);
    const replacesFailedInput =
      !hasReadyVersion &&
      current?.state === "failed" &&
      !current.retryable &&
      !current.supersededAt;
    const createsVersion = hasReadyVersion && current?.state === "committed";
    if (!current || (!replacesFailedInput && !createsVersion)) {
      throw new ArtifactRecoveryError("invalid_artifact_state");
    }
    const shareLink = await this.#repositories.shareLinks.findActiveByArtifact(input.artifactId);
    if (!shareLink) {
      throw new Error("Artifact has no active Share link.");
    }

    const requestPrefix = `${createsVersion ? "version" : "replace"}:${input.artifactId}`;
    const requestedEntry = Promise.resolve(input.requestedEntry ?? null).then(normalizeRequestedEntry);
    const claim = await this.#repositories.idempotency.claimPending({
      id: `idem_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: input.ownerUserId,
      operation: createsVersion ? "upload_version" : "replace_upload",
      targetResourceId: input.artifactId,
      key: input.idempotencyKey,
      provisionalRequestHash: hash(requestPrefix)
    });
    if (claim.kind === "existing") {
      if (claim.record.state === "pending") {
        throw new ArtifactRecoveryError("operation_in_progress");
      }
      const [replay, , replayEntry] = await Promise.all([
        hashBody(input.body, input.policy.archiveSizeBytes),
        input.completed ?? Promise.resolve(),
        requestedEntry
      ]);
      if (
        claim.record.requestHash !==
        hash(`${requestPrefix}:${replay.sha256}:${replayEntry ?? ""}`)
      ) {
        throw new ArtifactRecoveryError("idempotency_conflict");
      }
      return acceptedResponse(claim.record.responseBody);
    }

    const uploadSessionId = `upload_${randomUUID().replaceAll("-", "")}`;
    const rawObjectKey = `raw/${input.artifactId}/${uploadSessionId}.zip`;
    const [rawResult, completedResult, entryResult] = await Promise.allSettled([
      this.#storage.writeRawZip({
        key: rawObjectKey,
        body: input.body,
        contentType: "application/zip"
      }),
      input.completed ?? Promise.resolve(),
      requestedEntry
    ]);
    if (rawResult.status === "rejected") {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw rawResult.reason;
    }
    if (completedResult.status === "rejected") {
      await discardRaw(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw completedResult.reason;
    }
    if (entryResult.status === "rejected") {
      await discardRaw(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw entryResult.reason;
    }
    if (rawResult.value.sizeBytes > input.policy.archiveSizeBytes) {
      await discardRaw(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw new ArtifactRecoveryError("archive_too_large");
    }

    const response = this.#response(input.artifactId, uploadSessionId, shareLink.slug);
    try {
      const commit = {
        artifactId: input.artifactId,
        uploadSessionId,
        policy: input.policy,
        rawObjectKey,
        rawSha256: rawResult.value.sha256,
        rawSizeBytes: rawResult.value.sizeBytes,
        requestedEntry: entryResult.value,
        processingJobId: `job_${randomUUID().replaceAll("-", "")}`,
        maxAttempts: this.#maxProcessingAttempts,
        idempotencyRecordId: claim.record.id,
        requestHash: hash(`${requestPrefix}:${rawResult.value.sha256}:${entryResult.value ?? ""}`),
        responseStatus: 202,
        responseBody: response
      };
      if (createsVersion) {
        await this.#repositories.recovery.commitVersionUpload(commit);
      } else {
        await this.#repositories.recovery.commitReplacement({ ...commit, previousUploadSessionId: current.id });
      }
      return response;
    } catch (error) {
      await discardRaw(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw error;
    }
  }

  #response(artifactId: string, uploadSessionId: string, shareSlug: string): ArtifactAccepted {
    return {
      artifactId,
      uploadSessionId,
      processingState: "accepted",
      shareLink: {
        url: new URL(`/a/${shareSlug}/`, this.#viewerOrigin).toString(),
        state: "active"
      }
    };
  }
}
