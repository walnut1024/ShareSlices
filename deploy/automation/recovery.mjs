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

export async function runIsolatedRecoveryDrill({
  authorized,
  isolated,
  trafficEnabled,
  recoverability,
  restore,
  readMarkers,
  now = new Date(),
}) {
  if (authorized !== true) {
    throw new RecoveryEvidenceError(
      "recovery_drill_unauthorized",
      "Recovery drill requires explicit authorization.",
    );
  }
  if (isolated !== true || trafficEnabled !== false) {
    throw new RecoveryEvidenceError(
      "recovery_drill_not_isolated",
      "Recovery drill requires an isolated environment with traffic disabled.",
    );
  }

  const evidence = inspectRecoverabilityEvidence(recoverability, now);
  if (!evidence.ready) {
    throw new RecoveryEvidenceError(
      "recovery_evidence_unqualified",
      "Recovery drill requires current evidence for every recovery dependency.",
    );
  }
  if (!restore || typeof readMarkers !== "function") {
    throw new RecoveryEvidenceError(
      "recovery_drill_adapter_invalid",
      "Recovery drill restore and marker adapters are required.",
    );
  }

  const orderedSteps = [
    ["postgresql", restore.postgresql],
    ["objectStorage", restore.objectStorage],
    ["recoveryManifest", restore.recoveryManifest],
    ["deploymentJournal", restore.deploymentJournal],
    ["iacState", restore.iacState],
    ["releaseBundles", restore.releaseBundles],
  ];
  const completed = [];
  for (const [kind, step] of orderedSteps) {
    if (typeof step !== "function") {
      throw new RecoveryEvidenceError(
        "recovery_drill_adapter_invalid",
        `${kind} restore adapter is required.`,
      );
    }
    const outcome = await step();
    if (outcome?.restored !== true) {
      throw new RecoveryEvidenceError(
        "recovery_restore_failed",
        `${kind} restore did not complete.`,
      );
    }
    completed.push(kind);
  }

  const markerVerification = verifyRecoveryMarkers(await readMarkers());
  if (!markerVerification.ready) {
    throw new RecoveryEvidenceError(
      markerVerification.reasonCode ?? "recovery_marker_mismatch",
      "Restored recovery markers do not prove one compatible consistency cut.",
    );
  }

  return Object.freeze({
    ready: true,
    trafficEnabled: false,
    completed: Object.freeze(completed),
    cutId: markerVerification.marker.cutId,
  });
}
