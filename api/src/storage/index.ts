export { AwsS3ObjectStorage, type S3CommandClient } from "./aws-s3-object-storage.js";
export { createConfiguredObjectStorage } from "./configured-object-storage.js";
export { InMemoryObjectStorage } from "./in-memory-object-storage.js";
export type {
  CommittedObject,
  ObjectBody,
  ObjectListInput,
  ObjectListResult,
  ObjectStorage,
  ObjectWrite,
  PrefixRemovalResult,
  RawZipWriteResult,
  StoredObjectResult,
  StoredObjectSummary
} from "./object-storage.js";
