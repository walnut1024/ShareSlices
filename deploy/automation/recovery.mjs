import { canonicalBytes, sha256Digest } from "./canonical.mjs";

const evidenceKinds = [
  "postgresql",
  "objectStorage",
  "iacState",
  "releaseBundles",
  "deploymentJournal",
];

export function inspectRecoverabilityEvidence(recoverability, now = new Date()) {
  const results = [];
  for (const kind of evidenceKinds) {
    const evidence = recoverability?.[kind];
    if (!evidence) {
      results.push({ kind, state: "missing", reasonCode: "recovery_evidence_missing" });
      continue;
    }
    const observedAt = Date.parse(evidence.observedAt);
    const maximumAgeMs = evidence.maximumAgeSeconds * 1000;
    if (!Number.isFinite(observedAt) || observedAt > now.getTime() || now.getTime() - observedAt > maximumAgeMs) {
      results.push({ kind, state: "stale", reasonCode: "recovery_evidence_stale" });
      continue;
    }
    results.push({ kind, state: "current", reasonCode: null });
  }
  return Object.freeze({
    ready: results.every(({ state }) => state === "current"),
    results: Object.freeze(results),
  });
}

export function createRecoveryMarker(input) {
  const identity = {
    schemaVersion: "shareslices.recovery-marker/v1",
    installationId: input.installationId,
    databaseRevision: input.databaseRevision,
    objectRevision: input.objectRevision,
    createdAt: input.createdAt,
  };
  return Object.freeze({ ...identity, cutId: sha256Digest(identity) });
}

export function verifyRecoveryMarkers({ database, objectStorage, manifest }) {
  if (!database || !objectStorage || !manifest) {
    return Object.freeze({ ready: false, reasonCode: "recovery_marker_missing" });
  }
  const canonical = canonicalBytes(database);
  if (
    !canonical.equals(canonicalBytes(objectStorage)) ||
    !canonical.equals(canonicalBytes(manifest))
  ) {
    return Object.freeze({ ready: false, reasonCode: "recovery_marker_mismatch" });
  }
  const recreated = createRecoveryMarker(database);
  if (recreated.cutId !== database.cutId) {
    return Object.freeze({ ready: false, reasonCode: "recovery_marker_digest_invalid" });
  }
  return Object.freeze({ ready: true, reasonCode: null, marker: database });
}
