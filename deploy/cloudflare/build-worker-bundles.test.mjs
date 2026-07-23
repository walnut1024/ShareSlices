import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { buildCloudflareWorkerBundles } from "./build-worker-bundles.mjs";

test("builds deterministic App, Content, and Jobs Worker bundles", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-worker-bundles-"));
  const first = resolve(root, "first");
  const second = resolve(root, "second");
  try {
    const firstManifest = await buildCloudflareWorkerBundles(first);
    const secondManifest = await buildCloudflareWorkerBundles(second);
    assert.deepEqual(secondManifest, firstManifest);
    assert.equal(firstManifest.wranglerVersion, "4.112.0");
    assert.equal(firstManifest.compatibilityDate, "2026-07-19");
    assert.deepEqual(firstManifest.compatibilityFlags, ["nodejs_compat"]);
    assert.deepEqual(
      firstManifest.artifacts.map(({ role }) => role),
      ["app", "content", "jobs"],
    );
    assert.deepEqual(
      firstManifest.artifacts.map(({ name }) => name),
      ["app-worker-bundle", "content-worker-bundle", "jobs-worker-bundle"],
    );
    for (const artifact of firstManifest.artifacts) {
      assert.match(artifact.contentDigest, /^sha256:[a-f0-9]{64}$/);
      assert.ok(artifact.bytes > 0);
      assert.deepEqual(
        await readFile(resolve(first, artifact.file)),
        await readFile(resolve(second, artifact.file)),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to mix a new build with existing output", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-worker-bundles-"));
  try {
    await buildCloudflareWorkerBundles(root);
    await assert.rejects(
      buildCloudflareWorkerBundles(root),
      /cloudflare_worker_output_not_empty/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
