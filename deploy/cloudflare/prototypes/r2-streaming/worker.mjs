const notFound = () =>
  Response.json({ error: { code: "not_found", message: "Not found." } }, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

async function authorized(request, env) {
  const presented = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.PROBE_TOKEN}`;
  const encode = (value) => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(presented)),
    crypto.subtle.digest("SHA-256", encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function keyFrom(pathname, prefix) {
  return decodeURIComponent(pathname.slice(prefix.length));
}

async function streamObject(bucket, key, options, disposition) {
  const object = await bucket.get(key, options);
  if (!object || !object.body) return notFound();
  const ranged = options?.range !== undefined;
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Length": String(ranged ? object.range.length : object.size),
    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
  });
  if (disposition) headers.set("Content-Disposition", disposition);
  if (ranged) {
    const offset = object.range.offset ?? 0;
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + object.range.length - 1}/${object.size}`,
    );
  }
  return new Response(object.body, { status: ranged ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    if (!(await authorized(request, env))) return notFound();
    const url = new URL(request.url);

    if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
      if (!request.body) return new Response("Missing body", { status: 400 });
      const key = keyFrom(url.pathname, "/upload/");
      const object = await env.BUCKET.put(key, request.body, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      return Response.json({ key: object.key, size: object.size });
    }

    if (request.method === "GET" && url.pathname.startsWith("/download/")) {
      const key = keyFrom(url.pathname, "/download/");
      const rangeHeader = request.headers.get("range");
      if (!rangeHeader) return streamObject(env.BUCKET, key);
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) return new Response("Unsupported range", { status: 416 });
      const offset = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || end < offset) {
        return new Response("Unsupported range", { status: 416 });
      }
      return streamObject(env.BUCKET, key, { range: { offset, length: end - offset + 1 } });
    }

    if (request.method === "GET" && url.pathname.startsWith("/export/")) {
      const key = keyFrom(url.pathname, "/export/");
      return streamObject(env.BUCKET, key, undefined, 'attachment; filename="artifact-export.bin"');
    }

    if (request.method === "POST" && url.pathname.startsWith("/multipart/start/")) {
      const key = keyFrom(url.pathname, "/multipart/start/");
      const upload = await env.BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      return Response.json({ key: upload.key, uploadId: upload.uploadId });
    }

    if (request.method === "PUT" && url.pathname.startsWith("/multipart/part/")) {
      if (!request.body) return new Response("Missing body", { status: 400 });
      const key = keyFrom(url.pathname, "/multipart/part/");
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const partNumber = Number(url.searchParams.get("partNumber"));
      const upload = env.BUCKET.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return Response.json({ partNumber: part.partNumber, etag: part.etag });
    }

    if (request.method === "POST" && url.pathname.startsWith("/multipart/complete/")) {
      const key = keyFrom(url.pathname, "/multipart/complete/");
      const { uploadId, parts } = await request.json();
      const upload = env.BUCKET.resumeMultipartUpload(key, uploadId);
      const object = await upload.complete(parts);
      return Response.json({ key: object.key, size: object.size });
    }

    if (request.method === "DELETE" && url.pathname === "/cleanup") {
      const { keys } = await request.json();
      await env.BUCKET.delete(keys);
      return Response.json({ deleted: keys.length });
    }

    if (request.method === "DELETE" && url.pathname === "/cleanup-prefix") {
      const prefix = url.searchParams.get("prefix") ?? "";
      let cursor;
      let deleted = 0;
      do {
        const page = await env.BUCKET.list({ prefix, cursor });
        const keys = page.objects.map((object) => object.key);
        if (keys.length > 0) {
          await env.BUCKET.delete(keys);
          deleted += keys.length;
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return Response.json({ deleted });
    }

    return notFound();
  },
};
