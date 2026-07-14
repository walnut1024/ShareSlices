export interface ReconciliationRepository {
  recoverExpiredLeases(expiredBefore: Date, limit: number): Promise<number>;
  findRemovableRawObjectKeys(keys: string[]): Promise<string[]>;
  findRemovableStagingObjectKeys(keys: string[]): Promise<string[]>;
  claimArtifactDeletionCleanups(
    createdBefore: Date,
    limit: number
  ): Promise<Array<{ artifactId: string; objectKeys: string[]; stagingPrefixes: string[]; attemptCount: number; leaseToken: string }>>;
  completeArtifactDeletionCleanup(artifactId: string, leaseToken: string): Promise<void>;
  failArtifactDeletionCleanup(
    artifactId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<void>;
  recoverExpiredCreatingBundles(expiredBefore: Date, quiesceAfter: Date, limit: number): Promise<number>;
  claimContentBundleCleanups(
    now: Date,
    limit: number
  ): Promise<Array<{
    bundleId: string;
    ownerUserId: string;
    objectPrefixes: string[];
    attemptCount: number;
    leaseToken: string;
  }>>;
  completeContentBundleCleanup(
    bundleId: string,
    leaseToken: string,
    processedPrefixes: string[]
  ): Promise<boolean>;
  failContentBundleCleanup(
    bundleId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<void>;
  recordLateContentBundlePrefix(bundleId: string, objectPrefix: string): Promise<boolean>;
  claimEligibleAttemptPrefixes(now: Date, limit: number): Promise<Array<{
    attemptId: string;
    objectPrefix: string;
    attemptCount: number;
    leaseToken: string;
  }>>;
  completeAttemptPrefixCleanup(attemptId: string, leaseToken: string): Promise<void>;
  failAttemptPrefixCleanup(
    attemptId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<void>;
  claimEligibleThumbnailObjects(now: Date, limit: number): Promise<Array<{
    attemptId: string;
    objectKey: string;
    attemptCount: number;
    leaseToken: string;
  }>>;
  completeThumbnailObjectCleanup(attemptId: string, leaseToken: string): Promise<void>;
  failThumbnailObjectCleanup(
    attemptId: string,
    leaseToken: string,
    nextAttemptAt: Date,
    errorCode: string
  ): Promise<void>;
}
