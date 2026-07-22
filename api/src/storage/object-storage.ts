export type ObjectBody = AsyncIterable<Uint8Array>;

export type ObjectWrite = {
  key: string;
  body: ObjectBody;
  contentType?: string;
};

export type RawZipWriteResult = {
  key: string;
  sizeBytes: number;
  sha256: string;
};

export type StoredObjectResult = {
  key: string;
  sizeBytes: number;
};

export type CommittedObject = {
  body: ObjectBody;
  sizeBytes?: number;
  contentType?: string;
  range?: ObjectByteRange;
};

export type ObjectByteRange = {
  offset: number;
  length: number;
};

export type ObjectReadOptions = {
  range?: ObjectByteRange;
};

export function validateObjectReadOptions(options: ObjectReadOptions): void {
  const range = options.range;
  if (!range) return;
  if (
    !Number.isSafeInteger(range.offset) ||
    range.offset < 0 ||
    !Number.isSafeInteger(range.length) ||
    range.length <= 0
  ) {
    throw new Error("An object byte range requires a non-negative offset and positive length.");
  }
}

export type PrefixRemovalResult = {
  deletedCount: number;
};

export type StoredObjectSummary = {
  key: string;
  lastModified: Date;
};

export type ObjectListInput = {
  prefix: string;
  limit: number;
  cursor?: string;
};

export type ObjectListResult = {
  objects: StoredObjectSummary[];
  nextCursor?: string;
};

export interface ObjectStorage {
  writeRawZip(input: ObjectWrite): Promise<RawZipWriteResult>;
  writeStagingObject(input: ObjectWrite): Promise<StoredObjectResult>;
  readCommittedObject(key: string, options?: ObjectReadOptions): Promise<CommittedObject>;
  listObjects(input: ObjectListInput): Promise<ObjectListResult>;
  deleteObject(key: string): Promise<void>;
  removeStagingPrefix(prefix: string): Promise<PrefixRemovalResult>;
  removeContentBundlePrefix(prefix: string): Promise<PrefixRemovalResult>;
}
