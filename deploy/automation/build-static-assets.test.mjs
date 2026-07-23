import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { buildStaticAssets } from "./build-static-assets.mjs";

test("builds one environment-neutral deterministic Static Assets artifact", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-static-assets-"));
  const first = resolve(root, "first");
  const second = resolve(root, "second");
  try {
    const firstManifest = await buildStaticAssets(first);
    const secondManifest = await buildStaticAssets(second);
    assert.deepEqual(secondManifest, firstManifest);
    assert.match(firstManifest.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(firstManifest.entries.some(({ path }) => path === "index.html"));
    assert.ok(firstManifest.entries.some(({ path }) => /^assets\/.+/.test(path)));
    for (const entry of firstManifest.entries) {
      const firstBytes = await readFile(resolve(first, entry.path));
      const secondBytes = await readFile(resolve(second, entry.path));
      assert.deepEqual(secondBytes, firstBytes);
      const text = firstBytes.toString("utf8");
      assert.equal(text.includes("BETTER_AUTH_SECRET"), false);
      assert.equal(text.includes("http://127.0.0.1:7456"), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
