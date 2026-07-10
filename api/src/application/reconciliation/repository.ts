export interface ReconciliationRepository {
  recoverExpiredLeases(expiredBefore: Date, limit: number): Promise<number>;
  findRemovableRawObjectKeys(keys: string[]): Promise<string[]>;
  findRemovableStagingObjectKeys(keys: string[]): Promise<string[]>;
}
