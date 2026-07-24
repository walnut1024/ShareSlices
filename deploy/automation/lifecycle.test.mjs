import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {sha256Digest} from "./canonical.mjs";
import { executeInvocation, exitCodes, parseInvocation } from "./cli.mjs";
import { createLifecycleExecutor } from "./lifecycle.mjs";
import {serializeCanonicalTargetBundle} from "./release.mjs";
import { lifecycleOperations, TargetAdapterError } from "./target-adapter.mjs";

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

test("doctor optionally loads and forwards an immutable release for artifact checks", async () => {
  let request;
  const execution = await executeInvocation(
    parseInvocation(["doctor", "--config", configPath, "--release", releasePath]),
    executor({
      doctor: async (value) => {
        request = value;
        return {checks: [], database: qualifiedDatabase};
      },
    }),
  );
  assert.equal(execution.exitCode, exitCodes.succeeded);
  assert.equal(request.release.releaseId, release.releaseId);
  assert.equal(execution.result.requestedRelease, release.releaseId);
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
      plan: async ({bundleDigest}) => ({
        desired: {
          target: "cloudflare",
          releaseId: release.releaseId,
          bundleDigest,
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

test("plan carries an explicit rollback operation into the authorized digest", async () => {
  let requestedOperation;
  const execution = await executeInvocation(
    parseInvocation(["plan", "--config", configPath, "--release", releasePath, "--operation", "rollback"]),
    executor({
      render: async () => ({target: "cloudflare", releaseId: release.releaseId}),
      plan: async ({bundleDigest, operation}) => {
        requestedOperation = operation;
        return {
          desired: {target: "cloudflare", releaseId: release.releaseId, bundleDigest, resources: []},
          observed: {
            revision: "observed-rollback-1",
            controlSchema: {state: "present", checksum: sha256Digest("control")},
            resources: [],
          },
          controlSchemaChecksum: sha256Digest("control"),
        };
      },
    }),
  );
  assert.equal(execution.exitCode, exitCodes.succeeded);
  assert.equal(requestedOperation, "rollback");
  assert.equal(execution.result.data.plan.operation, "rollback");
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
  assert.equal(
    execution.result.data.telemetry.schemaVersion,
    "shareslices.deployment-telemetry-bundle/v1",
  );
  assert.deepEqual(
    execution.result.data.telemetry.records.map(({eventName}) => eventName),
    [
      "shareslices.deployment.deployment-operation",
      "shareslices.deployment.migration",
      "shareslices.deployment.jobs",
      "shareslices.deployment.queue",
      "shareslices.deployment.trigger",
      "shareslices.deployment.container",
      "shareslices.deployment.database",
      "shareslices.deployment.r2",
      "shareslices.deployment.resend",
      "shareslices.deployment.provider-limit",
      "shareslices.deployment.cost-risk",
    ],
  );
});

test("verify exposes read-only core evidence and fails closed on a required check", async () => {
  const passed = await executeInvocation(
    parseInvocation(["verify", "--config", configPath]),
    executor({verify: async () => ({level: "core", outcome: "passed", checks: [{id: "health", outcome: "passed"}]})}),
  );
  assert.equal(passed.exitCode, exitCodes.succeeded);
  assert.equal(passed.result.data.verification.level, "core");

  const failed = await executeInvocation(
    parseInvocation(["verify", "--config", configPath]),
    executor({verify: async () => ({level: "core", outcome: "failed", checks: [{id: "health", outcome: "failed"}]})}),
  );
  assert.equal(failed.exitCode, exitCodes.failed);
  assert.equal(failed.result.reason.code, "required_check_failed");
});

test("apply accepts only a digest-bound plan for the rendered target bundle", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shareslices-plan-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const bundle = {target: "cloudflare", releaseId: release.releaseId, resources: []};
  const body = {
    schemaVersion: "shareslices.deployment-plan/v1",
    operation: "apply",
    target: "cloudflare",
    releaseId: release.releaseId,
    bundleDigest: serializeCanonicalTargetBundle(bundle).digest,
    observedStateRevision: "observed-1",
    firstInstallation: false,
    actions: [],
    outcome: "ready",
    refusalReasons: [],
  };
  const plan = {...body, planDigest: sha256Digest(body)};
  const planPath = path.join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify(plan));
  let request;
  const execution = await executeInvocation(
    parseInvocation(["apply", "--config", configPath, "--release", releasePath, "--plan", planPath]),
    executor({
      render: async () => bundle,
      apply: async (value) => {
        request = value;
        return {outcome: "succeeded", phases: []};
      },
    }),
  );
  assert.equal(execution.exitCode, exitCodes.succeeded);
  assert.equal(request.authorizedPlanDigest, plan.planDigest);
  assert.equal(execution.result.data.bundleDigest, body.bundleDigest);
});

test("rollback requires an explicit release and authorized rollback plan while preserving outcomes", async (context) => {
  const missing = await executeInvocation(
    parseInvocation(["rollback", "--config", configPath]),
    executor(),
  );
  assert.equal(missing.exitCode, exitCodes.invalidInput);
  assert.equal(missing.result.reason.code, "rollback_release_required");

  const directory = await mkdtemp(path.join(tmpdir(), "shareslices-rollback-plan-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const bundle = {target: "cloudflare", releaseId: release.releaseId, resources: []};
  const body = {
    schemaVersion: "shareslices.deployment-plan/v1",
    operation: "rollback",
    target: "cloudflare",
    releaseId: release.releaseId,
    bundleDigest: serializeCanonicalTargetBundle(bundle).digest,
    observedStateRevision: "observed-1",
    firstInstallation: false,
    actions: [],
    outcome: "ready",
    refusalReasons: [],
  };
  const plan = {...body, planDigest: sha256Digest(body)};
  const planPath = path.join(directory, "plan.json");
  await writeFile(planPath, JSON.stringify(plan));
  const rollbackExecutor = (result) => executor({
    render: async () => bundle,
    rollback: async () => result,
  });

  const refused = await executeInvocation(
    parseInvocation(["rollback", "--config", configPath, "--release", releasePath, "--plan", planPath]),
    rollbackExecutor({outcome: "refused", refusalReasons: ["rollback_schema_incompatible"]}),
  );
  assert.equal(refused.exitCode, exitCodes.refused);
  assert.equal(refused.result.reason.code, "rollback_schema_incompatible");

  const handedOff = await executeInvocation(
    parseInvocation(["rollback", "--config", configPath, "--release", releasePath, "--plan", planPath]),
    rollbackExecutor({outcome: "external_reconciler_required", phases: []}),
  );
  assert.equal(handedOff.exitCode, exitCodes.externalReconcilerRequired);
  assert.equal(handedOff.result.reason.code, "external_reconciler_required");
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

test("preserves stable target Adapter reason codes while redacting unexpected failures", async () => {
  const stable = await executeInvocation(
    parseInvocation(["render", "--config", configPath, "--release", releasePath]),
    executor({
      render: async () => {
        throw new TargetAdapterError(
          "cloudflare_provider_conflict",
          "Provider ownership conflicts with the selected field owner.",
        );
      },
    }),
  );
  assert.equal(stable.result.reason.code, "cloudflare_provider_conflict");
  assert.match(stable.result.reason.message, /ownership conflicts/);

  const unexpected = await executeInvocation(
    parseInvocation(["render", "--config", configPath, "--release", releasePath]),
    executor({render: async () => { throw new Error("secret provider detail"); }}),
  );
  assert.equal(unexpected.result.reason.code, "deployment_target_operation_failed");
  assert.doesNotMatch(unexpected.result.reason.message, /secret provider detail/);
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
