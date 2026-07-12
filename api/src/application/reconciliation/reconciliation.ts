import type { ObjectStorage } from "../../storage/index.js";
import type { ReconciliationRepository } from "./repository.js";

export type ReconciliationWorkType = "expired_leases" | "raw_objects" | "staging_objects" | "artifact_deletions";

export type ReconciliationInput = {
  workType: ReconciliationWorkType;
  olderThan: Date;
  limit: number;
  cursor?: string;
};

export type ReconciliationReport = {
  workType: ReconciliationWorkType;
  scannedCount: number;
  deletedCount: number;
  recoveredLeaseCount: number;
  nextCursor?: string;
};

type ReconciliationOptions = {
  repository: ReconciliationRepository;
  storage: ObjectStorage;
};

const prefixes = {
  raw_objects: "raw/",
  staging_objects: "staging/"
} as const;

const maxBatchSize = 1_000;

function validateInput(input: ReconciliationInput): void {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxBatchSize) {
    throw new Error(`Reconciliation limit must be an integer from 1 to ${maxBatchSize}.`);
  }
  if (Number.isNaN(input.olderThan.getTime())) {
    throw new Error("Reconciliation cutoff must be a valid date.");
  }
}

export class ReconciliationModule {
  readonly #repository: ReconciliationRepository;
  readonly #storage: ObjectStorage;

  constructor(options: ReconciliationOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
  }

  async run(input: ReconciliationInput): Promise<ReconciliationReport> {
    validateInput(input);

    if (input.workType === "expired_leases") {
      const recoveredLeaseCount = await this.#repository.recoverExpiredLeases(
        input.olderThan,
        input.limit
      );
      return {
        workType: input.workType,
        scannedCount: recoveredLeaseCount,
        deletedCount: 0,
        recoveredLeaseCount
      };
    }

    if (input.workType === "artifact_deletions") {
      const cleanups = await this.#repository.listArtifactDeletionCleanups(input.olderThan, input.limit);
      for (const cleanup of cleanups) {
        await Promise.all([
          ...cleanup.objectKeys.map((key) => this.#storage.deleteObject(key)),
          ...cleanup.stagingPrefixes.map((prefix) => this.#storage.removeStagingPrefix(prefix))
        ]);
        await this.#repository.completeArtifactDeletionCleanup(cleanup.artifactId);
      }
      return {
        workType: input.workType,
        scannedCount: cleanups.length,
        deletedCount: cleanups.length,
        recoveredLeaseCount: 0
      };
    }

    const page = await this.#storage.listObjects({
      prefix: prefixes[input.workType],
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {})
    });
    const oldKeys = page.objects
      .filter((object) => object.lastModified.getTime() < input.olderThan.getTime())
      .map((object) => object.key);
    const removableKeys =
      input.workType === "raw_objects"
        ? await this.#repository.findRemovableRawObjectKeys(oldKeys)
        : await this.#repository.findRemovableStagingObjectKeys(oldKeys);

    for (const key of removableKeys) {
      await this.#storage.deleteObject(key);
    }

    return {
      workType: input.workType,
      scannedCount: page.objects.length,
      deletedCount: removableKeys.length,
      recoveredLeaseCount: 0,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
    };
  }
}
