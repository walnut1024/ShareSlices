import assert from "node:assert/strict";
import test from "node:test";

// cspell:ignore regclass

import {
  acquireOperationLease,
  bootstrapControlSchema,
  DeploymentControlError,
  heartbeatOperationLease,
  loadControlSchema,
  mirrorReleaseRecords,
  recordPhaseCheckpoint,
} from "./control-store.mjs";

function client(handler = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (text, parameters) => {
      calls.push({ text, parameters });
      return handler(text, parameters, calls.length - 1);
    },
  };
}

test("bootstraps the exact schema atomically under one advisory-locked client", async () => {
  const schema = await loadControlSchema();
  const database = client(async (text) => {
    if (text.startsWith("select name, to_regclass")) {
      return { rows: [
        { name: "shareslices_deployment_control_metadata", present: false },
        { name: "shareslices_deployment_operation", present: false },
        { name: "shareslices_deployment_phase_journal", present: false },
        { name: "shareslices_deployment_release_record", present: false },
      ] };
    }
    return { rows: [] };
  });
  assert.deepEqual(await bootstrapControlSchema(database, schema.checksum), {
    state: "installed",
    revision: 1,
  });
  assert.equal(database.calls[0].text, "begin");
  assert.match(database.calls[1].text, /pg_advisory_xact_lock/);
  assert.equal(database.calls.some(({ text }) => text === schema.sql), true);
  assert.equal(database.calls.at(-1).text, "commit");
});

test("refuses an unauthorized checksum before querying PostgreSQL", async () => {
  const database = client();
  await assert.rejects(
    bootstrapControlSchema(database, `sha256:${"0".repeat(64)}`),
    (error) => error instanceof DeploymentControlError && error.code === "deployment_control_artifact_mismatch",
  );
  assert.equal(database.calls.length, 0);
});

test("rolls back a partial or checksum-mismatched existing schema", async () => {
  const schema = await loadControlSchema();
  for (const rows of [
    [{ name: "shareslices_deployment_operation", present: true }],
    [
      { name: "shareslices_deployment_control_metadata", present: true },
      { name: "shareslices_deployment_operation", present: true },
      { name: "shareslices_deployment_phase_journal", present: true },
      { name: "shareslices_deployment_release_record", present: true },
    ],
  ]) {
    const database = client(async (text) => {
      if (text.startsWith("select name, to_regclass")) return { rows };
      if (text.startsWith("select schema_checksum")) {
        return { rows: [{ schema_checksum: `sha256:${"f".repeat(64)}`, revision: 1 }] };
      }
      return { rows: [] };
    });
    await assert.rejects(bootstrapControlSchema(database, schema.checksum), DeploymentControlError);
    assert.equal(database.calls.at(-1).text, "rollback");
  }
});

test("acquires a monotonically fenced lease and rejects another active owner", async () => {
  const now = new Date("2026-07-22T00:00:00Z");
  const input = {
    installationId: "installation-1",
    target: "kubernetes",
    operationId: "operation-2",
    releaseId: `sha256:${"a".repeat(64)}`,
    owner: "controller-b",
    now,
    leaseExpiresAt: new Date("2026-07-22T00:01:00Z"),
  };
  const database = client(async (text) => {
    if (text.startsWith("select operation_id")) {
      return { rows: [{
        operation_id: "operation-1",
        lease_owner: "controller-a",
        lease_expires_at: new Date("2026-07-21T23:59:00Z"),
        fencing_token: "4",
      }] };
    }
    if (text.startsWith("insert into shareslices_deployment_operation")) {
      return { rows: [{ fencing_token: "5", revision: "8" }] };
    }
    return { rows: [] };
  });
  assert.deepEqual(await acquireOperationLease(database, input), {
    operationId: "operation-2",
    fencingToken: 5,
    revision: 8,
    resumed: false,
  });
  assert.equal(database.calls.at(-1).text, "commit");

  const held = client(async (text) => text.startsWith("select operation_id")
    ? { rows: [{ lease_owner: "controller-a", lease_expires_at: new Date("2026-07-22T00:02:00Z") }] }
    : { rows: [] });
  await assert.rejects(
    acquireOperationLease(held, input),
    (error) => error.code === "deployment_operation_lease_held",
  );
  assert.equal(held.calls.at(-1).text, "rollback");
});

test("resumes only the exact active operation without advancing its fence", async () => {
  const now = new Date("2026-07-22T00:00:00Z");
  const input = {
    installationId: "installation-1",
    target: "kubernetes",
    operationId: "operation-2",
    releaseId: `sha256:${"a".repeat(64)}`,
    owner: "controller-b",
    now,
    leaseExpiresAt: new Date("2026-07-22T00:01:00Z"),
  };
  const database = client(async (text) => {
    if (text.startsWith("select operation_id")) {
      return { rows: [{
        operation_id: "operation-2",
        lease_owner: "controller-b",
        lease_expires_at: new Date("2026-07-22T00:00:30Z"),
        fencing_token: "7",
      }] };
    }
    if (text.startsWith("update shareslices_deployment_operation")) {
      return { rows: [{ fencing_token: "7", revision: "9" }] };
    }
    return { rows: [] };
  });
  assert.deepEqual(await acquireOperationLease(database, input), {
    operationId: "operation-2",
    fencingToken: 7,
    revision: 9,
    resumed: true,
  });
  assert.equal(database.calls.some(({ text }) => text.startsWith("insert into shareslices_deployment_operation")), false);

  const conflicting = client(async (text) => text.startsWith("select operation_id")
    ? { rows: [{
      operation_id: "operation-1",
      lease_owner: "controller-b",
      lease_expires_at: new Date("2026-07-22T00:00:30Z"),
      fencing_token: "6",
    }] }
    : { rows: [] });
  await assert.rejects(
    acquireOperationLease(conflicting, input),
    (error) => error.code === "deployment_operation_lease_held",
  );
  assert.equal(conflicting.calls.at(-1).text, "rollback");
});

test("heartbeat and phase writes reject lost leases and stale fences", async () => {
  const lease = {
    installationId: "installation-1",
    operationId: "operation-2",
    owner: "controller-b",
    fencingToken: 5,
  };
  const stale = client(async () => ({ rows: [] }));
  await assert.rejects(
    heartbeatOperationLease(stale, lease, {
      now: new Date("2026-07-22T00:00:10Z"),
      leaseExpiresAt: new Date("2026-07-22T00:01:10Z"),
    }),
    (error) => error.code === "deployment_operation_lease_lost",
  );
  await assert.rejects(
    recordPhaseCheckpoint(stale, lease, { phase: "migration", state: "completed" }),
    (error) => error.code === "deployment_operation_stale_fence",
  );
});

test("mirrors only Secret-free active and previous records under a live fence", async () => {
  const lease = {
    installationId: "installation-1",
    operationId: "operation-2",
    owner: "controller-b",
    fencingToken: 5,
    target: "cloudflare",
  };
  const release = (character, revisions) => ({
    target: "cloudflare",
    releaseId: `sha256:${character.repeat(64)}`,
    bundleDigest: `sha256:${character.repeat(64)}`,
    configurationDigest: `sha256:${character.repeat(64)}`,
    secretRevisions: revisions,
  });
  const database = client(async (text) => text.startsWith("select 1 from shareslices_deployment_operation")
    ? { rows: [{ "?column?": 1 }] }
    : { rows: [] });
  const result = await mirrorReleaseRecords(database, lease, {
    active: release("a", [{ logicalId: "resend", revision: "2" }]),
    previous: release("b", [{ logicalId: "resend", revision: "1" }]),
  });
  assert.equal(result.active.releaseId, `sha256:${"a".repeat(64)}`);
  assert.equal(database.calls.filter(({ text }) => text.startsWith("insert into shareslices_deployment_release_record")).length, 2);
  assert.equal(database.calls.at(-1).text, "commit");
  assert.equal(JSON.stringify(database.calls).includes("secret-value"), false);

  await assert.rejects(
    mirrorReleaseRecords(client(), lease, {
      active: release("a", [{ logicalId: "resend", revision: "2", value: "secret-value" }]),
    }),
    (error) => error.code === "deployment_release_record_invalid",
  );

  const stale = client(async () => ({ rows: [] }));
  await assert.rejects(
    mirrorReleaseRecords(stale, lease, { active: release("a", []) }),
    (error) => error.code === "deployment_operation_stale_fence",
  );
  assert.equal(stale.calls.at(-1).text, "rollback");
  assert.equal(stale.calls.some(({ text }) => text.startsWith("delete from shareslices_deployment_release_record")), false);
});
