import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type PutObjectCommandInput,
  type S3Client,
  type DeleteObjectsCommandOutput,
  type GetObjectCommandOutput,
  type ListObjectsV2CommandOutput
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { finished } from "node:stream/promises";
import type {
  CommittedObject,
  ObjectListInput,
  ObjectListResult,
  ObjectStorage,
  ObjectWrite,
  PrefixRemovalResult,
  RawZipWriteResult,
  StoredObjectResult
} from "./object-storage.js";

type StorageCommand =
  | GetObjectCommand
  | ListObjectsV2Command
  | DeleteObjectCommand
  | DeleteObjectsCommand;

export interface S3CommandClient {
  send(command: StorageCommand): Promise<unknown>;
}

type AwsS3ObjectStorageOptions = {
  client: S3CommandClient;
  bucket: string;
  createMultipartUpload?: MultipartUploadFactory;
};

export type MultipartUploadFactory = (input: {
  client: S3CommandClient;
  params: PutObjectCommandInput;
}) => { done(): Promise<unknown> };

function assertCleanupPrefix(prefix: string, root: "staging" | "content-bundles"): void {
  if (!prefix.startsWith(`${root}/`) || !prefix.endsWith("/") || prefix === `${root}/`) {
    throw new Error(`A ${root} cleanup prefix must stay below '${root}/' and end with '/'.`);
  }
}

function asAsyncBody(body: GetObjectCommandOutput["Body"]): AsyncIterable<Uint8Array> {
  if (!body || !(Symbol.asyncIterator in body)) {
    throw new Error("S3 returned an unreadable object body.");
  }
  return body as AsyncIterable<Uint8Array>;
}

export class AwsS3ObjectStorage implements ObjectStorage {
  readonly #client: S3CommandClient;
  readonly #bucket: string;
  readonly #createMultipartUpload: MultipartUploadFactory;

  constructor(options: AwsS3ObjectStorageOptions) {
    this.#client = options.client;
    this.#bucket = options.bucket;
    this.#createMultipartUpload =
      options.createMultipartUpload ??
      ((input) =>
        new Upload({
          client: input.client as S3Client,
          params: input.params,
          queueSize: 4,
          leavePartsOnError: false
        }));
  }

  async writeRawZip(input: ObjectWrite): Promise<RawZipWriteResult> {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.byteLength;
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    const source = Readable.from(input.body);
    source.on("error", (error) => meter.destroy(error));
    source.pipe(meter);

    try {
      await this.#createMultipartUpload({
        client: this.#client,
        params: {
          Bucket: this.#bucket,
          Key: input.key,
          Body: meter,
          ...(input.contentType ? { ContentType: input.contentType } : {})
        }
      }).done();
      await finished(meter);
    } catch (error) {
      source.destroy();
      meter.destroy();
      throw error;
    }

    return { key: input.key, sizeBytes, sha256: hash.digest("hex") };
  }

  async writeStagingObject(input: ObjectWrite): Promise<StoredObjectResult> {
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.byteLength;
        callback(null, chunk);
      }
    });
    const source = Readable.from(input.body);
    source.on("error", (error) => meter.destroy(error));
    source.pipe(meter);

    try {
      await this.#createMultipartUpload({
        client: this.#client,
        params: {
          Bucket: this.#bucket,
          Key: input.key,
          Body: meter,
          ...(input.contentType ? { ContentType: input.contentType } : {})
        }
      }).done();
      await finished(meter);
    } catch (error) {
      source.destroy();
      meter.destroy();
      throw error;
    }

    return { key: input.key, sizeBytes };
  }

  async readCommittedObject(key: string): Promise<CommittedObject> {
    const output = (await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key })
    )) as GetObjectCommandOutput;
    return {
      body: asAsyncBody(output.Body),
      ...(output.ContentLength === undefined ? {} : { sizeBytes: output.ContentLength }),
      ...(output.ContentType ? { contentType: output.ContentType } : {})
    };
  }

  async listObjects(input: ObjectListInput): Promise<ObjectListResult> {
    const listed = (await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: input.prefix,
        MaxKeys: input.limit,
        ...(input.cursor ? { ContinuationToken: input.cursor } : {})
      })
    )) as ListObjectsV2CommandOutput;
    const objects = (listed.Contents ?? []).flatMap(({ Key, LastModified }) =>
      Key && LastModified ? [{ key: Key, lastModified: LastModified }] : []
    );
    if (listed.IsTruncated && !listed.NextContinuationToken) {
      throw new Error("S3 returned a truncated listing without a continuation token.");
    }
    return {
      objects,
      ...(listed.NextContinuationToken ? { nextCursor: listed.NextContinuationToken } : {})
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  async removeStagingPrefix(prefix: string): Promise<PrefixRemovalResult> {
    assertCleanupPrefix(prefix, "staging");
    return this.#removePrefix(prefix);
  }

  async removeContentBundlePrefix(prefix: string): Promise<PrefixRemovalResult> {
    assertCleanupPrefix(prefix, "content-bundles");
    return this.#removePrefix(prefix);
  }

  async #removePrefix(prefix: string): Promise<PrefixRemovalResult> {
    let continuationToken: string | undefined;
    let deletedCount = 0;

    do {
      const listed = (await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        })
      )) as ListObjectsV2CommandOutput;
      const objects = (listed.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));

      if (objects.length > 0) {
        const deleted = (await this.#client.send(
          new DeleteObjectsCommand({
            Bucket: this.#bucket,
            Delete: { Objects: objects, Quiet: true }
          })
        )) as DeleteObjectsCommandOutput;
        if (deleted.Errors && deleted.Errors.length > 0) {
          throw new Error("S3 failed to remove one or more objects under the cleanup prefix.");
        }
        deletedCount += objects.length;
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      if (listed.IsTruncated && !continuationToken) {
        throw new Error("S3 returned a truncated listing without a continuation token.");
      }
    } while (continuationToken);

    return { deletedCount };
  }
}
