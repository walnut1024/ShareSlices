import assert from "node:assert/strict";
import test from "node:test";

import { buildDeploymentPlan } from "./plan.mjs";

const checksum = `sha256:${"c".repeat(64)}`;
const desired = {
  target: "kubernetes",
  releaseId: `sha256:${"a".repeat(64)}`,
  resources: [
    { logicalId: "database/external", phase: "prerequisites", digest: "external-1", durable: true },
    { logicalId: "migration/0030", phase: "migration", digest: "migration-1" },
    { logicalId: "runtime/api", phase: "public-runtime", digest: "api-2", securitySensitive: true },
  ],
};

test("includes the one permitted first-install control-schema bootstrap", () => {
  const plan = buildDeploymentPlan({
    desired,
    observed: { revision: "absent:1", controlSchema: { state: "absent" }, resources: [] },
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

test("refuses control-schema mismatch and destructive durable replacement", () => {
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
    "destructive_change_requires_review",
  ]);
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
