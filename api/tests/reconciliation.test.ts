import { describe, expect, it, vi } from "vitest";
import { ReconciliationModule } from "../src/application/reconciliation/reconciliation.js";
import type { ReconciliationRepository } from "../src/application/reconciliation/repository.js";
import { InMemoryObjectStorage } from "../src/storage/index.js";

async function* body(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value);
}

function repository(overrides: Partial<ReconciliationRepository> = {}): ReconciliationRepository {
  return {
    recoverExpiredLeases: vi.fn(async () => 0),
    findRemovableRawObjectKeys: vi.fn(async () => []),
    findRemovableStagingObjectKeys: vi.fn(async () => []),
    claimArtifactDeletionCleanups: vi.fn(async () => []),
    completeArtifactDeletionCleanup: vi.fn(async () => undefined),
    failArtifactDeletionCleanup: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("ReconciliationModule", () => {
  it("recovers only a bounded expired-lease pass", async () => {
    const recoverExpiredLeases = vi.fn(async () => 2);
    const module = new ReconciliationModule({
      repository: repository({ recoverExpiredLeases }),
      storage: new InMemoryObjectStorage()
    });
    const cutoff = new Date("2026-07-10T01:00:00Z");

    await expect(
      module.run({ workType: "expired_leases", olderThan: cutoff, limit: 2 })
    ).resolves.toEqual({
      workType: "expired_leases",
      scannedCount: 2,
      deletedCount: 0,
      recoveredLeaseCount: 2
    });
    expect(recoverExpiredLeases).toHaveBeenCalledWith(cutoff, 2);
  });

  it("deletes eligible old raw ZIPs while preserving current retryable and recent input", async () => {
    let now = new Date("2026-07-10T00:00:00Z");
    const storage = new InMemoryObjectStorage(() => now);
    await storage.writeRawZip({ key: "raw/artifact/current-retryable.zip", body: body("keep") });
    await storage.writeRawZip({ key: "raw/artifact/superseded.zip", body: body("remove") });
    now = new Date("2026-07-10T02:00:00Z");
    await storage.writeRawZip({ key: "raw/artifact/recent-orphan.zip", body: body("recent") });
    const findRemovableRawObjectKeys = vi.fn(async (keys: string[]) =>
      keys.filter((key) => key.endsWith("superseded.zip"))
    );
    const module = new ReconciliationModule({
      repository: repository({ findRemovableRawObjectKeys }),
      storage
    });

    const report = await module.run({
      workType: "raw_objects",
      olderThan: new Date("2026-07-10T01:00:00Z"),
      limit: 10
    });

    expect(report).toEqual({
      workType: "raw_objects",
      scannedCount: 3,
      deletedCount: 1,
      recoveredLeaseCount: 0
    });
    expect(findRemovableRawObjectKeys).toHaveBeenCalledWith([
      "raw/artifact/current-retryable.zip",
      "raw/artifact/superseded.zip"
    ]);
    expect(await storage.readForTest("raw/artifact/current-retryable.zip")).toEqual(Buffer.from("keep"));
    expect(await storage.readForTest("raw/artifact/superseded.zip")).toBeUndefined();
    expect(await storage.readForTest("raw/artifact/recent-orphan.zip")).toEqual(Buffer.from("recent"));

    await expect(
      module.run({
        workType: "raw_objects",
        olderThan: new Date("2026-07-10T01:00:00Z"),
        limit: 10
      })
    ).resolves.toMatchObject({ scannedCount: 2, deletedCount: 0 });
  });

  it("cleans eligible staging objects in cursor-bounded pages", async () => {
    const storage = new InMemoryObjectStorage(() => new Date("2026-07-10T00:00:00Z"));
    await storage.writeStagingObject({ key: "staging/upload/attempt-a/index.html", body: body("a") });
    await storage.writeStagingObject({ key: "staging/upload/attempt-b/index.html", body: body("b") });
    await storage.writeStagingObject({ key: "staging/upload/attempt-c/index.html", body: body("c") });
    const findRemovableStagingObjectKeys = vi.fn(async (keys: string[]) => keys);
    const module = new ReconciliationModule({
      repository: repository({ findRemovableStagingObjectKeys }),
      storage
    });

    const first = await module.run({
      workType: "staging_objects",
      olderThan: new Date("2026-07-10T01:00:00Z"),
      limit: 2
    });
    if (!first.nextCursor) {
      throw new Error("Expected another reconciliation page.");
    }
    const second = await module.run({
      workType: "staging_objects",
      olderThan: new Date("2026-07-10T01:00:00Z"),
      limit: 2,
      cursor: first.nextCursor
    });

    expect(first).toMatchObject({ scannedCount: 2, deletedCount: 2 });
    expect(first.nextCursor).toBe("staging/upload/attempt-b/index.html");
    expect(second).toEqual({
      workType: "staging_objects",
      scannedCount: 1,
      deletedCount: 1,
      recoveredLeaseCount: 0
    });
  });

  it("finishes durable Artifact deletion cleanup without another client request", async () => {
    const storage = new InMemoryObjectStorage();
    await storage.writeRawZip({ key: "raw/artifact-delete/input.zip", body: body("raw") });
    await storage.writeStagingObject({
      key: "staging/artifact-delete/attempt-1/index.html",
      body: body("staged")
    });
    const completeArtifactDeletionCleanup = vi.fn(async () => undefined);
    const module = new ReconciliationModule({
      repository: repository({
        claimArtifactDeletionCleanups: vi.fn(async () => [
          {
            artifactId: "artifact-delete",
            objectKeys: ["raw/artifact-delete/input.zip"],
            stagingPrefixes: ["staging/artifact-delete/attempt-1/"],
            attemptCount: 1,
            leaseToken: "lease-delete"
          }
        ]),
        completeArtifactDeletionCleanup
      }),
      storage
    });

    await expect(
      module.run({
        workType: "artifact_deletions",
        olderThan: new Date("2026-07-12T00:00:00Z"),
        limit: 10
      })
    ).resolves.toEqual({
      workType: "artifact_deletions",
      scannedCount: 1,
      deletedCount: 1,
      recoveredLeaseCount: 0
    });
    expect(await storage.readForTest("raw/artifact-delete/input.zip")).toBeUndefined();
    expect(await storage.readForTest("staging/artifact-delete/attempt-1/index.html")).toBeUndefined();
    expect(completeArtifactDeletionCleanup).toHaveBeenCalledWith("artifact-delete", "lease-delete");
  });

  it("leases deletion intents and lets later cleanups finish when one object deletion fails", async () => {
    const completeArtifactDeletionCleanup = vi.fn(async () => undefined);
    const failArtifactDeletionCleanup = vi.fn(async () => undefined);
    const deleteObject = vi.fn(async (key: string) => {
      if (key === "raw/failing.zip") throw new Error("storage unavailable");
    });
    const module = new ReconciliationModule({
      repository: repository({
        claimArtifactDeletionCleanups: vi.fn(async () => [
          { artifactId: "artifact-failing", objectKeys: ["raw/failing.zip"], stagingPrefixes: [], attemptCount: 1, leaseToken: "lease-failing" },
          { artifactId: "artifact-success", objectKeys: ["raw/success.zip"], stagingPrefixes: [], attemptCount: 1, leaseToken: "lease-success" }
        ]),
        completeArtifactDeletionCleanup,
        failArtifactDeletionCleanup
      }),
      storage: { deleteObject, removeStagingPrefix: vi.fn() } as unknown as InMemoryObjectStorage
    });

    await expect(
      module.run({ workType: "artifact_deletions", olderThan: new Date("2026-07-12T00:00:00Z"), limit: 10 })
    ).resolves.toMatchObject({ scannedCount: 2, deletedCount: 1 });
    expect(completeArtifactDeletionCleanup).toHaveBeenCalledWith("artifact-success", "lease-success");
    expect(failArtifactDeletionCleanup).toHaveBeenCalledWith(
      "artifact-failing",
      "lease-failing",
      expect.any(Date),
      "object_cleanup_failed"
    );
  });

  it("rejects unbounded or invalid passes before accessing dependencies", async () => {
    const repo = repository();
    const module = new ReconciliationModule({ repository: repo, storage: new InMemoryObjectStorage() });

    await expect(
      module.run({ workType: "raw_objects", olderThan: new Date("invalid"), limit: 10 })
    ).rejects.toThrow("cutoff");
    await expect(
      module.run({ workType: "raw_objects", olderThan: new Date(), limit: 0 })
    ).rejects.toThrow("limit");
    await expect(
      module.run({ workType: "raw_objects", olderThan: new Date(), limit: 1_001 })
    ).rejects.toThrow("limit");
    expect(repo.findRemovableRawObjectKeys).not.toHaveBeenCalled();
  });
});
