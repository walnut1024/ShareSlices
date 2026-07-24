import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const read = async (name) =>
  JSON.parse(await readFile(new URL(name, root), "utf8"));

test("keeps the version prototype disposable and route-free", async () => {
  const [baseline, candidate, verifier] = await Promise.all([
    read("wrangler.baseline.json"),
    read("wrangler.candidate.json"),
    read("wrangler.verifier.json"),
  ]);
  assert.equal(baseline.name, candidate.name);
  assert.equal(baseline.compatibility_date, "2026-07-24");
  assert.equal(candidate.compatibility_date, baseline.compatibility_date);
  assert.equal(verifier.compatibility_date, baseline.compatibility_date);
  assert.equal(baseline.workers_dev, true);
  assert.equal(candidate.workers_dev, true);
  assert.equal(verifier.workers_dev, true);
  assert.equal(baseline.preview_urls, false);
  assert.equal(candidate.preview_urls, false);
  assert.equal(verifier.preview_urls, false);
  assert.deepEqual(baseline.version_metadata, {binding: "VERSION_METADATA"});
  assert.deepEqual(candidate.version_metadata, baseline.version_metadata);
  for (const config of [baseline, candidate, verifier]) {
    assert.equal("routes" in config, false);
    assert.equal("triggers" in config, false);
  }
});

test("uses a fetch Service Binding without unrelated authority", async () => {
  const verifier = await read("wrangler.verifier.json");
  assert.deepEqual(verifier.services, [
    {
      binding: "TARGET",
      service: "shareslices-opsx-version-target-20260725",
    },
  ]);
  for (const binding of [
    "r2_buckets",
    "queues",
    "hyperdrive",
    "containers",
    "vars",
  ]) {
    assert.equal(binding in verifier, false);
  }
});
