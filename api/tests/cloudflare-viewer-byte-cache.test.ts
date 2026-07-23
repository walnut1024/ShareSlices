import { describe, expect, it, vi } from "vitest";
import type { AuthorizedViewerAsset } from "../src/application/artifacts/publication-viewer.js";
import {
  CloudflareViewerByteReader,
  type ViewerByteCache,
} from "../src/cloudflare/viewer-byte-cache.js";

async function* body(value: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(value);
}

const asset = (overrides: Partial<AuthorizedViewerAsset> = {}): AuthorizedViewerAsset => ({
  publicationId: "publication-1",
  versionId: "version-1",
  path: "assets/app.js",
  objectKey: "content-bundles/bundle-1/assets/app.js",
  sizeBytes: 5,
  contentType: "text/javascript",
  sha256: "a".repeat(64),
  ...overrides,
});

async function text(value: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of value) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function fixture() {
  const entries = new Map<string, Response>();
  const cache: ViewerByteCache = {
    match: vi.fn(async (request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request, response) => {
      entries.set(request.url, response.clone());
    }),
  };
  const storage = {
    readCommittedObject: vi.fn(async () => ({ body: body("hello") })),
  };
  const deferred: Promise<unknown>[] = [];
  const reader = new CloudflareViewerByteReader({
    storage,
    cache,
    maxAssetBytes: 1024,
    rendererRevision: "renderer-v2",
    defer: (promise) => deferred.push(promise),
  });
  return { cache, deferred, reader, storage };
}

describe("Cloudflare Viewer byte cache", () => {
  it("stores a separate cacheable full-body response and reuses it", async () => {
    const { cache, deferred, reader, storage } = fixture();
    const request = new Request("https://viewer.example/a/stable/assets/app.js");

    await expect(text(await reader.read(asset(), request))).resolves.toBe("hello");
    await Promise.all(deferred);
    await expect(text(await reader.read(asset(), request))).resolves.toBe("hello");

    expect(storage.readCommittedObject).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
    const internal = vi.mocked(cache.put).mock.calls[0]?.[1];
    expect(internal?.status).toBe(200);
    expect(internal?.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(internal?.headers.get("cache-tag")).toContain(
      "shareslices-publication-",
    );
  });

  it("keys every content and representation identity input", async () => {
    const { cache, deferred, reader } = fixture();
    const request = new Request("https://viewer.example/a/stable/assets/app.js");
    const variants = [
      asset(),
      asset({ publicationId: "publication-2" }),
      asset({ versionId: "version-2" }),
      asset({ path: "assets/other.js" }),
      asset({ sha256: "b".repeat(64) }),
      asset({ contentType: "application/javascript" }),
    ];
    for (const value of variants) {
      await text(await reader.read(value, request));
      await Promise.all(deferred.splice(0));
    }
    const keys = vi.mocked(cache.put).mock.calls.map(([key]) => key.url);
    expect(new Set(keys).size).toBe(variants.length);
    expect(keys.every((key) => key.startsWith("https://shareslices-viewer-byte-cache.invalid/"))).toBe(true);
  });

  it("bypasses Cache API for Range, oversized, and invalid or legacy digest-less assets", async () => {
    const { cache, reader, storage } = fixture();
    const range = new Request("https://viewer.example/a/stable/assets/app.js", {
      headers: { Range: "bytes=0-1" },
    });

    await text(await reader.read(asset(), range));
    await text(await reader.read(asset({ sizeBytes: 2048 }), new Request(range.url)));
    await text(await reader.read(asset({ sha256: null }), new Request(range.url)));
    await text(await reader.read(asset({ sha256: "invalid" }), new Request(range.url)));

    expect(storage.readCommittedObject).toHaveBeenCalledTimes(4);
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("falls back to private storage when a cache lookup fails", async () => {
    const { cache, deferred, reader, storage } = fixture();
    vi.mocked(cache.match).mockRejectedValueOnce(new Error("cache unavailable"));

    await expect(
      text(
        await reader.read(
          asset(),
          new Request("https://viewer.example/a/stable/assets/app.js"),
        ),
      ),
    ).resolves.toBe("hello");
    await Promise.all(deferred);

    expect(storage.readCommittedObject).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
