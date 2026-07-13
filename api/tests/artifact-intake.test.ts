import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactRepositories,
  CommitAcceptedArtifactInput,
  IdempotencyRecord,
  UploadPolicySnapshot
} from "../src/application/artifacts/repositories.js";
import { ArtifactIntakeError, ArtifactIntakeService } from "../src/application/artifacts/artifact-intake.js";
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

function harness(existing?: IdempotencyRecord) {
  const records = new Map<string, IdempotencyRecord>();
  if (existing) {
    records.set(existing.key, existing);
  }
  const commitAccepted = vi.fn(async (input: CommitAcceptedArtifactInput) => {
    const record = [...records.values()].find((candidate) => candidate.id === input.idempotencyRecordId);
    if (!record) {
      throw new Error("missing idempotency record");
    }
    records.set(record.key, {
      ...record,
      requestHash: input.requestHash,
      state: "completed",
      responseStatus: 202,
      responseBody: input.responseBody
    });
  });
  const repositories = {
    idempotency: {
      find: vi.fn(),
      claimPending: vi.fn(async (input) => {
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
      releasePending: vi.fn(async (id: string) => {
        for (const [key, record] of records) {
          if (record.id === id && record.state === "pending") {
            records.delete(key);
          }
        }
      })
    },
    intake: { commitAccepted }
  } as unknown as Pick<ArtifactRepositories, "idempotency" | "intake">;
  const storage = new InMemoryObjectStorage();
  const service = new ArtifactIntakeService({
    repositories,
    storage,
    viewerOrigin: "http://127.0.0.1:7456",
    maxProcessingAttempts: 3
  });
  return { service, storage, repositories, commitAccepted, records };
}

function completedRecord(name: string, zip: string): IdempotencyRecord {
  return {
    id: "idempotency-existing",
    ownerUserId: "owner-1",
    operation: "create_artifact",
    targetResourceId: null,
    key: "create-key",
    requestHash: ArtifactIntakeService.inputHash(name, createHash("sha256").update(zip).digest("hex")),
    state: "completed",
    responseStatus: 202,
    responseBody: {
      artifactId: "artifact-existing",
      uploadSessionId: "upload-existing",
      processingState: "accepted"
    }
  };
}

describe("ArtifactIntakeService", () => {
  it("stores the raw ZIP before committing the accepted Artifact graph", async () => {
    const { service, storage, commitAccepted } = harness();

    const result = await service.create({
      ownerUserId: "owner-1",
      idempotencyKey: "create-key",
      name: "  Report  ",
      body: body("zip-content"),
      policy
    });

    expect(result.processingState).toBe("accepted");
    expect(result).not.toHaveProperty("shareLink");
    expect(commitAccepted).toHaveBeenCalledOnce();
    const committed = commitAccepted.mock.calls[0]?.[0];
    expect(committed).toBeDefined();
    if (!committed) {
      throw new Error("Expected committed Artifact input.");
    }
    expect(committed.name).toBe("Report");
    expect(committed).not.toHaveProperty("shareLinkId");
    expect(committed).not.toHaveProperty("shareSlug");
    expect(await storage.readForTest(committed.rawObjectKey)).toEqual(Buffer.from("zip-content"));
  });

  it("returns operation_in_progress without consuming another body", async () => {
    const pending = { ...completedRecord("Report", "zip-content"), state: "pending", responseStatus: null, responseBody: null };
    const { service } = harness(pending);
    let consumed = false;
    async function* unconsumed(): AsyncIterable<Uint8Array> {
      consumed = true;
      yield Buffer.from("zip-content");
    }

    await expect(
      service.create({ ownerUserId: "owner-1", idempotencyKey: "create-key", name: "Report", body: unconsumed(), policy })
    ).rejects.toMatchObject({ code: "operation_in_progress" });
    expect(consumed).toBe(false);
  });

  it("returns the completed result only when name and ZIP SHA-256 match", async () => {
    const existing = completedRecord("Report", "zip-content");
    const { service, commitAccepted } = harness(existing);

    await expect(
      service.create({ ownerUserId: "owner-1", idempotencyKey: "create-key", name: "Report", body: body("zip-content"), policy })
    ).resolves.toEqual(existing.responseBody);
    expect(commitAccepted).not.toHaveBeenCalled();

    await expect(
      service.create({ ownerUserId: "owner-1", idempotencyKey: "create-key", name: "Other", body: body("zip-content"), policy })
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("releases the pending key when the incoming stream is interrupted", async () => {
    const { service, repositories, commitAccepted } = harness();
    async function* interrupted(): AsyncIterable<Uint8Array> {
      yield Buffer.from("partial");
      throw new Error("client disconnected");
    }

    await expect(
      service.create({ ownerUserId: "owner-1", idempotencyKey: "create-key", name: "Report", body: interrupted(), policy })
    ).rejects.toThrow("client disconnected");
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
    expect(commitAccepted).not.toHaveBeenCalled();
  });

  it("rejects an invalid name before claiming idempotency", async () => {
    const { service, repositories } = harness();

    await expect(
      service.create({ ownerUserId: "owner-1", idempotencyKey: "create-key", name: "   ", body: body("zip"), policy })
    ).rejects.toEqual(new ArtifactIntakeError("invalid_artifact_name"));
    expect(repositories.idempotency.claimPending).not.toHaveBeenCalled();
  });

  it("keeps an invalid multipart name handled while the idempotency claim is pending", async () => {
    const { service, repositories } = harness();
    vi.mocked(repositories.idempotency.claimPending).mockImplementationOnce(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        kind: "acquired",
        record: {
          id: input.id,
          ownerUserId: input.ownerUserId,
          operation: input.operation,
          targetResourceId: input.targetResourceId,
          key: input.key,
          requestHash: input.provisionalRequestHash,
          state: "pending",
          responseStatus: null,
          responseBody: null
        }
      };
    });

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "blank-name-key",
        name: Promise.resolve("   "),
        body: body("zip-content"),
        policy
      })
    ).rejects.toMatchObject({ code: "invalid_artifact_name" });
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
  });

  it("releases the pending key when the requested Entry is unsafe", async () => {
    const { service, storage, repositories } = harness();
    const deleteObject = vi.spyOn(storage, "deleteObject");
    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "unsafe-entry-key",
        name: "Report",
        requestedEntry: "../secret.html",
        body: body("zip-content"),
        policy
      })
    ).rejects.toMatchObject({ code: "invalid_requested_entry" });
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledOnce();
    await expect(storage.readForTest(deleteObject.mock.calls[0]?.[0] ?? "missing")).resolves.toBeUndefined();
  });

  it("discards a stored raw ZIP when the multipart name is invalid", async () => {
    const { service, storage, repositories } = harness();
    const deleteObject = vi.spyOn(storage, "deleteObject");

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "invalid-name-cleanup-key",
        name: Promise.resolve("   "),
        body: body("zip-content"),
        policy
      })
    ).rejects.toMatchObject({ code: "invalid_artifact_name" });

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
    await expect(storage.readForTest(deleteObject.mock.calls[0]?.[0] ?? "missing")).resolves.toBeUndefined();
  });

  it("discards a stored raw ZIP when multipart completion fails", async () => {
    const { service, storage, repositories } = harness();
    const deleteObject = vi.spyOn(storage, "deleteObject");
    const completionError = new Error("multipart stream incomplete");

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "completion-cleanup-key",
        name: "Report",
        body: body("zip-content"),
        policy,
        completed: Promise.reject(completionError)
      })
    ).rejects.toBe(completionError);

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
  });

  it("discards a stored raw ZIP when its measured size exceeds policy", async () => {
    const { service, storage, repositories } = harness();
    const deleteObject = vi.spyOn(storage, "deleteObject");

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "oversize-cleanup-key",
        name: "Report",
        body: body("too large"),
        policy: { ...policy, archiveSizeBytes: 3 }
      })
    ).rejects.toMatchObject({ code: "archive_too_large" });

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
  });

  it("discards a stored raw ZIP when the accepted graph commit fails", async () => {
    const { service, storage, repositories, commitAccepted } = harness();
    const deleteObject = vi.spyOn(storage, "deleteObject");
    const commitError = new Error("database unavailable");
    commitAccepted.mockRejectedValueOnce(commitError);

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "commit-cleanup-key",
        name: "Report",
        body: body("zip-content"),
        policy
      })
    ).rejects.toBe(commitError);

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
  });

  it("preserves the original failure when raw ZIP cleanup also fails", async () => {
    const { service, storage, repositories, commitAccepted } = harness();
    const commitError = new Error("database unavailable");
    commitAccepted.mockRejectedValueOnce(commitError);
    vi.spyOn(storage, "deleteObject").mockRejectedValueOnce(new Error("object store unavailable"));

    await expect(
      service.create({
        ownerUserId: "owner-1",
        idempotencyKey: "cleanup-failure-key",
        name: "Report",
        body: body("zip-content"),
        policy
      })
    ).rejects.toBe(commitError);
    expect(repositories.idempotency.releasePending).toHaveBeenCalledOnce();
  });
});
