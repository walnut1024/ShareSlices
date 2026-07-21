import assert from "node:assert/strict";
import test from "node:test";

import { buildDeploymentPlan } from "./plan.mjs";

const checksum = `sha256:${"c".repeat(64)}`;
const desired = {
  target: "kubernetes",
  releaseId: `sha256:${"a".repeat(64)}`,
  bundleDigest: `sha256:${"b".repeat(64)}`,
  resources: [
    {
      logicalId: "database/external",
      phase: "prerequisites",
      digest: "external-1",
      owner: "external-prerequisite",
      durable: true,
    },
    { logicalId: "migration/0030", phase: "migration", digest: "migration-1" },
    { logicalId: "runtime/api", phase: "public-runtime", digest: "api-2", securitySensitive: true },
  ],
};

test("requires the plan to bind a canonical target bundle digest", () => {
  const unbound = structuredClone(desired);
  delete unbound.bundleDigest;
  assert.throws(
    () => buildDeploymentPlan({
      desired: unbound,
      observed: {
        revision: "observed-0",
        controlSchema: {state: "absent"},
        resources: [],
      },
      controlSchemaChecksum: checksum,
    }),
    /canonical target bundle digest/,
  );
});

test("includes the one permitted first-install control-schema bootstrap", () => {
  const plan = buildDeploymentPlan({
    desired,
    observed: {
      revision: "absent:1",
      controlSchema: { state: "absent" },
      resources: [{
        logicalId: "database/external",
        digest: "external-1",
        owner: "external-prerequisite",
        retention: "external",
      }],
    },
    controlSchemaChecksum: checksum,
  });
  assert.equal(plan.firstInstallation, true);
  assert.deepEqual(plan.actions[0], {
    logicalId: "deployment-control/schema",
    phase: "control",
    action: "bootstrap",
    desiredDigest: checksum,
    observedDigest: null,
    securitySensitive: true,
    destructive: false,
  });
  assert.equal(plan.outcome, "ready");
});

test("orders drift by phase and records replacements and security-sensitive changes", () => {
  const replacementDesired = structuredClone(desired);
  replacementDesired.resources[2].replacement = true;
  const plan = buildDeploymentPlan({
    desired: replacementDesired,
    observed: {
      revision: "observed-7",
      controlSchema: { state: "present", checksum },
      resources: [
        { logicalId: "database/external", digest: "external-1", owner: "external-prerequisite", retention: "external" },
        { logicalId: "runtime/api", digest: "api-1", owner: "deployment-module", retention: "active" },
        { logicalId: "migration/0030", digest: "migration-1", owner: "deployment-module", retention: "active" },
        { logicalId: "old/workload", digest: "old-1", owner: "deployment-module", retention: "active" },
      ],
    },
    controlSchemaChecksum: checksum,
  });
  assert.deepEqual(plan.actions.map(({ phase }) => phase), [
    "prerequisites",
    "migration",
    "public-runtime",
    "retirement",
  ]);
  const runtime = plan.actions.find(({ logicalId }) => logicalId === "runtime/api");
  assert.equal(runtime.action, "replace");
  assert.equal(runtime.securitySensitive, true);
  assert.equal(plan.actions.at(-1).action, "retire");
});

test("refuses control-schema mismatch and external prerequisite drift", () => {
  const destructive = structuredClone(desired);
  destructive.resources[0].replacement = true;
  const plan = buildDeploymentPlan({
    desired: destructive,
    observed: {
      revision: "observed-8",
      controlSchema: { state: "present", checksum: `sha256:${"d".repeat(64)}` },
      resources: [{
        logicalId: "database/external",
        digest: "external-0",
        owner: "external-prerequisite",
        retention: "external",
      }],
    },
    controlSchemaChecksum: checksum,
  });
  assert.equal(plan.outcome, "refused");
  assert.deepEqual(plan.refusalReasons, [
    "deployment_control_schema_mismatch",
    "deployment_prerequisite_drift",
    "destructive_change_requires_review",
  ]);
});

test("reports external prerequisites without proposing provider mutation", () => {
  const missing = buildDeploymentPlan({
    desired,
    observed: {
      revision: "observed-9",
      controlSchema: { state: "present", checksum },
      resources: [],
    },
    controlSchemaChecksum: checksum,
  });
  const missingDatabase = missing.actions.find(({ logicalId }) => logicalId === "database/external");
  assert.equal(missingDatabase.action, "prerequisite_missing");
  assert.equal(missingDatabase.destructive, false);
  assert.equal(missing.outcome, "refused");
  assert.deepEqual(missing.refusalReasons, ["deployment_prerequisite_unavailable"]);

  const drifted = buildDeploymentPlan({
    desired,
    observed: {
      revision: "observed-10",
      controlSchema: { state: "present", checksum },
      resources: [{
        logicalId: "database/external",
        digest: "external-0",
        owner: "external-prerequisite",
        retention: "external",
      }],
    },
    controlSchemaChecksum: checksum,
  });
  assert.equal(
    drifted.actions.find(({ logicalId }) => logicalId === "database/external").action,
    "prerequisite_drift",
  );
  assert.deepEqual(drifted.refusalReasons, ["deployment_prerequisite_drift"]);
});

test("refuses replacement of a deployment-owned durable resource", () => {
  const durableDesired = structuredClone(desired);
  durableDesired.resources.push({
    logicalId: "runtime/stateful",
    phase: "private-runtime",
    digest: "stateful-2",
    durable: true,
    replacement: true,
  });
  const plan = buildDeploymentPlan({
    desired: durableDesired,
    observed: {
      revision: "observed-11",
      controlSchema: { state: "present", checksum },
      resources: [
        {
          logicalId: "database/external",
          digest: "external-1",
          owner: "external-prerequisite",
          retention: "external",
        },
        {
          logicalId: "runtime/stateful",
          digest: "stateful-1",
          owner: "deployment-module",
          retention: "durable",
        },
      ],
    },
    controlSchemaChecksum: checksum,
  });
  const replacement = plan.actions.find(({ logicalId }) => logicalId === "runtime/stateful");
  assert.equal(replacement.action, "replace");
  assert.equal(replacement.destructive, true);
  assert.deepEqual(plan.refusalReasons, ["destructive_change_requires_review"]);
});

test("retains rollback resources without making an ordinary plan destructive", () => {
  const plan = buildDeploymentPlan({
    desired,
    observed: {
      revision: "observed-rollback-retained",
      controlSchema: {state: "present", checksum},
      resources: [
        {
          logicalId: "database/external",
          digest: "external-1",
          owner: "external-prerequisite",
          retention: "external",
        },
        {
          logicalId: "runtime/previous-api",
          digest: "api-previous",
          owner: "deployment-module",
          retention: "rollback",
        },
      ],
    },
    controlSchemaChecksum: checksum,
  });
  const retained = plan.actions.find(({logicalId}) => logicalId === "runtime/previous-api");
  assert.equal(retained.action, "retain");
  assert.equal(retained.destructive, false);
  assert.equal(plan.outcome, "ready");
  assert.deepEqual(plan.refusalReasons, []);
});

test("plan digest binds the exact observed revision and is deterministic", () => {
  const input = {
    desired,
    observed: { revision: "observed-9", controlSchema: { state: "present", checksum }, resources: [] },
    controlSchemaChecksum: checksum,
  };
  const first = buildDeploymentPlan(input);
  const second = buildDeploymentPlan(structuredClone(input));
  assert.equal(first.planDigest, second.planDigest);
  input.observed.revision = "observed-10";
  assert.notEqual(first.planDigest, buildDeploymentPlan(input).planDigest);
});
