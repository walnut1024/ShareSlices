import { S3Client } from "@aws-sdk/client-s3";
import type { ApiEnv } from "../env.js";
import { env } from "../env.js";
import { AwsS3ObjectStorage } from "./aws-s3-object-storage.js";

export function createConfiguredObjectStorage(config: ApiEnv = env): AwsS3ObjectStorage {
  return new AwsS3ObjectStorage({
    client: new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY
      }
    }),
    bucket: config.S3_BUCKET
  });
}
