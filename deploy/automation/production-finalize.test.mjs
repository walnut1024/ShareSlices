import assert from "node:assert/strict";
import test from "node:test";

import {createProductionReleaseFinalizer} from "./production-finalize.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("release finalization requires passed verification and a deployment principal", async () => {
  assert.throws(() => createProductionReleaseFinalizer(), /deployment principal/);
  const finalize = createProductionReleaseFinalizer({owner: "operator", withControlClient: async () => {}});
  await assert.rejects(
    finalize({verification: {outcome: "failed"}}),
    /passed verification/,
  );
});

test("release finalization records active and previous releases under one verification fence", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({sql, values});
      if (sql.includes("select 1 from shareslices_deployment_operation")) return {rows: [{}]};
      if (sql.includes("for update")) return {rows: []};
      if (sql.includes("insert into shareslices_deployment_operation")) return {rows: [{fencing_token: 3, revision: 1}]};
      if (sql.includes("slot = 'active'")) return {rows: [{
        target: "kubernetes",
        release_id: digest("a"),
        bundle_digest: digest("b"),
        configuration_digest: digest("c"),
        secret_revisions: [{logicalId: "database", revision: "old"}],
      }]};
      if (sql.includes("insert into shareslices_deployment_phase_journal")) return {rows: [{phase: "verification"}]};
      if (sql.includes("set state = 'completed'")) return {rows: [{revision: 2}]};
      return {rows: []};
    },
  };
  const finalize = createProductionReleaseFinalizer({
    owner: "operator",
    now: () => new Date("2026-07-22T00:00:00Z"),
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const result = await finalize({
    config: {installationId: "example", target: "kubernetes"},
    release: {
      releaseId: digest("d"),
      configurationDigest: digest("e"),
      secretRevisions: [{logicalId: "database", revision: "new"}],
    },
    bundleDigest: digest("f"),
    verification: {outcome: "passed", checks: []},
  });
  assert.equal(result.lease.fencingToken, 3);
  assert.equal(result.records.active.releaseId, digest("d"));
  assert.equal(result.records.previous.releaseId, digest("a"));
  assert.equal(calls.some(({sql}) => sql.includes("set state = 'completed'")), true);
  assert.equal(calls.some(({sql}) => sql.includes("set revision = revision + 1")), true);
});
