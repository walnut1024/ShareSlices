import type { ObjectStorage } from "../../storage/index.js";
import { apiLogger, type ApiLogger } from "../../logging/index.js";
import type { ReconciliationRepository } from "./repository.js";

export type ReconciliationWorkType =
  | "expired_leases"
  | "raw_objects"
  | "staging_objects"
  | "artifact_deletions"
  | "content_bundle_deletions";

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
  now?: () => Date;
  logger?: ApiLogger;
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
  readonly #now: () => Date;
  readonly #logger: ApiLogger;

  constructor(options: ReconciliationOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger ?? apiLogger;
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
      const cleanups = await this.#repository.claimArtifactDeletionCleanups(input.olderThan, input.limit);
      let deletedCount = 0;
      for (const cleanup of cleanups) {
        try {
          await Promise.all([
            ...cleanup.objectKeys.map((key) => this.#storage.deleteObject(key)),
            ...cleanup.stagingPrefixes.map((prefix) => this.#storage.removeStagingPrefix(prefix))
          ]);
          await this.#repository.completeArtifactDeletionCleanup(cleanup.artifactId, cleanup.leaseToken);
          deletedCount += 1;
        } catch {
          const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(cleanup.attemptCount - 1, 7));
          await this.#repository.failArtifactDeletionCleanup(
            cleanup.artifactId,
            cleanup.leaseToken,
            new Date(Date.now() + delaySeconds * 1000),
            "object_cleanup_failed"
          );
        }
      }
      return {
        workType: input.workType,
        scannedCount: cleanups.length,
        deletedCount,
        recoveredLeaseCount: 0
      };
    }

    if (input.workType === "content_bundle_deletions") {
      const now = this.#now();
      await this.#repository.recoverExpiredCreatingBundles(input.olderThan, now, input.limit);
      const cleanups = await this.#repository.claimContentBundleCleanups(now, input.limit);
      const attemptCleanups = await this.#repository.claimEligibleAttemptPrefixes(now, input.limit);
      const thumbnailCleanups = await this.#repository.claimEligibleThumbnailObjects(now, input.limit);
      let deletedCount = 0;
      let bundleCompletedCount = 0;
      let bundleFailedCount = 0;
      let attemptCompletedCount = 0;
      let attemptFailedCount = 0;
      for (const cleanup of cleanups) {
        try {
          for (const prefix of cleanup.objectPrefixes) {
            await this.#storage.removeContentBundlePrefix(prefix);
          }
          if (
            await this.#repository.completeContentBundleCleanup(
              cleanup.bundleId,
              cleanup.leaseToken,
              cleanup.objectPrefixes
            )
          ) {
            deletedCount += 1;
            bundleCompletedCount += 1;
          }
        } catch {
          bundleFailedCount += 1;
          const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(cleanup.attemptCount - 1, 7));
          await this.#repository.failContentBundleCleanup(
            cleanup.bundleId,
            cleanup.leaseToken,
            new Date(now.getTime() + delaySeconds * 1000),
            "object_cleanup_failed"
          );
        }
      }
      for (const cleanup of attemptCleanups) {
        try {
          await this.#storage.removeContentBundlePrefix(cleanup.objectPrefix);
          await this.#repository.completeAttemptPrefixCleanup(cleanup.attemptId, cleanup.leaseToken);
          deletedCount += 1;
          attemptCompletedCount += 1;
        } catch {
          attemptFailedCount += 1;
          const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(cleanup.attemptCount - 1, 7));
          await this.#repository.failAttemptPrefixCleanup(
            cleanup.attemptId,
            cleanup.leaseToken,
            new Date(now.getTime() + delaySeconds * 1000),
            "object_cleanup_failed"
          );
        }
      }
      for (const cleanup of thumbnailCleanups) {
        try {
          await this.#storage.deleteObject(cleanup.objectKey);
          await this.#repository.completeThumbnailObjectCleanup(cleanup.attemptId, cleanup.leaseToken);
          deletedCount += 1;
          attemptCompletedCount += 1;
        } catch {
          attemptFailedCount += 1;
          const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(cleanup.attemptCount - 1, 7));
          await this.#repository.failThumbnailObjectCleanup(
            cleanup.attemptId,
            cleanup.leaseToken,
            new Date(Date.now() + delaySeconds * 1000),
            "object_cleanup_failed"
          );
        }
      }
      this.#logger.emit({
        severity: "INFO",
        body: "Content bundle cleanup reconciliation completed.",
        eventName: "shareslices.reconciliation.content_bundle_cleanup.outcome",
        attributes: {
          "shareslices.cleanup.bundle.claimed_count": cleanups.length,
          "shareslices.cleanup.bundle.completed_count": bundleCompletedCount,
          "shareslices.cleanup.bundle.failed_count": bundleFailedCount,
          "shareslices.cleanup.attempt.claimed_count": attemptCleanups.length + thumbnailCleanups.length,
          "shareslices.cleanup.attempt.completed_count": attemptCompletedCount,
          "shareslices.cleanup.attempt.failed_count": attemptFailedCount
        }
      });
      return {
        workType: input.workType,
        scannedCount: cleanups.length + attemptCleanups.length + thumbnailCleanups.length,
        deletedCount,
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
