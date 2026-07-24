import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("./wrangler.json", import.meta.url), "utf8"),
);

test("keeps the disposable Secret probe narrowly scoped", () => {
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.version_metadata, {binding: "VERSION_METADATA"});
  for (const binding of [
    "routes",
    "triggers",
    "services",
    "r2_buckets",
    "queues",
    "hyperdrive",
    "containers",
    "vars",
  ]) {
    assert.equal(binding in config, false);
  }
});
