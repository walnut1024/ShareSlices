import assert from "node:assert/strict";
import test from "node:test";

import {sha256Digest} from "./canonical.mjs";
import {createProductionRollbackExecutor} from "./production-rollback.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

function candidateRelease() {
  return {
    target: "kubernetes",
    releaseId: digest("a"),
    configurationDigest: digest("b"),
    secretRevisions: [{logicalId: "database", revision: "7"}],
    compatibility: {
      schemaHead: "0030",
      runtimeN: "runtime-old",
      runtimeNMinus1: null,
    },
    contractRevisions: {jobs: "jobs-1"},
    artifacts: [{
      name: "api-image",
      artifactKind: "oci-image",
      contentDigest: digest("c"),
      providerIdentity: {kind: "digest", value: digest("c"), qualified: true, mutable: false},
    }],
  };
}

function rowsFor(release, bundleDigest) {
  return [
    {
      slot: "active",
      target: "kubernetes",
      release_id: digest("d"),
      bundle_digest: digest("e"),
      configuration_digest: digest("f"),
      secret_revisions: [{logicalId: "database", revision: "8"}],
      compatibility: {schemaHead: "0030", runtimeN: "runtime-new", runtimeNMinus1: "runtime-old"},
      contract_revisions: {jobs: "jobs-1"},
    },
    {
      slot: "previous",
      target: release.target,
      release_id: release.releaseId,
      bundle_digest: bundleDigest,
      configuration_digest: release.configurationDigest,
      secret_revisions: release.secretRevisions,
      compatibility: release.compatibility,
      contract_revisions: release.contractRevisions,
    },
  ];
}

function rollbackPlan(release, bundleDigest, observedStateRevision = "observed-1") {
  const body = {
    schemaVersion: "shareslices.deployment-plan/v1",
    operation: "rollback",
    target: release.target,
    releaseId: release.releaseId,
    bundleDigest,
    observedStateRevision,
    firstInstallation: false,
    actions: [],
    outcome: "ready",
    refusalReasons: [],
  };
  return {...body, planDigest: sha256Digest(body)};
}

test("production rollback fences preflight and phases before atomically swapping release records", async () => {
  const release = candidateRelease();
  const bundleDigest = digest("9");
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({sql, values});
      if (sql.includes("slot in ('active', 'previous')")) return {rows: rowsFor(release, bundleDigest)};
      if (sql.includes("select 1 from shareslices_deployment_operation")) return {rows: [{}]};
      if (sql.includes("for update")) return {rows: []};
      if (sql.includes("insert into shareslices_deployment_operation")) return {rows: [{fencing_token: 4, revision: 1}]};
      if (sql.includes("set lease_expires_at")) return {rows: [{revision: 2}]};
      if (sql.includes("insert into shareslices_deployment_phase_journal")) return {rows: [{phase: values[3]}]};
      if (sql.includes("set state = 'completed'")) return {rows: [{revision: 3}]};
      return {rows: []};
    },
  };
  const rollback = createProductionRollbackExecutor({
    owner: "operator",
    now: () => new Date("2026-07-22T00:00:00Z"),
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const executed = [];
  const plan = rollbackPlan(release, bundleDigest);
  const result = await rollback({
    config: {installationId: "example", target: "kubernetes"},
    release,
    bundleDigest,
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => ({revision: plan.observedStateRevision}),
    preflight: async () => ({
      availableProviderIdentities: release.artifacts.map(({providerIdentity}) => providerIdentity),
      availableSecretRevisions: release.secretRevisions,
    }),
    executePhase: async ({phase}) => {
      executed.push(phase);
      return {phase, passed: true};
    },
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(executed, ["private-runtime", "public-runtime", "verification"]);
  assert.equal(executed.includes("migration"), false);
  assert.equal(result.records.active.releaseId, release.releaseId);
  assert.equal(result.records.previous.releaseId, digest("d"));
  assert.equal(calls.filter(({sql}) => sql.includes("slot in ('active', 'previous')")).length, 2);
  assert.equal(calls.some(({sql}) => sql.includes("set state = 'completed'")), true);
});

test("production rollback refuses an unrecorded candidate before acquiring a lease", async () => {
  const release = candidateRelease();
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("slot in ('active', 'previous')")) return {rows: rowsFor(release, digest("8")).slice(0, 1)};
      return {rows: []};
    },
  };
  const rollback = createProductionRollbackExecutor({
    owner: "operator",
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const plan = rollbackPlan(release, digest("9"));
  const result = await rollback({
    config: {installationId: "example", target: "kubernetes"},
    release,
    bundleDigest: digest("9"),
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => ({revision: plan.observedStateRevision}),
    preflight: async () => assert.fail("preflight must not run"),
    executePhase: async () => assert.fail("rollback phase must not run"),
  });
  assert.deepEqual(result.refusalReasons, ["rollback_candidate_not_recorded"]);
  assert.equal(calls.some((sql) => sql.includes("insert into shareslices_deployment_operation")), false);
});

test("production rollback refuses an unauthorized or stale plan before acquiring a lease", async () => {
  const release = candidateRelease();
  const bundleDigest = digest("9");
  const calls = [];
  const client = {query: async (sql) => { calls.push(sql); return {rows: []}; }};
  const rollback = createProductionRollbackExecutor({
    owner: "operator",
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const plan = rollbackPlan(release, bundleDigest);
  const unauthorized = await rollback({
    config: {installationId: "example", target: "kubernetes"},
    release,
    bundleDigest,
    plan,
    authorizedPlanDigest: digest("0"),
    observe: async () => ({revision: plan.observedStateRevision}),
  });
  assert.deepEqual(unauthorized.refusalReasons, ["rollback_plan_unauthorized"]);

  const stale = await rollback({
    config: {installationId: "example", target: "kubernetes"},
    release,
    bundleDigest,
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => ({revision: "observed-changed"}),
  });
  assert.deepEqual(stale.refusalReasons, ["rollback_plan_stale"]);
  assert.equal(calls.some((sql) => sql.includes("insert into shareslices_deployment_operation")), false);
});

test("repeating an already converged rollback is idempotent and performs no mutation", async () => {
  const release = candidateRelease();
  const bundleDigest = digest("9");
  const plan = rollbackPlan(release, bundleDigest);
  const calls = [];
  const active = rowsFor(release, bundleDigest)[1];
  active.slot = "active";
  const previous = rowsFor(release, bundleDigest)[0];
  previous.slot = "previous";
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("slot in ('active', 'previous')")) return {rows: [active, previous]};
      return {rows: []};
    },
  };
  const rollback = createProductionRollbackExecutor({
    owner: "operator",
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const result = await rollback({
    config: {installationId: "example", target: "kubernetes"},
    release,
    bundleDigest,
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => assert.fail("already-converged rollback must not observe provider state"),
    preflight: async () => assert.fail("already-converged rollback must not probe images"),
    executePhase: async () => assert.fail("already-converged rollback must not execute phases"),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.alreadyConverged, true);
  assert.equal(calls.some((sql) => sql.includes("insert into shareslices_deployment_operation")), false);
});

test("production rollback records a stable failed checkpoint and never swaps records after a phase error", async () => {
  const release = candidateRelease();
  const bundleDigest = digest("9");
  const checkpoints = [];
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.includes("slot in ('active', 'previous')")) return {rows: rowsFor(release, bundleDigest)};
      if (sql.includes("select 1 from shareslices_deployment_operation")) return {rows: [{}]};
      if (sql.includes("for update")) return {rows: []};
      if (sql.includes("insert into shareslices_deployment_operation")) return {rows: [{fencing_token: 4, revision: 1}]};
      if (sql.includes("set lease_expires_at")) return {rows: [{revision: 2}]};
      if (sql.includes("insert into shareslices_deployment_phase_journal")) {
        checkpoints.push({phase: values[3], state: values[4], digest: values[5], reasonCode: values[6]});
        return {rows: [{phase: values[3]}]};
      }
      return {rows: []};
    },
  };
  const rollback = createProductionRollbackExecutor({
    owner: "operator",
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const plan = rollbackPlan(release, bundleDigest);
  await assert.rejects(
    rollback({
      config: {installationId: "example", target: "kubernetes"},
      release,
      bundleDigest,
      plan,
      authorizedPlanDigest: plan.planDigest,
      observe: async () => ({revision: plan.observedStateRevision}),
      preflight: async () => ({
        availableProviderIdentities: release.artifacts.map(({providerIdentity}) => providerIdentity),
        availableSecretRevisions: release.secretRevisions,
      }),
      executePhase: async () => {
        const error = new Error("provider detail must not enter evidence");
        error.code = "kubernetes_rollback_apply_failed";
        throw error;
      },
    }),
    (error) => error.code === "kubernetes_rollback_apply_failed",
  );
  assert.deepEqual(checkpoints.at(-1), {
    phase: "private-runtime",
    state: "failed",
    digest: checkpoints.at(-1).digest,
    reasonCode: "kubernetes_rollback_apply_failed",
  });
  assert.match(checkpoints.at(-1).digest, /^sha256:/);
  assert.equal(JSON.stringify(checkpoints).includes("provider detail"), false);
  assert.equal(calls.some((sql) => sql.includes("delete from shareslices_deployment_release_record")), false);
});

test("production rollback requires an explicit deployment principal", () => {
  assert.throws(() => createProductionRollbackExecutor(), /deployment principal/);
});
