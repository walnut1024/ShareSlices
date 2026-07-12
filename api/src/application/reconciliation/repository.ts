export interface ReconciliationRepository {
  recoverExpiredLeases(expiredBefore: Date, limit: number): Promise<number>;
  findRemovableRawObjectKeys(keys: string[]): Promise<string[]>;
  findRemovableStagingObjectKeys(keys: string[]): Promise<string[]>;
  listArtifactDeletionCleanups(
    createdBefore: Date,
    limit: number
  ): Promise<Array<{ artifactId: string; objectKeys: string[]; stagingPrefixes: string[] }>>;
  completeArtifactDeletionCleanup(artifactId: string): Promise<void>;
}
