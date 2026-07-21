import { sha256Digest } from "./canonical.mjs";

export const deploymentPhases = Object.freeze([
  "control",
  "prerequisites",
  "migration",
  "private-runtime",
  "public-runtime",
  "verification",
  "retirement",
]);

function compareResources(desired, observed) {
  const desiredById = new Map(desired.map((resource) => [resource.logicalId, resource]));
  const observedById = new Map(observed.map((resource) => [resource.logicalId, resource]));
  const actions = [];
  for (const resource of desired) {
    const current = observedById.get(resource.logicalId);
    let action = "unchanged";
    const prerequisite = resource.phase === "prerequisites" || resource.owner === "external-prerequisite";
    if (prerequisite && !current) action = "prerequisite_missing";
    else if (prerequisite && current.digest !== resource.digest) action = "prerequisite_drift";
    else if (!current) action = "create";
    else if (current.digest !== resource.digest) action = resource.replacement ? "replace" : "update";
    actions.push({
      logicalId: resource.logicalId,
      phase: resource.phase,
      action,
      desiredDigest: resource.digest,
      observedDigest: current?.digest ?? null,
      securitySensitive: resource.securitySensitive === true,
      destructive: action === "replace" && resource.durable === true,
    });
  }
  for (const resource of observed) {
    if (desiredById.has(resource.logicalId)) continue;
    const owned = resource.owner === "deployment-module";
    const retained = ["durable", "rollback", "external"].includes(resource.retention);
    actions.push({
      logicalId: resource.logicalId,
      phase: "retirement",
      action: owned && !retained ? "retire" : "report_orphan",
      desiredDigest: null,
      observedDigest: resource.digest,
      securitySensitive: false,
      destructive: !owned || retained,
    });
  }
  return actions.sort((left, right) => {
    const phaseOrder = deploymentPhases.indexOf(left.phase) - deploymentPhases.indexOf(right.phase);
    return phaseOrder || left.logicalId.localeCompare(right.logicalId);
  });
}

export function buildDeploymentPlan({ desired, observed, controlSchemaChecksum }) {
  if (!desired || !observed || typeof controlSchemaChecksum !== "string") {
    throw new TypeError("Desired state, observed state, and control schema checksum are required.");
  }
  const firstInstallation = observed.controlSchema.state === "absent";
  const actions = compareResources(desired.resources, observed.resources);
  if (firstInstallation) {
    actions.unshift({
      logicalId: "deployment-control/schema",
      phase: "control",
      action: "bootstrap",
      desiredDigest: controlSchemaChecksum,
      observedDigest: null,
      securitySensitive: true,
      destructive: false,
    });
  } else if (observed.controlSchema.checksum !== controlSchemaChecksum) {
    actions.unshift({
      logicalId: "deployment-control/schema",
      phase: "control",
      action: "refuse",
      desiredDigest: controlSchemaChecksum,
      observedDigest: observed.controlSchema.checksum,
      securitySensitive: true,
      destructive: true,
    });
  }

  const refusalReasons = [];
  if (actions.some(({ action }) => action === "refuse")) {
    refusalReasons.push("deployment_control_schema_mismatch");
  }
  if (actions.some(({ destructive }) => destructive)) {
    refusalReasons.push("destructive_change_requires_review");
  }
  if (actions.some(({ action }) => action === "prerequisite_missing")) {
    refusalReasons.push("deployment_prerequisite_unavailable");
  }
  if (actions.some(({ action }) => action === "prerequisite_drift")) {
    refusalReasons.push("deployment_prerequisite_drift");
  }
  const body = {
    schemaVersion: "shareslices.deployment-plan/v1",
    target: desired.target,
    releaseId: desired.releaseId,
    observedStateRevision: observed.revision,
    firstInstallation,
    actions,
    outcome: refusalReasons.length === 0 ? "ready" : "refused",
    refusalReasons: [...new Set(refusalReasons)].sort(),
  };
  return Object.freeze({ ...body, planDigest: sha256Digest(body) });
}
