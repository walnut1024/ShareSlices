import { createHash } from "node:crypto";
import type {
  CommittedObject,
  ObjectBody,
  ObjectListInput,
  ObjectListResult,
  ObjectReadOptions,
  ObjectStorage,
  ObjectWrite,
  PrefixRemovalResult,
  RawZipWriteResult,
  StoredObjectResult,
} from "./object-storage.js";
import { validateObjectReadOptions } from "./object-storage.js";

export type R2ObjectMetadata = Readonly<{
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: Readonly<{ contentType?: string }>;
  range?: Readonly<{ offset: number; length: number }>;
}>;

export type R2ObjectBody = R2ObjectMetadata & Readonly<{
  body: ReadableStream<Uint8Array>;
}>;

export type R2ObjectList = Readonly<{
  objects: readonly R2ObjectMetadata[];
  truncated: boolean;
  cursor?: string;
}>;

export interface R2BucketBinding {
  get(
    key: string,
    options?: Readonly<{ range?: Readonly<{ offset: number; length: number }> }>,
  ): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: Readonly<{
      httpMetadata?: Readonly<{ contentType?: string }>;
      onlyIf?: Readonly<{ etagDoesNotMatch: string }>;
    }>,
  ): Promise<R2ObjectMetadata | null>;
  createMultipartUpload(
    key: string,
    options?: Readonly<{ httpMetadata?: Readonly<{ contentType?: string }> }>,
  ): Promise<R2MultipartUploadBinding>;
  list(options: Readonly<{ prefix: string; limit?: number; cursor?: string }>): Promise<R2ObjectList>;
  delete(keys: string | string[]): Promise<void>;
}

export interface R2MultipartUploadBinding {
  uploadPart(partNumber: number, value: Uint8Array): Promise<Readonly<{ partNumber: number; etag: string }>>;
  abort(): Promise<void>;
  complete(
    parts: readonly Readonly<{ partNumber: number; etag: string }>[],
  ): Promise<R2ObjectMetadata>;
}

const multipartPartSize = 5 * 1024 * 1024;
const multipartMaximumParts = 10_000;

function assertCleanupPrefix(prefix: string, root: "staging" | "content-bundles"): void {
  if (!prefix.startsWith(`${root}/`) || !prefix.endsWith("/") || prefix === `${root}/`) {
    throw new Error(`A ${root} cleanup prefix must stay below '${root}/' and end with '/'.`);
  }
}

function asyncBodyStream(
  body: ObjectBody,
  observe: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        observe(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function streamBody(stream: ReadableStream<Uint8Array>): ObjectBody {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export class R2ObjectStorage implements ObjectStorage {
  readonly #bucket: R2BucketBinding;

  constructor(bucket: R2BucketBinding) {
    this.#bucket = bucket;
  }

  async writeRawZip(input: ObjectWrite): Promise<RawZipWriteResult> {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const upload = await this.#bucket.createMultipartUpload(
      input.key,
      input.contentType ? { httpMetadata: { contentType: input.contentType } } : undefined,
    );
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let pending = new Uint8Array(multipartPartSize);
    let pendingLength = 0;
    const flush = async () => {
      if (parts.length >= multipartMaximumParts) throw new Error("R2 multipart upload exceeds 10,000 parts.");
      const value = pending.slice(0, pendingLength);
      const part = await upload.uploadPart(parts.length + 1, value);
      parts.push({ partNumber: part.partNumber, etag: part.etag });
      pending = new Uint8Array(multipartPartSize);
      pendingLength = 0;
    };
    try {
      for await (const chunk of input.body) {
        sizeBytes += chunk.byteLength;
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const copied = Math.min(multipartPartSize - pendingLength, chunk.byteLength - offset);
          pending.set(chunk.subarray(offset, offset + copied), pendingLength);
          pendingLength += copied;
          offset += copied;
          if (pendingLength === multipartPartSize) await flush();
        }
      }
      if (pendingLength > 0 || parts.length === 0) await flush();
      await upload.complete(parts);
    } catch (error) {
      await upload.abort().catch(() => undefined);
      throw error;
    }
    return { key: input.key, sizeBytes, sha256: hash.digest("hex") };
  }

  async writeStagingObject(input: ObjectWrite): Promise<StoredObjectResult> {
    let sizeBytes = 0;
    const stored = await this.#bucket.put(
      input.key,
      asyncBodyStream(input.body, (chunk) => {
        sizeBytes += chunk.byteLength;
      }),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        ...(input.contentType ? { httpMetadata: { contentType: input.contentType } } : {}),
      },
    );
    if (!stored) throw new Error("R2 refused an overwrite of an immutable object key.");
    return { key: input.key, sizeBytes };
  }

  async readCommittedObject(key: string, options: ObjectReadOptions = {}): Promise<CommittedObject> {
    validateObjectReadOptions(options);
    const object = options.range
      ? await this.#bucket.get(key, { range: options.range })
      : await this.#bucket.get(key);
    if (!object) throw new Error("Object not found.");
    return {
      body: streamBody(object.body),
      sizeBytes: object.size,
      ...(object.httpMetadata?.contentType
        ? { contentType: object.httpMetadata.contentType }
        : {}),
      ...(object.range ? { range: object.range } : {}),
    };
  }

  async listObjects(input: ObjectListInput): Promise<ObjectListResult> {
    const listed = await this.#bucket.list({
      prefix: input.prefix,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    if (listed.truncated && !listed.cursor) {
      throw new Error("R2 returned a truncated listing without a cursor.");
    }
    return {
      objects: listed.objects.map(({ key, uploaded }) => ({ key, lastModified: uploaded })),
      ...(listed.truncated ? { nextCursor: listed.cursor } : {}),
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.#bucket.delete(key);
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
    let cursor: string | undefined;
    let deletedCount = 0;
    do {
      const listed = await this.#bucket.list({
        prefix,
        limit: 1_000,
        ...(cursor ? { cursor } : {}),
      });
      const keys = listed.objects.map(({ key }) => key);
      if (keys.length > 0) {
        await this.#bucket.delete(keys);
        deletedCount += keys.length;
      }
      if (listed.truncated && !listed.cursor) {
        throw new Error("R2 returned a truncated listing without a cursor.");
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return { deletedCount };
  }
}
