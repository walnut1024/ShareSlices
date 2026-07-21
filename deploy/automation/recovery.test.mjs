import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryMarker,
  inspectRecoverabilityEvidence,
  persistRecoveryMarker,
  RecoveryEvidenceError,
  verifyRecoveryMarkers,
} from "./recovery.mjs";

const evidence = (observedAt) => ({
  owner: "operations",
  encryptedLocation: "encrypted://backup",
  retention: "30 days",
  observedAt,
  maximumAgeSeconds: 3600,
  rpoSeconds: 900,
  rtoSeconds: 3600,
});

test("requires current evidence for every recovery dependency", () => {
  const now = new Date("2026-07-22T01:00:00Z");
  const current = evidence("2026-07-22T00:30:00Z");
  const result = inspectRecoverabilityEvidence({
    postgresql: current,
    objectStorage: current,
    iacState: current,
    releaseBundles: current,
    deploymentJournal: current,
  }, now);
  assert.equal(result.ready, true);
  assert.equal(result.results.every(({ state }) => state === "current"), true);
});

test("fails closed for stale, future-dated, and missing evidence", () => {
  const now = new Date("2026-07-22T01:00:00Z");
  const result = inspectRecoverabilityEvidence({
    postgresql: evidence("2026-07-21T23:00:00Z"),
    objectStorage: evidence("2026-07-22T02:00:00Z"),
    iacState: evidence("2026-07-22T00:30:00Z"),
    releaseBundles: evidence("2026-07-22T00:30:00Z"),
  }, now);
  assert.equal(result.ready, false);
  assert.deepEqual(result.results.map(({ state }) => state), [
    "stale",
    "stale",
    "current",
    "current",
    "missing",
  ]);
});

test("rejects structurally incomplete recoverability evidence", () => {
  const now = new Date("2026-07-22T01:00:00Z");
  const invalid = evidence("2026-07-22T00:30:00Z");
  delete invalid.owner;
  invalid.rpoSeconds = -1;
  const result = inspectRecoverabilityEvidence({
    postgresql: invalid,
    objectStorage: evidence("2026-07-22T00:30:00Z"),
    iacState: evidence("2026-07-22T00:30:00Z"),
    releaseBundles: evidence("2026-07-22T00:30:00Z"),
    deploymentJournal: evidence("2026-07-22T00:30:00Z"),
  }, now);
  assert.equal(result.ready, false);
  assert.deepEqual(result.results[0], {
    kind: "postgresql",
    state: "invalid",
    reasonCode: "recovery_evidence_invalid",
  });
});

test("creates one deterministic marker for a known database and object cut", () => {
  const input = {
    installationId: "example",
    databaseRevision: "lsn:0/16B6C50",
    objectRevision: "inventory:42",
    createdAt: "2026-07-22T01:00:00.000Z",
  };
  assert.deepEqual(createRecoveryMarker(input), createRecoveryMarker(structuredClone(input)));
});

test("requires identical database, object, and manifest markers", () => {
  const marker = createRecoveryMarker({
    installationId: "example",
    databaseRevision: "lsn:0/16B6C50",
    objectRevision: "inventory:42",
    createdAt: "2026-07-22T01:00:00.000Z",
  });
  assert.equal(verifyRecoveryMarkers({
    database: marker,
    objectStorage: structuredClone(marker),
    manifest: structuredClone(marker),
  }).ready, true);
  assert.equal(verifyRecoveryMarkers({
    database: marker,
    objectStorage: { ...marker, objectRevision: "inventory:41" },
    manifest: marker,
  }).reasonCode, "recovery_marker_mismatch");
  assert.equal(verifyRecoveryMarkers({ database: marker }).reasonCode, "recovery_marker_missing");
});

function markerStore() {
  const records = new Map();
  return {
    records,
    async writeOnce(marker) {
      const current = records.get(marker.cutId);
      if (current) return "existing";
      records.set(marker.cutId, structuredClone(marker));
      return "created";
    },
    async read(cutId) {
      return structuredClone(records.get(cutId));
    },
  };
}

test("persists one write-once marker across all durable recovery stores", async () => {
  const input = {
    installationId: "example",
    databaseRevision: "lsn:0/16B6C50",
    objectRevision: "inventory:42",
    createdAt: "2026-07-22T01:00:00.000Z",
  };
  const database = markerStore();
  const objectStorage = markerStore();
  const manifest = markerStore();
  const first = await persistRecoveryMarker({ input, database, objectStorage, manifest });
  assert.deepEqual(first.writes.map(({ outcome }) => outcome), ["created", "created", "created"]);
  const repeat = await persistRecoveryMarker({ input, database, objectStorage, manifest });
  assert.deepEqual(repeat.writes.map(({ outcome }) => outcome), ["existing", "existing", "existing"]);
  assert.equal(first.marker.cutId, repeat.marker.cutId);
});

test("fails closed for an indeterminate or mismatched durable marker", async () => {
  const input = {
    installationId: "example",
    databaseRevision: "lsn:0/16B6C50",
    objectRevision: "inventory:42",
    createdAt: "2026-07-22T01:00:00.000Z",
  };
  const indeterminate = markerStore();
  indeterminate.writeOnce = async () => "unknown";
  await assert.rejects(
    persistRecoveryMarker({
      input,
      database: markerStore(),
      objectStorage: indeterminate,
      manifest: markerStore(),
    }),
    (error) => error instanceof RecoveryEvidenceError && error.code === "recovery_marker_write_indeterminate",
  );

  const database = markerStore();
  const objectStorage = markerStore();
  const manifest = markerStore();
  const originalRead = manifest.read;
  manifest.read = async (cutId) => ({ ...(await originalRead(cutId)), objectRevision: "inventory:41" });
  await assert.rejects(
    persistRecoveryMarker({ input, database, objectStorage, manifest }),
    (error) => error.code === "recovery_marker_mismatch",
  );
});
