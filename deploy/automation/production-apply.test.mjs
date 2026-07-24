import assert from "node:assert/strict";
import test from "node:test";

import {createProductionPlanApplier} from "./production-apply.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("production apply requires an authenticated deployment principal", () => {
  assert.throws(() => createProductionPlanApplier({owner: ""}), /principal/);
});

test("production apply composes the fenced PostgreSQL journal with phase execution", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === "begin" || sql === "commit" || sql.includes("pg_advisory_xact_lock")) return {rows: []};
      if (sql.includes("select operation_id")) return {rows: []};
      if (sql.includes("insert into shareslices_deployment_operation")) {
        return {rows: [{fencing_token: 1, revision: 1}]};
      }
      if (sql.includes("select phase from shareslices_deployment_phase_journal")) return {rows: []};
      if (sql.includes("from shareslices_deployment_phase_step_checkpoint")) return {rows: []};
      if (sql.includes("set lease_expires_at")) return {rows: [{revision: 2}]};
      if (sql.includes("insert into shareslices_deployment_phase_journal")) return {rows: [{phase: "migration"}]};
      if (sql.includes("insert into shareslices_deployment_phase_step_checkpoint")) {
        return {rows: [{phase: "verification", step: "probe-observed"}]};
      }
      if (sql.includes("from shareslices_deployment_release_record")) return {rows: []};
      if (sql.includes("select 1 from shareslices_deployment_operation")) return {rows: [{authorized: 1}]};
      if (sql.includes("delete from shareslices_deployment_release_record")) return {rows: []};
      if (sql.includes("insert into shareslices_deployment_release_record")) return {rows: []};
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const executed = [];
  const plan = {
    schemaVersion: "shareslices.deployment-plan/v1",
    planDigest: digest("a"),
    outcome: "ready",
    target: "kubernetes",
    releaseId: digest("b"),
    observedStateRevision: digest("c"),
    firstInstallation: false,
    actions: [
      {logicalId: "batch/v1/Job/shareslices/migrate", phase: "migration", action: "create"},
      {logicalId: "deployment-control/release-verification", phase: "verification", action: "create"},
    ],
  };
  const apply = createProductionPlanApplier({
    owner: "operator@example.test",
    now: () => new Date("2026-07-22T00:00:00Z"),
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const result = await apply({
    config: {installationId: "example", target: "kubernetes"},
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => ({revision: digest("c")}),
    executePhase: async ({
      phase,
      lease,
      finalizeRelease,
      readStepCheckpoints,
      recordStepCheckpoint,
    }) => {
      executed.push({phase, fence: lease.fencingToken});
      if (phase === "verification") {
        assert.deepEqual(await readStepCheckpoints(), []);
        await recordStepCheckpoint({
          step: "probe-observed",
          state: "completed",
          evidence: {nonce: "nonce-1"},
        });
        await finalizeRelease({
          release: {
            releaseId: plan.releaseId,
            configurationDigest: digest("e"),
            secretRevisions: [],
            compatibility: {schemaHead: "0030.sql"},
            contractRevisions: {deployment: "shareslices.deployment/v1"},
          },
          bundleDigest: digest("f"),
        });
      }
      return {checkpointDigest: digest("d")};
    },
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(executed, [{phase: "migration", fence: 1}, {phase: "verification", fence: 1}]);
  assert.equal(queries.filter((sql) => sql.includes("deployment_phase_journal")).length, 5);
  assert.equal(queries.some((sql) => sql.includes("insert into shareslices_deployment_release_record")), true);
});
