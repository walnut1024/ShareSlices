import { createHash, randomUUID } from "node:crypto";
import type { ArtifactRepositories, UploadPolicySnapshot } from "./repositories.js";
import type { ObjectBody, ObjectStorage } from "../../storage/index.js";
import {
  discardUncommittedRawObject,
  hashUploadBody,
  normalizeRequestedEntry,
  RequestedEntryValidationError
} from "./artifact-upload-input.js";
import type { RawFingerprintCandidates } from "./raw-fingerprint.js";

export type ArtifactAccepted = {
  artifactId: string;
  uploadSessionId: string;
  processingState: "accepted";
};

export type CreateArtifactInput = {
  ownerUserId: string;
  idempotencyKey: string;
  name: string | Promise<string>;
  requestedEntry?: string | null | Promise<string | null>;
  body: ObjectBody;
  policy: UploadPolicySnapshot;
  completed?: Promise<void>;
};

type IntakeRepositories = Pick<ArtifactRepositories, "idempotency" | "intake">;

type ArtifactIntakeOptions = {
  repositories: IntakeRepositories;
  storage: ObjectStorage;
  viewerOrigin: string;
  maxProcessingAttempts: number;
  rawFingerprints: RawFingerprintCandidates;
  processingRevision: string;
  contentIdentityRevision: string;
};

export type ArtifactIntakeErrorCode =
  | "invalid_artifact_name"
  | "invalid_requested_entry"
  | "invalid_idempotency_key"
  | "operation_in_progress"
  | "idempotency_conflict"
  | "archive_too_large";

const errorMessages: Record<ArtifactIntakeErrorCode, string> = {
  invalid_artifact_name: "Artifact name must contain 1 to 120 characters.",
  invalid_requested_entry: "Entry must be a safe archive-relative path.",
  invalid_idempotency_key: "Idempotency key is required.",
  operation_in_progress: "Operation is still in progress.",
  idempotency_conflict: "Idempotency key was used with different input.",
  archive_too_large: "ZIP exceeds the upload limit."
};

export class ArtifactIntakeError extends Error {
  constructor(readonly code: ArtifactIntakeErrorCode) {
    super(errorMessages[code]);
    this.name = "ArtifactIntakeError";
  }
}

function artifactName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new ArtifactIntakeError("invalid_artifact_name");
  }
  return name;
}

function intakeRequestedEntry(value: string | null): string | null {
  try {
    return normalizeRequestedEntry(value);
  } catch (error) {
    if (error instanceof RequestedEntryValidationError) {
      throw new ArtifactIntakeError("invalid_requested_entry");
    }
    throw error;
  }
}

function completedResponse(value: Record<string, unknown> | null): ArtifactAccepted {
  if (!value) {
    throw new Error("Completed idempotency record has no response body.");
  }
  return value as ArtifactAccepted;
}

export class ArtifactIntakeService {
  readonly #repositories: IntakeRepositories;
  readonly #storage: ObjectStorage;
  readonly #maxProcessingAttempts: number;
  readonly #rawFingerprints: RawFingerprintCandidates;
  readonly #processingRevision: string;
  readonly #contentIdentityRevision: string;

  constructor(options: ArtifactIntakeOptions) {
    this.#repositories = options.repositories;
    this.#storage = options.storage;
    this.#maxProcessingAttempts = options.maxProcessingAttempts;
    this.#rawFingerprints = options.rawFingerprints;
    this.#processingRevision = options.processingRevision;
    this.#contentIdentityRevision = options.contentIdentityRevision;
  }

  static inputHash(name: string, zipSha256: string, requestedEntry: string | null = null): string {
    return createHash("sha256").update(JSON.stringify([name, zipSha256, requestedEntry])).digest("hex");
  }

  async create(input: CreateArtifactInput): Promise<ArtifactAccepted> {
    const immediateName = typeof input.name === "string" ? artifactName(input.name) : undefined;
    const namePromise = immediateName ? Promise.resolve(immediateName) : Promise.resolve(input.name).then(artifactName);
    const entryPromise = Promise.resolve(input.requestedEntry ?? null).then(intakeRequestedEntry);
    void namePromise.catch(() => undefined);
    if (input.idempotencyKey.trim().length < 1 || input.idempotencyKey.length > 255) {
      throw new ArtifactIntakeError("invalid_idempotency_key");
    }

    const policy = input.policy;

    const idempotencyRecordId = `idem_${randomUUID().replaceAll("-", "")}`;
    const claim = await this.#repositories.idempotency.claimPending({
      id: idempotencyRecordId,
      ownerUserId: input.ownerUserId,
      operation: "create_artifact",
      targetResourceId: null,
      key: input.idempotencyKey,
      provisionalRequestHash: createHash("sha256").update(immediateName ?? "pending_name").digest("hex")
    });

    if (claim.kind === "existing") {
      if (claim.record.state === "pending") {
        throw new ArtifactIntakeError("operation_in_progress");
      }
      const [name, replay, requestedEntry] = await Promise.all([
        namePromise,
        hashUploadBody(input.body, policy.archiveSizeBytes, () => new ArtifactIntakeError("archive_too_large")),
        entryPromise
      ]);
      await input.completed;
      if (claim.record.requestHash !== ArtifactIntakeService.inputHash(name, replay.sha256, requestedEntry)) {
        throw new ArtifactIntakeError("idempotency_conflict");
      }
      return completedResponse(claim.record.responseBody);
    }

    const artifactId = `artifact_${randomUUID().replaceAll("-", "")}`;
    const uploadSessionId = `upload_${randomUUID().replaceAll("-", "")}`;
    const processingJobId = `job_${randomUUID().replaceAll("-", "")}`;
    const rawObjectKey = `raw/${artifactId}/${uploadSessionId}.zip`;

    const uploadResult = this.#storage.writeRawZip({
      key: rawObjectKey,
      body: input.body,
      contentType: "application/zip"
    });
    const [nameResult, rawResult, entryResult] = await Promise.allSettled([namePromise, uploadResult, entryPromise]);
    if (nameResult.status === "rejected") {
      if (rawResult.status === "fulfilled") {
        await discardUncommittedRawObject(this.#storage, rawObjectKey);
      }
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw nameResult.reason;
    }
    if (rawResult.status === "rejected") {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw rawResult.reason;
    }
    if (entryResult.status === "rejected") {
      await discardUncommittedRawObject(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw entryResult.reason;
    }
    const name = nameResult.value;
    const raw = rawResult.value;
    const requestedEntry = entryResult.value;
    try {
      await input.completed;
      if (raw.sizeBytes > policy.archiveSizeBytes) {
        throw new ArtifactIntakeError("archive_too_large");
      }
    } catch (error) {
      await discardUncommittedRawObject(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw error;
    }

    const requestHash = ArtifactIntakeService.inputHash(name, raw.sha256, requestedEntry);
    const response: ArtifactAccepted = { artifactId, uploadSessionId, processingState: "accepted" };
    try {
      await this.#repositories.intake.commitAccepted({
        artifactId,
        ownerUserId: input.ownerUserId,
        name,
        uploadSessionId,
        policy,
        rawObjectKey,
        rawFingerprintCandidates: this.#rawFingerprints.create(input.ownerUserId, raw.sha256),
        processingRevision: this.#processingRevision,
        contentIdentityRevision: this.#contentIdentityRevision,
        rawSizeBytes: raw.sizeBytes,
        requestedEntry,
        processingJobId,
        maxAttempts: this.#maxProcessingAttempts,
        idempotencyRecordId: claim.record.id,
        requestHash,
        responseStatus: 202,
        responseBody: response
      });
      return response;
    } catch (error) {
      await discardUncommittedRawObject(this.#storage, rawObjectKey);
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw error;
    }
  }
}
