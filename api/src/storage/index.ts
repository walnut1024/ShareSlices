export { AwsS3ObjectStorage, type S3CommandClient } from "./aws-s3-object-storage.js";
export { createConfiguredObjectStorage } from "./configured-object-storage.js";
export { InMemoryObjectStorage } from "./in-memory-object-storage.js";
export {
  R2ObjectStorage,
  type R2BucketBinding,
  type R2MultipartUploadBinding,
  type R2ObjectBody,
  type R2ObjectList,
  type R2ObjectMetadata,
} from "./r2-object-storage.js";
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
