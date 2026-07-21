export function inspectReleaseInventory({
  inventory,
  ownershipMarkers,
  observedResources,
  retainedRollbackIds = [],
}) {
  const expected = new Map(inventory.map((item) => [item.logicalId, item]));
  const retained = new Set(retainedRollbackIds);
  const known = [];
  const drift = [];
  const orphans = [];
  const retirementCandidates = [];

  for (const resource of observedResources) {
    const item = expected.get(resource.logicalId);
    const markerMatches = Object.entries(ownershipMarkers)
      .every(([key, value]) => resource.ownershipMarkers?.[key] === value);
    if (!item || !markerMatches) {
      orphans.push({
        logicalId: resource.logicalId,
        reasonCode: item ? "ownership_marker_mismatch" : "resource_absent_from_inventory",
      });
      continue;
    }
    known.push(resource.logicalId);
    if (resource.desiredDigest && resource.observedDigest !== resource.desiredDigest) {
      drift.push({
        logicalId: resource.logicalId,
        desiredDigest: resource.desiredDigest,
        observedDigest: resource.observedDigest ?? null,
      });
    }
    const releaseRetained = resource.releaseId && retained.has(resource.releaseId);
    if (
      resource.superseded === true &&
      item.owner === "deployment-module" &&
      item.retention === "active" &&
      !releaseRetained
    ) {
      retirementCandidates.push({
        logicalId: resource.logicalId,
        trafficAttached: resource.trafficAttached === true,
        scheduleAttached: resource.scheduleAttached === true,
      });
    }
  }
  return Object.freeze({
    known: known.sort(),
    drift: drift.sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    orphans: orphans.sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    retirementCandidates: retirementCandidates
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
  });
}

export function buildRetirementSequence(candidate) {
  const steps = [];
  if (candidate.trafficAttached) steps.push("detach_traffic");
  if (candidate.scheduleAttached) steps.push("detach_schedule");
  steps.push("verify_inactive", "remove_owned_resource");
  return Object.freeze({ logicalId: candidate.logicalId, steps: Object.freeze(steps) });
}

export function authorizeRetirement(inventoryResult, logicalId) {
  if (inventoryResult.orphans.some((orphan) => orphan.logicalId === logicalId)) {
    return Object.freeze({ authorized: false, reasonCode: "resource_ownership_unproven" });
  }
  const candidate = inventoryResult.retirementCandidates
    .find((resource) => resource.logicalId === logicalId);
  if (!candidate) {
    return Object.freeze({ authorized: false, reasonCode: "resource_retirement_not_permitted" });
  }
  return Object.freeze({ authorized: true, sequence: buildRetirementSequence(candidate) });
}
