import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(
  await readFile(new URL("./wrangler.json", import.meta.url), "utf8"),
);

test("isolates the exports compatibility probe from product authority", () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.exports, {
    ProbeObject: {type: "durable-object", storage: "sqlite"},
  });
  assert.equal("migrations" in config, false);
  for (const binding of [
    "routes",
    "triggers",
    "services",
    "r2_buckets",
    "queues",
    "hyperdrive",
    "containers",
    "vars",
    "secrets",
  ]) {
    assert.equal(binding in config, false);
  }
});
