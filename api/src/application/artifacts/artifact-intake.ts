import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ArtifactRepositories, UploadPolicySnapshot } from "./repositories.js";
import type { ObjectBody, ObjectStorage } from "../../storage/index.js";

export type ArtifactAccepted = {
  artifactId: string;
  uploadSessionId: string;
  processingState: "accepted";
  shareLink: {
    url: string;
    state: "active";
  };
};

export type CreateArtifactInput = {
  ownerUserId: string;
  idempotencyKey: string;
  name: string | Promise<string>;
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
};

export type ArtifactIntakeErrorCode =
  | "invalid_artifact_name"
  | "invalid_idempotency_key"
  | "operation_in_progress"
  | "idempotency_conflict"
  | "archive_too_large";

const errorMessages: Record<ArtifactIntakeErrorCode, string> = {
  invalid_artifact_name: "Artifact name must contain 1 to 120 characters.",
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

async function hashBody(body: ObjectBody, maxBytes: number): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of body) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxBytes) {
      throw new ArtifactIntakeError("archive_too_large");
    }
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

function artifactName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120) {
    throw new ArtifactIntakeError("invalid_artifact_name");
  }
  return name;
}

function completedResponse(value: Record<string, unknown> | null): ArtifactAccepted {
  if (!value) {
    throw new Error("Completed idempotency record has no response body.");
  }
  return value as ArtifactAccepted;
}

function shareSlugCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "artifact_share_link_slug_key"
  );
}

export class ArtifactIntakeService {
  readonly #repositories: IntakeRepositories;
  readonly #storage: ObjectStorage;
  readonly #viewerOrigin: string;
  readonly #maxProcessingAttempts: number;

  constructor(options: ArtifactIntakeOptions) {
    this.#repositories = options.repositories;
    this.#storage = options.storage;
    this.#viewerOrigin = options.viewerOrigin;
    this.#maxProcessingAttempts = options.maxProcessingAttempts;
  }

  static inputHash(name: string, zipSha256: string): string {
    return createHash("sha256").update(JSON.stringify([name, zipSha256])).digest("hex");
  }

  async create(input: CreateArtifactInput): Promise<ArtifactAccepted> {
    const immediateName = typeof input.name === "string" ? artifactName(input.name) : undefined;
    const namePromise = immediateName ? Promise.resolve(immediateName) : Promise.resolve(input.name).then(artifactName);
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
      const [name, replay] = await Promise.all([
        namePromise,
        hashBody(input.body, policy.archiveSizeBytes),
        input.completed ?? Promise.resolve()
      ]);
      if (claim.record.requestHash !== ArtifactIntakeService.inputHash(name, replay.sha256)) {
        throw new ArtifactIntakeError("idempotency_conflict");
      }
      return completedResponse(claim.record.responseBody);
    }

    const artifactId = `artifact_${randomUUID().replaceAll("-", "")}`;
    const uploadSessionId = `upload_${randomUUID().replaceAll("-", "")}`;
    const processingJobId = `job_${randomUUID().replaceAll("-", "")}`;
    const shareLinkId = `link_${randomUUID().replaceAll("-", "")}`;
    const rawObjectKey = `raw/${artifactId}/${uploadSessionId}.zip`;

    const uploadResult = this.#storage.writeRawZip({
        key: rawObjectKey,
        body: input.body,
        contentType: "application/zip"
      });
    const [nameResult, rawResult] = await Promise.allSettled([namePromise, uploadResult]);
    if (nameResult.status === "rejected") {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw nameResult.reason;
    }
    if (rawResult.status === "rejected") {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw rawResult.reason;
    }
    const name = nameResult.value;
    const raw = rawResult.value;
    try {
      await input.completed;
      if (raw.sizeBytes > policy.archiveSizeBytes) {
        throw new ArtifactIntakeError("archive_too_large");
      }
    } catch (error) {
      await this.#repositories.idempotency.releasePending(claim.record.id);
      throw error;
    }

    const requestHash = ArtifactIntakeService.inputHash(name, raw.sha256);
    for (let slugAttempt = 0; slugAttempt < 3; slugAttempt += 1) {
      const shareSlug = randomBytes(16).toString("base64url");
      const response: ArtifactAccepted = {
        artifactId,
        uploadSessionId,
        processingState: "accepted",
        shareLink: {
          url: new URL(`/a/${shareSlug}/`, this.#viewerOrigin).toString(),
          state: "active"
        }
      };

      try {
        await this.#repositories.intake.commitAccepted({
          artifactId,
          ownerUserId: input.ownerUserId,
          name,
          shareLinkId,
          shareSlug,
          uploadSessionId,
          policy,
          rawObjectKey,
          rawSha256: raw.sha256,
          rawSizeBytes: raw.sizeBytes,
          processingJobId,
          maxAttempts: this.#maxProcessingAttempts,
          idempotencyRecordId: claim.record.id,
          requestHash,
          responseStatus: 202,
          responseBody: response
        });
        return response;
      } catch (error) {
        if (slugAttempt < 2 && shareSlugCollision(error)) {
          continue;
        }
        await this.#repositories.idempotency.releasePending(claim.record.id);
        throw error;
      }
    }

    throw new Error("Share slug retry loop ended unexpectedly.");
  }
}
