import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const load = async (name) => JSON.parse(
  await readFile(new URL(name, import.meta.url), "utf8"),
);

test("every Cloudflare field has one selected owner or an explicit activation block", async () => {
  const [schema, matrix] = await Promise.all([
    load("ownership.schema.json"),
    load("ownership.json"),
  ]);
  const validate = new Ajv2020({ strict: true, strictRequired: false }).compile(schema);
  assert.equal(validate(matrix), true, JSON.stringify(validate.errors));
  const required = new Set([
    "r2.bucket-resource",
    "r2.public-access",
    "queue.product-resource",
    "queue.product-consumer",
    "queue.delivery-paused",
    "cron.trigger",
    "worker.routes-domains",
    "worker.workers-dev",
    "worker.preview-urls",
    "worker.ordinary-bindings",
    "worker.secret-values",
    "worker.secret-bindings",
    "durable-object.migrations",
    "container.image-rollout",
    "deployment.postgresql-lease-journal",
    "deployment.r2-state-mirror",
    "verifier.ephemeral-resources",
  ]);
  assert.deepEqual(new Set(matrix.fields.map(({ id }) => id)), required);
  assert.equal(new Set(matrix.fields.map(({ id }) => id)).size, matrix.fields.length);
  assert.deepEqual(
    matrix.fields.filter(({ status }) => status === "unqualified").map(({ id }) => id).sort(),
    ["cron.trigger", "queue.delivery-paused", "queue.product-consumer"],
  );
});

test("Terraform and Wrangler do not own the same selected field", async () => {
  const matrix = await load("ownership.json");
  const selected = new Map();
  for (const field of matrix.fields.filter(({ status }) => status === "selected")) {
    assert.equal(selected.has(field.id), false, field.id);
    selected.set(field.id, field.owner);
  }
  assert.equal(selected.get("worker.routes-domains"), "terraform");
  assert.equal(selected.get("worker.ordinary-bindings"), "wrangler");
  assert.equal(selected.get("worker.secret-values"), "operator-secret-source");
});
