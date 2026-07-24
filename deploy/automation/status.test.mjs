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
      readiness: {
        core: {state: "unknown", required: true, verified: false, reasonCode: "core_verification_pending"},
        email: {state: "unknown", required: false, verified: false, reasonCode: "email_readiness_unknown"},
        processing: {state: "unknown", required: false, verified: false, reasonCode: "processing_readiness_unknown"},
        thumbnail: {state: "unknown", required: false, verified: false, reasonCode: "thumbnail_readiness_unknown"},
        cdn: {state: "unknown", required: false, verified: false, reasonCode: "cdn_readiness_unknown"},
        gallery: {state: "unknown", required: false, verified: false, reasonCode: "gallery_readiness_unknown"},
      },
      evidence: {phases: [{state: "blocked", reasonCode: "dependency_unavailable"}]},
    },
  );
  assert.equal(deriveDeploymentStatus({ ...base, phases: [{ state: "failed" }] }).state, "failed");
  const indeterminate = deriveDeploymentStatus({ ...base, observation: "indeterminate" });
  assert.equal(indeterminate.state, "indeterminate");
  assert.equal(indeterminate.readiness.core.reasonCode, "core_verification_indeterminate");
  assert.equal(
    deriveDeploymentStatus({ ...base, verification: "failed" }).readiness.core.reasonCode,
    "core_verification_failed",
  );
});

test("reports six readiness dimensions and blocks verified state on required uncertainty", () => {
  const result = deriveDeploymentStatus({
    ...base,
    observedReleaseId: release,
    verification: "passed",
    readiness: {
      core: {state: "passed", required: true},
      email: {state: "passed", required: true},
      processing: {state: "indeterminate", required: true, reasonCode: "container_probe_unknown"},
      thumbnail: {state: "unavailable", required: false},
      cdn: {state: "disabled", required: false},
      gallery: {state: "not_applicable", required: false},
    },
  });
  assert.equal(result.state, "observed");
  assert.equal(result.reasonCode, "required_capability_readiness_incomplete");
  assert.deepEqual(Object.keys(result.readiness), [
    "core",
    "email",
    "processing",
    "thumbnail",
    "cdn",
    "gallery",
  ]);
  assert.equal(result.readiness.core.verified, true);
  assert.equal(result.readiness.processing.verified, false);
  assert.equal(result.readiness.thumbnail.verified, false);
});

test("marks a release verified only when every required readiness dimension passes", () => {
  const result = deriveDeploymentStatus({
    ...base,
    observedReleaseId: release,
    verification: "passed",
    readiness: Object.fromEntries(
      ["core", "email", "processing", "thumbnail"].map((dimension) => [
        dimension,
        {state: "passed", required: true},
      ]),
    ),
  });
  assert.equal(result.state, "verified");
  assert.equal(
    Object.values(result.readiness)
      .filter(({required}) => required)
      .every(({verified}) => verified),
    true,
  );
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
