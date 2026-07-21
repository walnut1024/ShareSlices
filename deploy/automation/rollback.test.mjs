import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRollback } from "./rollback.mjs";

const previousId = `sha256:${"a".repeat(64)}`;
const activeId = `sha256:${"b".repeat(64)}`;
const artifact = {
  name: "api",
  contentDigest: `sha256:${"c".repeat(64)}`,
  providerIdentity: {
    kind: "digest",
    value: `sha256:${"c".repeat(64)}`,
    qualified: true,
    mutable: false,
  },
};
const candidate = {
  releaseId: previousId,
  compatibility: { schemaHead: "0030", runtimeN: "runtime-1", runtimeNMinus1: null },
  contractRevisions: { jobs: "jobs-1" },
  artifacts: [artifact],
  secretRevisions: [{ logicalId: "database", revision: "1" }],
};
const active = {
  releaseId: activeId,
  previousReleaseId: previousId,
  compatibility: { schemaHead: "0030", runtimeN: "runtime-2", runtimeNMinus1: "runtime-1" },
  contractRevisions: { jobs: "jobs-1" },
};
const available = {
  availableProviderIdentities: [artifact.providerIdentity],
  availableSecretRevisions: candidate.secretRevisions,
};

test("restores only a recorded schema- and contract-compatible application release", () => {
  const decision = evaluateRollback({
    activeRelease: active,
    candidateRelease: candidate,
    ...available,
  });
  assert.equal(decision.outcome, "ready");
  assert.deepEqual(decision.actions, [
    { phase: "private-runtime", action: "restore_application_artifacts" },
    { phase: "public-runtime", action: "restore_routes_and_configuration" },
    { phase: "verification", action: "verify_restored_release" },
  ]);
  assert.equal(decision.actions.some(({ action }) => action.includes("migration")), false);
});

test("refuses an unrecorded, schema-incompatible, or job-incompatible release", () => {
  const wrong = structuredClone(candidate);
  wrong.releaseId = `sha256:${"d".repeat(64)}`;
  wrong.compatibility.schemaHead = "0029";
  wrong.contractRevisions.jobs = "jobs-0";
  const decision = evaluateRollback({
    activeRelease: active,
    candidateRelease: wrong,
    ...available,
  });
  assert.equal(decision.outcome, "refused");
  assert.deepEqual(decision.refusalReasons, [
    "rollback_candidate_not_recorded",
    "rollback_job_contract_incompatible",
    "rollback_schema_incompatible",
  ]);
});

test("refuses missing provider artifacts or revoked Secret revisions before mutation", () => {
  const decision = evaluateRollback({
    activeRelease: active,
    candidateRelease: candidate,
    availableProviderIdentities: [],
    availableSecretRevisions: [],
  });
  assert.equal(decision.outcome, "refused");
  assert.deepEqual(decision.refusalReasons, [
    "rollback_provider_identity_unavailable",
    "rollback_secret_revision_unavailable",
  ]);
  assert.deepEqual(decision.actions, []);
});

test("refuses a candidate outside the declared N-1 runtime window", () => {
  const incompatible = structuredClone(active);
  incompatible.compatibility.runtimeNMinus1 = "runtime-other";
  const decision = evaluateRollback({
    activeRelease: incompatible,
    candidateRelease: candidate,
    ...available,
  });
  assert.deepEqual(decision.refusalReasons, ["rollback_runtime_incompatible"]);
});
