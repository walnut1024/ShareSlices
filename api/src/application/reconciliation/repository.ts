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
}
