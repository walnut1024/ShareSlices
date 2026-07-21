import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  affectedSecretConsumers,
  parseSecretReference,
  planSharedSigningKeyRotation,
  redactSecretMaterial,
  withResolvedSecret,
} from "./secrets.mjs";

test("parses logical references without resolving their values", () => {
  assert.deepEqual(
    parseSecretReference({ ref: "kubernetes-secret://shareslices/database", revision: "db-4" }),
    {
      scheme: "kubernetes-secret",
      logicalPath: "shareslices/database",
      revision: "db-4",
    },
  );
  assert.throws(() => parseSecretReference({ ref: "postgres://password@example", revision: "1" }));
});

test("resolves a Secret only inside the consuming operation", async () => {
  const calls = [];
  const result = await withResolvedSecret(
    { ref: "cloudflare-secret://app/database", revision: "db-2" },
    {
      "cloudflare-secret": async (reference) => {
        calls.push({ stage: "resolve", reference });
        return "sensitive-value";
      },
    },
    async (value, reference) => {
      calls.push({ stage: "consume", value, reference });
      return "used";
    },
  );
  assert.equal(result, "used");
  assert.deepEqual(calls.map(({ stage }) => stage), ["resolve", "consume"]);
});

test("recursively redacts values and common value-derived fingerprints", () => {
  const secret = "sensitive-value";
  const digest = createHash("sha256").update(secret).digest("hex");
  assert.deepEqual(
    redactSecretMaterial({ message: `failed for ${secret}`, nested: [`sha256:${digest}`] }, [secret]),
    { message: "failed for [REDACTED]", nested: ["[REDACTED]"] },
  );
});

test("selects only consumers bound to changed non-secret revisions", () => {
  const consumers = affectedSecretConsumers(
    [{ logicalId: "database", revision: "1" }, { logicalId: "smtp", revision: "1" }],
    [{ logicalId: "database", revision: "2" }, { logicalId: "smtp", revision: "1" }],
    [
      { logicalId: "database", consumers: ["api", "maintenance", "worker"] },
      { logicalId: "smtp", consumers: ["maintenance"] },
    ],
  );
  assert.deepEqual(consumers, ["api", "maintenance", "worker"]);
});

test("stages shared signing-key rotation and refuses missing overlap", () => {
  assert.deepEqual(
    planSharedSigningKeyRotation({
      oldRevision: "signing-1",
      newRevision: "signing-2",
      overlapSupported: true,
      maximumLifetimeSeconds: 3600,
    }).phases,
    [
      { action: "verify", revisions: ["signing-1", "signing-2"] },
      { action: "sign", revision: "signing-2" },
      { action: "retire_verification", revision: "signing-1", notBeforeSeconds: 3600 },
    ],
  );
  assert.equal(
    planSharedSigningKeyRotation({
      oldRevision: "signing-1",
      newRevision: "signing-2",
      overlapSupported: false,
      maximumLifetimeSeconds: 3600,
    }).kind,
    "refused",
  );
});
