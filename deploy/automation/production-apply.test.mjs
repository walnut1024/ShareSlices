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
      if (sql.includes("set lease_expires_at")) return {rows: [{revision: 2}]};
      if (sql.includes("insert into shareslices_deployment_phase_journal")) return {rows: [{phase: "migration"}]};
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
    actions: [{logicalId: "batch/v1/Job/shareslices/migrate", phase: "migration", action: "create"}],
  };
  const apply = createProductionPlanApplier({
    owner: "operator@example.test",
    now: () => new Date("2026-07-22T00:00:00Z"),
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const result = await apply({
    config: {installationId: "example"},
    plan,
    authorizedPlanDigest: plan.planDigest,
    observe: async () => ({revision: digest("c")}),
    executePhase: async ({phase, lease}) => {
      executed.push({phase, fence: lease.fencingToken});
      return {checkpointDigest: digest("d")};
    },
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(executed, [{phase: "migration", fence: 1}]);
  assert.equal(queries.filter((sql) => sql.includes("deployment_phase_journal")).length, 3);
});
