import assert from "node:assert/strict";
import test from "node:test";

import {
  createRecoveryMarker,
  inspectRecoverabilityEvidence,
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
