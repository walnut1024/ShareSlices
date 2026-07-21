import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { executeInvocation, exitCodes, parseInvocation } from "./cli.mjs";
import { createLifecycleExecutor } from "./lifecycle.mjs";
import { lifecycleOperations } from "./target-adapter.mjs";

const configPath = "deploy/contract/fixtures/deployment.cloudflare.valid.json";
const releasePath = "deploy/contract/fixtures/release.valid.json";
const release = JSON.parse(await readFile(releasePath, "utf8"));

function adapter(overrides = {}) {
  return Object.fromEntries(lifecycleOperations.map((operation) => [
    operation,
    overrides[operation] ?? (async () => ({})),
  ]));
}

function executor(overrides = {}) {
  return createLifecycleExecutor({ cloudflare: adapter(overrides) });
}

const probe = (evidenceId) => ({ passed: true, evidenceId });
const qualifiedDatabase = {
  hyperdrive: {
    reachable: true,
    queryCacheDisabled: true,
    tlsMode: "verify-full",
    caCertificateId: "ca-region-1",
    positiveRuntimeProbe: probe("hyperdrive-positive"),
    negativeIdentityProbe: probe("hyperdrive-negative"),
  },
  requiredDirectRoles: ["migration"],
  directConnections: [{
    role: "migration",
    reachable: true,
    tlsMode: "verify-full",
    caCertificateId: "ca-region-1",
    positiveRuntimeProbe: probe("direct-positive"),
    negativeIdentityProbe: probe("direct-negative"),
  }],
};

test("doctor reports discovered references without resolving Secret values", async () => {
  let request;
  const execution = await executeInvocation(
    parseInvocation(["doctor", "--config", configPath]),
    executor({
      doctor: async (value) => {
        request = value;
        return {
          checks: [{ id: "workers-plan", state: "unavailable" }],
          database: qualifiedDatabase,
        };
      },
    }),
  );
  assert.equal(execution.exitCode, exitCodes.prerequisiteUnavailable);
  assert.equal(execution.result.outcome, "failed");
  assert.equal(execution.result.reason.code, "deployment_prerequisite_unavailable");
  assert.equal(request.prerequisites.target, "cloudflare");
  assert.ok(request.prerequisites.secretReferences.every(({ ref }) => ref.includes("://")));
  assert.deepEqual(execution.result.data.checks[0], {
    id: "workers-plan",
    state: "unavailable",
  });
});

test("Cloudflare doctor fails closed when database qualification evidence is absent", async () => {
  const execution = await executeInvocation(
    parseInvocation(["doctor", "--config", configPath]),
    executor({ doctor: async () => ({ checks: [] }) }),
  );
  assert.equal(execution.exitCode, exitCodes.prerequisiteUnavailable);
  assert.equal(execution.result.outcome, "failed");
  assert.equal(
    execution.result.data.checks.some(
      ({ reasonCode }) => reasonCode === "cloudflare_hyperdrive_origin_identity_unqualified",
    ),
    true,
  );
  assert.equal(
    execution.result.data.checks.some(
      ({ reasonCode }) => reasonCode === "cloudflare_direct_postgresql_evidence_missing",
    ),
    true,
  );
});

test("render returns a deterministic target bundle digest", async () => {
  const render = async () => ({
    schemaVersion: "shareslices.target-bundle/v1",
    target: "cloudflare",
    releaseId: release.releaseId,
    resources: [],
  });
  const first = await executeInvocation(
    parseInvocation(["render", "--config", configPath, "--release", releasePath]),
    executor({ render }),
  );
  const second = await executeInvocation(
    parseInvocation(["render", "--release", releasePath, "--config", configPath]),
    executor({ render }),
  );
  assert.equal(first.exitCode, exitCodes.succeeded);
  assert.equal(first.result.requestedRelease, release.releaseId);
  assert.equal(first.result.data.bundleDigest, second.result.data.bundleDigest);
});

test("plan binds the observed revision and refuses destructive drift", async () => {
  const execution = await executeInvocation(
    parseInvocation(["plan", "--config", configPath, "--release", releasePath]),
    executor({
      render: async () => ({ target: "cloudflare", releaseId: release.releaseId }),
      plan: async () => ({
        desired: {
          target: "cloudflare",
          releaseId: release.releaseId,
          resources: [],
        },
        observed: {
          revision: "observed-7",
          controlSchema: { state: "present", checksum: "sha256:old" },
          resources: [],
        },
        controlSchemaChecksum: "sha256:new",
      }),
    }),
  );
  assert.equal(execution.exitCode, exitCodes.refused);
  assert.equal(execution.result.outcome, "refused");
  assert.equal(execution.result.data.plan.observedStateRevision, "observed-7");
  assert.equal(execution.result.data.plan.planDigest.startsWith("sha256:"), true);
});

test("status projects provider observations through the common state model", async () => {
  const execution = await executeInvocation(
    parseInvocation(["status", "--config", configPath]),
    executor({
      status: async () => ({
        target: "cloudflare",
        desiredReleaseId: release.releaseId,
        observedReleaseId: release.releaseId,
        verification: "passed",
      }),
    }),
  );
  assert.equal(execution.exitCode, exitCodes.succeeded);
  assert.equal(execution.result.data.status.state, "verified");
});

test("fails before target access for invalid release or missing Adapter", async () => {
  const invalidRelease = await executeInvocation(
    parseInvocation(["render", "--config", configPath, "--release", configPath]),
    executor(),
  );
  assert.equal(invalidRelease.exitCode, exitCodes.invalidInput);
  assert.equal(invalidRelease.result.reason.code, "release_contract_invalid");

  const missingAdapter = await executeInvocation(
    parseInvocation(["status", "--config", configPath]),
    createLifecycleExecutor({}),
  );
  assert.equal(missingAdapter.exitCode, exitCodes.prerequisiteUnavailable);
  assert.equal(missingAdapter.result.reason.code, "deployment_target_adapter_unavailable");
});

test("rejects mismatched bundle identity and redacts unexpected Adapter errors", async () => {
  const mismatch = await executeInvocation(
    parseInvocation(["render", "--config", configPath, "--release", releasePath]),
    executor({ render: async () => ({ target: "kubernetes", releaseId: release.releaseId }) }),
  );
  assert.equal(mismatch.exitCode, exitCodes.failed);
  assert.equal(mismatch.result.reason.code, "target_bundle_identity_mismatch");

  const failed = await executeInvocation(
    parseInvocation(["status", "--config", configPath]),
    executor({ status: async () => { throw new Error("secret provider detail"); } }),
  );
  assert.equal(failed.exitCode, exitCodes.failed);
  assert.equal(failed.result.reason.code, "deployment_target_operation_failed");
  assert.equal(JSON.stringify(failed.result).includes("secret provider detail"), false);
});
