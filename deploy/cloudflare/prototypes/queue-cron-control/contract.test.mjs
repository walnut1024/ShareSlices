import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const read = async (name) =>
  JSON.parse(await readFile(new URL(name, root), "utf8"));

test("keeps the control-plane prototype private and trigger-explicit", async () => {
  const [detached, attached] = await Promise.all([
    read("wrangler.detached.json"),
    read("wrangler.attached.json"),
  ]);
  assert.equal(detached.name, attached.name);
  assert.equal(detached.workers_dev, false);
  assert.equal(attached.workers_dev, false);
  assert.equal(detached.preview_urls, false);
  assert.equal(attached.preview_urls, false);
  assert.deepEqual(detached.triggers.crons, []);
  assert.deepEqual(attached.triggers.crons, ["17 4 1 1 *"]);
  assert.equal("routes" in detached || "routes" in attached, false);
});

test("does not grant the disposable consumer unrelated bindings", async () => {
  const detached = await read("wrangler.detached.json");
  for (const binding of [
    "services",
    "r2_buckets",
    "queues",
    "hyperdrive",
    "containers",
    "vars",
  ]) {
    assert.equal(binding in detached, false);
  }
});
