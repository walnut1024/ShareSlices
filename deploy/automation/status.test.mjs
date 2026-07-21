import assert from "node:assert/strict";
import test from "node:test";

import { deriveDeploymentStatus } from "./status.mjs";

const release = `sha256:${"a".repeat(64)}`;
const previous = `sha256:${"b".repeat(64)}`;
const base = { target: "cloudflare", desiredReleaseId: release };

test("reports desired, handed-off, observed, and verified states distinctly", () => {
  assert.equal(deriveDeploymentStatus(base).state, "desired");
  assert.equal(deriveDeploymentStatus({ ...base, handoff: { observed: false } }).state, "handed-off");
  assert.equal(deriveDeploymentStatus({ ...base, observedReleaseId: release }).state, "observed");
  assert.equal(deriveDeploymentStatus({
    ...base,
    observedReleaseId: release,
    verification: "passed",
  }).state, "verified");
});

test("reports phase-blocked, failed, and indeterminate evidence without claiming progress", () => {
  assert.deepEqual(
    deriveDeploymentStatus({ ...base, phases: [{ state: "blocked", reasonCode: "dependency_unavailable" }] }),
    {
      schemaVersion: "shareslices.deployment-status/v1",
      target: "cloudflare",
      desiredReleaseId: release,
      observedReleaseId: null,
      state: "phase-blocked",
      reasonCode: "dependency_unavailable",
      optionalCapabilities: {},
      evidence: {phases: [{state: "blocked", reasonCode: "dependency_unavailable"}]},
    },
  );
  assert.equal(deriveDeploymentStatus({ ...base, phases: [{ state: "failed" }] }).state, "failed");
  assert.equal(deriveDeploymentStatus({ ...base, observation: "indeterminate" }).state, "indeterminate");
});

test("reports mixed components, drift, and unowned resources independently", () => {
  assert.equal(deriveDeploymentStatus({
    ...base,
    components: [{ releaseId: release }, { releaseId: previous }],
  }).state, "partial");
  assert.equal(deriveDeploymentStatus({ ...base, drift: [{ logicalId: "runtime/api" }] }).state, "drifted");
  assert.equal(deriveDeploymentStatus({ ...base, orphans: [{ logicalId: "unknown" }] }).state, "orphaned");
});

test("retains optional capability readiness separately from core release state", () => {
  const result = deriveDeploymentStatus({
    ...base,
    observedReleaseId: release,
    verification: "passed",
    optionalCapabilities: {
      thumbnail: { state: "unavailable", reasonCode: "container_not_qualified" },
      cdn: { state: "disabled", reasonCode: null },
    },
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.optionalCapabilities, {
    cdn: { state: "disabled", reasonCode: null },
    thumbnail: { state: "unavailable", reasonCode: "container_not_qualified" },
  });
});

test("retains target-observed rollout, migration, and digest evidence", () => {
  const result = deriveDeploymentStatus({
    ...base,
    observedReleaseId: release,
    components: [{logicalId: "apps/v1/Deployment/ns/api", releaseId: release, ready: true}],
    phases: [{phase: "public-runtime", state: "completed"}],
    migration: {schemaHead: "0030", complete: true},
    routeDigests: [`sha256:${"c".repeat(64)}`],
    configurationDigests: [`sha256:${"d".repeat(64)}`],
    drift: [],
    orphans: [],
  });
  assert.equal(result.state, "observed");
  assert.equal(result.evidence.components[0].ready, true);
  assert.equal(result.evidence.migration.schemaHead, "0030");
  assert.equal(result.evidence.routeDigests.length, 1);
});
