import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ArtifactRecoveryError, ArtifactRecoveryService } from "../src/application/artifacts/artifact-recovery.js";
import type {
  ArtifactRepositories,
  ClaimIdempotencyInput,
  IdempotencyRecord,
  UploadPolicySnapshot
} from "../src/application/artifacts/repositories.js";
import { InMemoryObjectStorage } from "../src/storage/index.js";

const policy: UploadPolicySnapshot = {
  revision: "v0.0.1-default",
  archiveSizeBytes: 52_428_800,
  expandedSizeBytes: 209_715_200,
  fileCount: 1000,
  singleFileSizeBytes: 52_428_800,
  formats: [{ extension: ".html", contentType: "text/html", validationKind: "utf8_text" }]
};

async function* body(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value);
}

function harness(options: { retryable?: boolean; ready?: boolean; existing?: IdempotencyRecord } = {}) {
  const records = new Map<string, IdempotencyRecord>();
  if (options.existing) {
    records.set(options.existing.key, options.existing);
  }
  const queueManualRetry = vi.fn();
  const commitReplacement = vi.fn();
  const repositories = {
    artifacts: {
      listOwned: vi.fn(),
      findOwned: vi.fn().mockResolvedValue({
        id: "artifact-1",
        ownerUserId: "owner-1",
        name: "Report",
        createdAt: new Date(),
        updatedAt: new Date()
      }),
      updateName: vi.fn(),
      hasReadyVersion: vi.fn().mockResolvedValue(options.ready ?? false)
    },
    shareLinks: {
      findActiveByArtifact: vi.fn().mockResolvedValue({
        id: "link-1",
        artifactId: "artifact-1",
        slug: "share-slug-0000000001",
        status: "active",
        retiredAt: null,
        expiresAt: null
      }),
      findBySlug: vi.fn()
    },
    uploadSessions: {
      findOwned: vi.fn().mockResolvedValue({
        id: "upload-1",
        artifactId: "artifact-1",
        state: "failed",
        retryable: options.retryable ?? true,
        rawObjectKey: "raw/artifact-1/upload-1.zip",
        rawSha256: "a".repeat(64),
        failureReasonCode: "object_store_timeout",
        failureSummary: "Processing failed.",
        supersededAt: null
      }),
      findCurrent: vi.fn().mockImplementation(async () => ({
        id: "upload-1",
        artifactId: "artifact-1",
        state: "failed",
        retryable: options.retryable ?? false,
        rawObjectKey: "raw/artifact-1/upload-1.zip",
        rawSha256: "a".repeat(64),
        failureReasonCode: "invalid_zip",
        failureSummary: "Replace the file.",
        supersededAt: null
      }))
    },
    idempotency: {
      find: vi.fn(),
      claimPending: vi.fn(async (input: ClaimIdempotencyInput) => {
        const found = records.get(input.key);
        if (found) {
          return { kind: "existing" as const, record: found };
        }
        const record: IdempotencyRecord = {
          id: input.id,
          ownerUserId: input.ownerUserId,
          operation: input.operation,
          targetResourceId: input.targetResourceId,
          key: input.key,
          requestHash: input.provisionalRequestHash,
          state: "pending",
          responseStatus: null,
          responseBody: null
        };
        records.set(input.key, record);
        return { kind: "acquired" as const, record };
      }),
      releasePending: vi.fn()
    },
    recovery: { queueManualRetry, commitReplacement }
  } as unknown as Pick<
    ArtifactRepositories,
    "artifacts" | "shareLinks" | "uploadSessions" | "idempotency" | "recovery"
  >;
  const storage = new InMemoryObjectStorage();
  return {
    repositories,
    storage,
    queueManualRetry,
    commitReplacement,
    service: new ArtifactRecoveryService({
      repositories,
      storage,
      viewerOrigin: "http://127.0.0.1:7456",
      maxProcessingAttempts: 3
    })
  };
}

describe("ArtifactRecoveryService", () => {
  it("queues manual Retry against the retained Upload session", async () => {
    const { service, queueManualRetry } = harness({ retryable: true });

    const result = await service.retry({
      ownerUserId: "owner-1",
      uploadSessionId: "upload-1",
      idempotencyKey: "retry-key"
    });

    expect(result).toMatchObject({ artifactId: "artifact-1", uploadSessionId: "upload-1" });
    expect(queueManualRetry).toHaveBeenCalledWith(
      expect.objectContaining({ uploadSessionId: "upload-1", maxAttempts: 3 })
    );
  });

  it("rejects Retry when retained input is deterministic or a ready Version exists", async () => {
    const deterministic = harness({ retryable: false });
    await expect(
      deterministic.service.retry({ ownerUserId: "owner-1", uploadSessionId: "upload-1", idempotencyKey: "retry-key" })
    ).rejects.toEqual(new ArtifactRecoveryError("invalid_artifact_state"));

    const ready = harness({ retryable: true, ready: true });
    await expect(
      ready.service.retry({ ownerUserId: "owner-1", uploadSessionId: "upload-1", idempotencyKey: "retry-key" })
    ).rejects.toEqual(new ArtifactRecoveryError("invalid_artifact_state"));
  });

  it("stores and commits a replacement under a new Upload session snapshot", async () => {
    const { service, storage, commitReplacement } = harness({ retryable: false });

    const result = await service.replace({
      ownerUserId: "owner-1",
      artifactId: "artifact-1",
      idempotencyKey: "replace-key",
      body: body("replacement-zip"),
      policy,
      completed: Promise.resolve()
    });

    expect(result.artifactId).toBe("artifact-1");
    expect(result.uploadSessionId).not.toBe("upload-1");
    const committed = commitReplacement.mock.calls[0]?.[0];
    expect(committed).toMatchObject({
      artifactId: "artifact-1",
      previousUploadSessionId: "upload-1",
      rawSha256: createHash("sha256").update("replacement-zip").digest("hex")
    });
    expect(await storage.readForTest(committed.rawObjectKey)).toEqual(Buffer.from("replacement-zip"));
  });

  it("rejects Replace when a ready Version already exists", async () => {
    const { service, commitReplacement } = harness({ retryable: false, ready: true });

    await expect(
      service.replace({
        ownerUserId: "owner-1",
        artifactId: "artifact-1",
        idempotencyKey: "replace-key",
        body: body("replacement-zip"),
        policy
      })
    ).rejects.toEqual(new ArtifactRecoveryError("invalid_artifact_state"));
    expect(commitReplacement).not.toHaveBeenCalled();
  });
});
