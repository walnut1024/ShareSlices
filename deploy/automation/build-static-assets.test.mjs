import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { buildStaticAssets } from "./build-static-assets.mjs";

test("builds one environment-neutral deterministic Static Assets artifact", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-static-assets-"));
  const first = resolve(root, "first");
  const second = resolve(root, "second");
  const firstManifestPath = resolve(root, "evidence/first.json");
  const secondManifestPath = resolve(root, "evidence/second.json");
  try {
    const firstManifest = await buildStaticAssets(first, firstManifestPath);
    const secondManifest = await buildStaticAssets(second, secondManifestPath);
    assert.deepEqual(secondManifest, firstManifest);
    assert.match(firstManifest.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(firstManifest.entries.some(({ path }) => path === "index.html"));
    assert.ok(firstManifest.entries.some(({ path }) => path === "_headers"));
    assert.ok(firstManifest.entries.some(({ path }) => /^assets\/.+/.test(path)));
    assert.equal(
      firstManifest.entries.some(({ path }) =>
        path.endsWith("static-assets-manifest.json"),
      ),
      false,
    );
    await assert.rejects(access(resolve(first, "static-assets-manifest.json")));
    assert.deepEqual(
      JSON.parse(await readFile(firstManifestPath, "utf8")),
      firstManifest,
    );
    assert.equal(
      await readFile(resolve(first, "_headers"), "utf8"),
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/\n  Cache-Control: public, max-age=0, must-revalidate\n\n/index.html\n  Cache-Control: public, max-age=0, must-revalidate\n",
    );
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

test("refuses to place private build evidence in the deployable asset tree", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-static-assets-"));
  const output = resolve(root, "assets");
  try {
    await assert.rejects(
      buildStaticAssets(output, resolve(output, "static-assets-manifest.json")),
      /static_assets_manifest_must_be_private/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
