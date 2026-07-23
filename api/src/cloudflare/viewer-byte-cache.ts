import { createHash } from "node:crypto";
import type { AuthorizedViewerAsset } from "../application/artifacts/publication-viewer.js";
import type { ObjectBody, ObjectStorage } from "../storage/object-storage.js";

export type ViewerByteCache = Readonly<{
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}>;

type ViewerByteCacheInput = Readonly<{
  storage: Pick<ObjectStorage, "readCommittedObject">;
  cache: ViewerByteCache;
  maxAssetBytes: number;
  rendererRevision: string;
  defer(promise: Promise<unknown>): void;
}>;

const identityEncoding = "identity";

function bodyFromResponse(response: Response): ObjectBody {
  const reader = response.body?.getReader();
  return {
    async *[Symbol.asyncIterator]() {
      if (!reader) return;
      let completed = false;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) {
            completed = true;
            return;
          }
          yield result.value;
        }
      } finally {
        if (!completed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
}

async function collect(body: ObjectBody, expectedBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.byteLength;
    if (length > expectedBytes) {
      throw new Error("viewer_byte_cache_object_size_mismatch");
    }
    chunks.push(chunk);
  }
  if (length !== expectedBytes) {
    throw new Error("viewer_byte_cache_object_size_mismatch");
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function cacheIdentity(asset: AuthorizedViewerAsset, rendererRevision: string): string {
  const representation = JSON.stringify({
    publicationId: asset.publicationId,
    versionId: asset.versionId,
    path: asset.path,
    contentDigest: asset.sha256,
    contentType: asset.contentType,
    contentEncoding: identityEncoding,
    rendererRevision,
  });
  return createHash("sha256").update(representation).digest("hex");
}

function cacheTag(kind: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex");
  return `shareslices-${kind}-${digest}`;
}

export class CloudflareViewerByteReader {
  constructor(private readonly input: ViewerByteCacheInput) {
    if (!Number.isSafeInteger(input.maxAssetBytes) || input.maxAssetBytes <= 0) {
      throw new Error("viewer_byte_cache_max_asset_bytes_invalid");
    }
    if (!input.rendererRevision) {
      throw new Error("viewer_byte_cache_renderer_revision_missing");
    }
  }

  async read(asset: AuthorizedViewerAsset, request: Request): Promise<ObjectBody> {
    if (
      request.headers.has("range") ||
      !asset.sha256?.match(/^[a-f0-9]{64}$/) ||
      !Number.isSafeInteger(asset.sizeBytes) ||
      asset.sizeBytes < 0 ||
      asset.sizeBytes > this.input.maxAssetBytes
    ) {
      return (await this.input.storage.readCommittedObject(asset.objectKey)).body;
    }

    const key = new Request(
      `https://shareslices-viewer-byte-cache.invalid/v1/${cacheIdentity(asset, this.input.rendererRevision)}`,
      { method: "GET" },
    );
    const hit = await this.input.cache.match(key).catch(() => undefined);
    if (hit?.status === 200 && hit.body) {
      return bodyFromResponse(hit);
    }

    const object = await this.input.storage.readCommittedObject(asset.objectKey);
    const bytes = await collect(object.body, asset.sizeBytes);
    const internal = new Response(bytes.slice(), {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Cache-Tag": [
          cacheTag("publication", asset.publicationId),
          cacheTag("version", asset.versionId),
        ].join(","),
        "Content-Encoding": identityEncoding,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": asset.contentType,
        ETag: `"sha256-${asset.sha256}"`,
      },
    });
    this.input.defer(this.input.cache.put(key, internal).catch(() => undefined));
    return {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      },
    };
  }
}
