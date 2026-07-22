import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  R2ObjectStorage,
  type R2BucketBinding,
  type R2MultipartUploadBinding,
  type R2ObjectBody,
  type R2ObjectList,
  type R2ObjectMetadata,
} from "../src/storage/index.js";

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of body) parts.push(part);
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function object(key: string, value: string, contentType?: string): R2ObjectBody {
  const bytes = new TextEncoder().encode(value);
  return {
    key,
    size: bytes.byteLength,
    uploaded: new Date("2026-07-22T00:00:00Z"),
    ...(contentType ? { httpMetadata: { contentType } } : {}),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function bucket(overrides: Partial<R2BucketBinding> = {}): R2BucketBinding {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async (key) => ({
      key,
      size: 0,
      uploaded: new Date("2026-07-22T00:00:00Z"),
    })),
    createMultipartUpload: vi.fn(async (key) => ({
      uploadPart: vi.fn(async (partNumber) => ({ partNumber, etag: `etag-${partNumber}` })),
      abort: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({ key, size: 0, uploaded: new Date() })),
    })),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
    delete: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("R2ObjectStorage", () => {
  it("streams raw and staging writes through the private binding with metadata", async () => {
    const writes: Array<{ key: string; body: Uint8Array; contentType?: string }> = [];
    const rawParts: Uint8Array[] = [];
    const multipart: R2MultipartUploadBinding = {
      uploadPart: vi.fn(async (partNumber, value) => {
        rawParts.push(value);
        return { partNumber, etag: `etag-${partNumber}` };
      }),
      abort: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({
        key: "raw/upload-1.zip",
        size: rawParts.reduce((size, part) => size + part.byteLength, 0),
        uploaded: new Date(),
      })),
    };
    const binding = bucket({
      createMultipartUpload: vi.fn(async () => multipart),
      put: vi.fn(async (key, body, options) => {
        const bytes = await collect({
          async *[Symbol.asyncIterator]() {
            const reader = body.getReader();
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
        });
        writes.push({ key, body: bytes, contentType: options?.httpMetadata?.contentType });
        return { key, size: bytes.byteLength, uploaded: new Date() };
      }),
    });
    const storage = new R2ObjectStorage(binding);

    await expect(storage.writeRawZip({
      key: "raw/upload-1.zip",
      body: chunks("zip-", "content"),
      contentType: "application/zip",
    })).resolves.toEqual({
      key: "raw/upload-1.zip",
      sizeBytes: 11,
      sha256: createHash("sha256").update("zip-content").digest("hex"),
    });
    await expect(storage.writeStagingObject({
      key: "staging/attempt-1/index.html",
      body: chunks("<h1>", "ready</h1>"),
      contentType: "text/html",
    })).resolves.toEqual({ key: "staging/attempt-1/index.html", sizeBytes: 14 });

    expect(writes.map(({ key, body, contentType }) => ({
      key,
      value: new TextDecoder().decode(body),
      contentType,
    }))).toEqual([
      { key: "staging/attempt-1/index.html", value: "<h1>ready</h1>", contentType: "text/html" },
    ]);
    expect(binding.put).toHaveBeenCalledWith(
      "staging/attempt-1/index.html",
      expect.any(ReadableStream),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "text/html" },
      },
    );
    expect(new TextDecoder().decode(rawParts[0])).toBe("zip-content");
    expect(binding.createMultipartUpload).toHaveBeenCalledWith(
      "raw/upload-1.zip",
      { httpMetadata: { contentType: "application/zip" } },
    );
    expect(multipart.complete).toHaveBeenCalledWith([{ partNumber: 1, etag: "etag-1" }]);
  });

  it("streams a committed private object and preserves size and content type", async () => {
    const binding = bucket({
      get: vi.fn(async () => object("committed/version-1/index.html", "content", "text/html")),
    });
    const storage = new R2ObjectStorage(binding);

    const result = await storage.readCommittedObject("committed/version-1/index.html");

    expect(result).toMatchObject({ sizeBytes: 7, contentType: "text/html" });
    expect(new TextDecoder().decode(await collect(result.body))).toBe("content");
    expect(binding.get).toHaveBeenCalledWith("committed/version-1/index.html");
  });

  it("passes bounded byte ranges to R2 and preserves returned range metadata", async () => {
    const ranged = object("committed/version-1/video.bin", "part");
    const binding = bucket({
      get: vi.fn(async () => ({ ...ranged, range: { offset: 10, length: 4 } })),
    });
    const storage = new R2ObjectStorage(binding);

    const result = await storage.readCommittedObject(
      "committed/version-1/video.bin",
      { range: { offset: 10, length: 4 } },
    );

    expect(binding.get).toHaveBeenCalledWith(
      "committed/version-1/video.bin",
      { range: { offset: 10, length: 4 } },
    );
    expect(result.range).toEqual({ offset: 10, length: 4 });
    expect(new TextDecoder().decode(await collect(result.body))).toBe("part");
  });

  it("rejects malformed byte ranges before calling R2", async () => {
    const binding = bucket();
    const storage = new R2ObjectStorage(binding);

    await expect(storage.readCommittedObject("committed/a", { range: { offset: -1, length: 1 } }))
      .rejects.toThrow("non-negative offset");
    await expect(storage.readCommittedObject("committed/a", { range: { offset: 0, length: 0 } }))
      .rejects.toThrow("positive length");
    expect(binding.get).not.toHaveBeenCalled();
  });

  it("aborts an interrupted multipart write without completing it", async () => {
    async function* interrupted(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode("partial");
      throw new Error("source interrupted");
    }
    const multipart: R2MultipartUploadBinding = {
      uploadPart: vi.fn(async (partNumber) => ({ partNumber, etag: `etag-${partNumber}` })),
      abort: vi.fn(async () => undefined),
      complete: vi.fn(async () => ({ key: "raw/fail.zip", size: 0, uploaded: new Date() })),
    };
    const storage = new R2ObjectStorage(bucket({
      createMultipartUpload: vi.fn(async () => multipart),
    }));

    await expect(storage.writeRawZip({ key: "raw/fail.zip", body: interrupted() }))
      .rejects.toThrow("source interrupted");
    expect(multipart.abort).toHaveBeenCalledOnce();
    expect(multipart.complete).not.toHaveBeenCalled();
  });

  it("maps bounded cursor listings and idempotent key deletion", async () => {
    const uploaded = new Date("2026-07-22T00:00:00Z");
    const binding = bucket({
      list: vi.fn(async () => ({
        objects: [{ key: "raw/upload-1.zip", size: 7, uploaded }],
        truncated: true,
        cursor: "page-2",
      })),
    });
    const storage = new R2ObjectStorage(binding);

    await expect(storage.listObjects({ prefix: "raw/", limit: 25, cursor: "page-1" }))
      .resolves.toEqual({
        objects: [{ key: "raw/upload-1.zip", lastModified: uploaded }],
        nextCursor: "page-2",
      });
    await storage.deleteObject("raw/upload-1.zip");
    await storage.deleteObject("raw/upload-1.zip");

    expect(binding.list).toHaveBeenCalledWith({ prefix: "raw/", limit: 25, cursor: "page-1" });
    expect(binding.delete).toHaveBeenNthCalledWith(1, "raw/upload-1.zip");
    expect(binding.delete).toHaveBeenNthCalledWith(2, "raw/upload-1.zip");
  });

  it("removes only safe prefixes in bounded R2 pages", async () => {
    const uploaded = new Date("2026-07-22T00:00:00Z");
    const pages: R2ObjectList[] = [
      {
        objects: ["a", "b"].map((name): R2ObjectMetadata => ({
          key: `staging/attempt-1/${name}`,
          size: 1,
          uploaded,
        })),
        truncated: true,
        cursor: "page-2",
      },
      {
        objects: [{ key: "staging/attempt-1/c", size: 1, uploaded }],
        truncated: false,
      },
    ];
    const binding = bucket({ list: vi.fn(async () => pages.shift()!) });
    const storage = new R2ObjectStorage(binding);

    await expect(storage.removeStagingPrefix("staging/attempt-1/"))
      .resolves.toEqual({ deletedCount: 3 });
    expect(binding.delete).toHaveBeenNthCalledWith(1, [
      "staging/attempt-1/a",
      "staging/attempt-1/b",
    ]);
    expect(binding.delete).toHaveBeenNthCalledWith(2, ["staging/attempt-1/c"]);
    await expect(storage.removeStagingPrefix("staging/"))
      .rejects.toThrow("stay below");
    await expect(storage.removeContentBundlePrefix("staging/attempt-1/"))
      .rejects.toThrow("stay below");
  });

  it("fails closed for absent objects and malformed truncated listings", async () => {
    const storage = new R2ObjectStorage(bucket({
      list: vi.fn(async () => ({ objects: [], truncated: true })),
    }));
    await expect(storage.readCommittedObject("committed/missing"))
      .rejects.toThrow("Object not found");
    await expect(storage.listObjects({ prefix: "raw/", limit: 1 }))
      .rejects.toThrow("without a cursor");
  });

  it("refuses a concurrent blind overwrite of an immutable staging key", async () => {
    const storage = new R2ObjectStorage(bucket({ put: vi.fn(async () => null) }));

    await expect(storage.writeStagingObject({
      key: "staging/attempt-1/index.html",
      body: chunks("replacement"),
    })).rejects.toThrow("refused an overwrite");
  });
});
