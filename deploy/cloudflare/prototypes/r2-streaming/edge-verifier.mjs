import assert from "node:assert/strict";

const chunkSize = 64 * 1024;

function patternedBody(size, startOffset = 0) {
  const stream = new FixedLengthStream(size);
  const writer = stream.writable.getWriter();
  const completion = (async () => {
    let emitted = 0;
    while (emitted < size) {
      const length = Math.min(chunkSize, size - emitted);
      const chunk = new Uint8Array(length);
      chunk.fill(Math.floor((startOffset + emitted) / chunkSize) % 251);
      await writer.write(chunk);
      emitted += length;
    }
    await writer.close();
  })();
  return { body: stream.readable, completion };
}

async function assertPattern(response, expectedSize, startOffset = 0) {
  assert.ok(response.body);
  const reader = response.body.getReader();
  let received = 0;
  let maximumChunk = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    maximumChunk = Math.max(maximumChunk, value.byteLength);
    const samples = new Set([0, Math.floor(value.byteLength / 2), value.byteLength - 1]);
    const absoluteStart = startOffset + received;
    const nextBoundary = Math.ceil((absoluteStart + 1) / chunkSize) * chunkSize;
    if (nextBoundary < absoluteStart + value.byteLength) {
      samples.add(nextBoundary - absoluteStart - 1);
      samples.add(nextBoundary - absoluteStart);
    }
    for (const index of samples) {
      const absolute = absoluteStart + index;
      assert.equal(value[index], Math.floor(absolute / chunkSize) % 251);
    }
    received += value.byteLength;
  }
  assert.equal(received, expectedSize);
  return maximumChunk;
}

function call(env, path, init = {}) {
  return env.STORAGE.fetch(`https://storage.internal${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.PROBE_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
}

async function verify(env) {
  const prefix = `feasibility/${crypto.randomUUID()}`;
  const uploadKey = `${prefix}/upload.bin`;
  const multipartKey = `${prefix}/multipart.bin`;
  const uploadSize = 6 * 1024 * 1024 + 19;
  const multipartSizes = [5 * 1024 * 1024, 1024 * 1024 + 7];
  const keys = [uploadKey, multipartKey];

  try {
    const uploadBody = patternedBody(uploadSize);
    const [uploadResponse] = await Promise.all([
      call(env, `/upload/${encodeURIComponent(uploadKey)}`, {
        method: "PUT",
        body: uploadBody.body,
      }),
      uploadBody.completion,
    ]);
    assert.equal(uploadResponse.status, 200);
    assert.equal((await uploadResponse.json()).size, uploadSize);

    const downloadResponse = await call(env, `/download/${encodeURIComponent(uploadKey)}`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(Number(downloadResponse.headers.get("content-length")), uploadSize);
    const downloadMaximumChunk = await assertPattern(downloadResponse, uploadSize);

    const rangeOffset = 3 * 1024 * 1024 + 11;
    const rangeLength = 4096;
    const rangeResponse = await call(env, `/download/${encodeURIComponent(uploadKey)}`, {
      headers: { Range: `bytes=${rangeOffset}-${rangeOffset + rangeLength - 1}` },
    });
    assert.equal(rangeResponse.status, 206);
    assert.match(rangeResponse.headers.get("content-range") ?? "", /^bytes /);
    await assertPattern(rangeResponse, rangeLength, rangeOffset);

    const exportResponse = await call(env, `/export/${encodeURIComponent(uploadKey)}`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get("content-disposition") ?? "", /^attachment;/);
    const exportMaximumChunk = await assertPattern(exportResponse, uploadSize);

    const startResponse = await call(env, `/multipart/start/${encodeURIComponent(multipartKey)}`, {
      method: "POST",
    });
    assert.equal(startResponse.status, 200);
    const { uploadId } = await startResponse.json();
    const parts = [];
    let partOffset = 0;
    for (let index = 0; index < multipartSizes.length; index += 1) {
      const size = multipartSizes[index];
      const partBody = patternedBody(size, partOffset);
      const [partResponse] = await Promise.all([
        call(
          env,
          `/multipart/part/${encodeURIComponent(multipartKey)}?uploadId=${encodeURIComponent(uploadId)}&partNumber=${index + 1}`,
          { method: "PUT", body: partBody.body },
        ),
        partBody.completion,
      ]);
      assert.equal(partResponse.status, 200);
      parts.push(await partResponse.json());
      partOffset += size;
    }
    const completeResponse = await call(
      env,
      `/multipart/complete/${encodeURIComponent(multipartKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, parts }),
      },
    );
    assert.equal(completeResponse.status, 200);
    assert.equal((await completeResponse.json()).size, partOffset);

    const multipartResponse = await call(env, `/download/${encodeURIComponent(multipartKey)}`);
    assert.equal(multipartResponse.status, 200);
    const multipartMaximumChunk = await assertPattern(multipartResponse, partOffset);

    return {
      upload: { bytes: uploadSize, streaming: "passed" },
      download: { bytes: uploadSize, maximumObservedChunk: downloadMaximumChunk },
      export: { bytes: uploadSize, maximumObservedChunk: exportMaximumChunk },
      range: { offset: rangeOffset, bytes: rangeLength, status: 206 },
      multipart: {
        bytes: partOffset,
        parts: multipartSizes.length,
        maximumObservedChunk: multipartMaximumChunk,
      },
      bucketExposure: "binding_only",
    };
  } finally {
    const cleanupResponse = await call(env, "/cleanup", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    assert.equal(cleanupResponse.status, 200);
    assert.deepEqual(await cleanupResponse.json(), { deleted: keys.length });
    const prefixCleanupResponse = await call(
      env,
      "/cleanup-prefix?prefix=feasibility%2F",
      { method: "DELETE" },
    );
    assert.equal(prefixCleanupResponse.status, 200);
  }
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(
      verify(env).then((evidence) =>
        console.log(JSON.stringify({ event: "r2_streaming_verified", evidence })),
      ),
    );
  },
};
