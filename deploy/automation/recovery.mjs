import { canonicalBytes, sha256Digest } from "./canonical.mjs";

const evidenceKinds = [
  "postgresql",
  "objectStorage",
  "iacState",
  "releaseBundles",
  "deploymentJournal",
];

export class RecoveryEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RecoveryEvidenceError";
    this.code = code;
  }
}

function validEvidence(evidence) {
  return evidence &&
    [evidence.owner, evidence.encryptedLocation, evidence.retention]
      .every((value) => typeof value === "string" && value.length > 0) &&
    Number.isSafeInteger(evidence.maximumAgeSeconds) && evidence.maximumAgeSeconds > 0 &&
    Number.isSafeInteger(evidence.rpoSeconds) && evidence.rpoSeconds >= 0 &&
    Number.isSafeInteger(evidence.rtoSeconds) && evidence.rtoSeconds >= 0;
}

export function inspectRecoverabilityEvidence(recoverability, now = new Date()) {
  const results = [];
  for (const kind of evidenceKinds) {
    const evidence = recoverability?.[kind];
    if (!evidence) {
      results.push({ kind, state: "missing", reasonCode: "recovery_evidence_missing" });
      continue;
    }
    if (!validEvidence(evidence)) {
      results.push({ kind, state: "invalid", reasonCode: "recovery_evidence_invalid" });
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

function validateMarkerStore(store, name) {
  if (!store || typeof store.writeOnce !== "function" || typeof store.read !== "function") {
    throw new RecoveryEvidenceError(
      "recovery_marker_store_invalid",
      `${name} recovery marker store is invalid.`,
    );
  }
  return store;
}

export async function persistRecoveryMarker({ input, database, objectStorage, manifest }) {
  const stores = [
    ["database", validateMarkerStore(database, "Database")],
    ["objectStorage", validateMarkerStore(objectStorage, "Object-storage")],
    ["manifest", validateMarkerStore(manifest, "Manifest")],
  ];
  const marker = createRecoveryMarker(input);
  const writes = [];
  for (const [kind, store] of stores) {
    const outcome = await store.writeOnce(marker);
    if (!new Set(["created", "existing"]).has(outcome)) {
      throw new RecoveryEvidenceError(
        "recovery_marker_write_indeterminate",
        `${kind} recovery marker write was indeterminate.`,
      );
    }
    writes.push(Object.freeze({ kind, outcome }));
  }
  const observed = {
    database: await database.read(marker.cutId),
    objectStorage: await objectStorage.read(marker.cutId),
    manifest: await manifest.read(marker.cutId),
  };
  const verification = verifyRecoveryMarkers(observed);
  if (!verification.ready || verification.marker.cutId !== marker.cutId) {
    throw new RecoveryEvidenceError(
      verification.reasonCode ?? "recovery_marker_mismatch",
      "Durable recovery marker copies do not match the intended consistency cut.",
    );
  }
  return Object.freeze({ marker, writes: Object.freeze(writes) });
}
