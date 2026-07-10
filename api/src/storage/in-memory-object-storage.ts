import { createHash } from "node:crypto";
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

type MemoryObject = {
  bytes: Buffer;
  contentType?: string;
  lastModified: Date;
};

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function assertCleanupPrefix(prefix: string): void {
  if (!prefix.endsWith("/")) {
    throw new Error("A staging cleanup prefix must end with '/'.");
  }
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, MemoryObject>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async writeRawZip(input: ObjectWrite): Promise<RawZipWriteResult> {
    const bytes = await collect(input.body);
    this.#objects.set(input.key, {
      bytes,
      lastModified: this.#now(),
      ...(input.contentType ? { contentType: input.contentType } : {})
    });
    return {
      key: input.key,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  }

  async writeStagingObject(input: ObjectWrite): Promise<StoredObjectResult> {
    const bytes = await collect(input.body);
    this.#objects.set(input.key, {
      bytes,
      lastModified: this.#now(),
      ...(input.contentType ? { contentType: input.contentType } : {})
    });
    return { key: input.key, sizeBytes: bytes.byteLength };
  }

  async readCommittedObject(key: string): Promise<CommittedObject> {
    const object = this.#objects.get(key);
    if (!object) {
      throw new Error(`Object not found: ${key}`);
    }
    return {
      body: (async function* () {
        yield object.bytes;
      })(),
      sizeBytes: object.bytes.byteLength,
      ...(object.contentType ? { contentType: object.contentType } : {})
    };
  }

  async listObjects(input: ObjectListInput): Promise<ObjectListResult> {
    const keys = [...this.#objects.keys()]
      .filter((key) => key.startsWith(input.prefix) && (!input.cursor || key > input.cursor))
      .sort();
    const pageKeys = keys.slice(0, input.limit);
    const lastKey = pageKeys.at(-1);
    return {
      objects: pageKeys.map((key) => ({
        key,
        lastModified: this.#objects.get(key)?.lastModified ?? new Date(0)
      })),
      ...(keys.length > input.limit && lastKey ? { nextCursor: lastKey } : {})
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  async removeStagingPrefix(prefix: string): Promise<PrefixRemovalResult> {
    assertCleanupPrefix(prefix);
    let deletedCount = 0;
    for (const key of this.#objects.keys()) {
      if (key.startsWith(prefix)) {
        this.#objects.delete(key);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }

  async readForTest(key: string): Promise<Buffer | undefined> {
    return this.#objects.get(key)?.bytes;
  }
}
