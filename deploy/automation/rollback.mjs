export function evaluateRollback({
  activeRelease,
  candidateRelease,
  availableProviderIdentities,
  availableSecretRevisions,
}) {
  const reasons = [];
  if (activeRelease.previousReleaseId !== candidateRelease.releaseId) {
    reasons.push("rollback_candidate_not_recorded");
  }
  if (activeRelease.compatibility.schemaHead !== candidateRelease.compatibility.schemaHead) {
    reasons.push("rollback_schema_incompatible");
  }
  if (activeRelease.compatibility.runtimeNMinus1 !== candidateRelease.compatibility.runtimeN) {
    reasons.push("rollback_runtime_incompatible");
  }
  if (activeRelease.contractRevisions.jobs !== candidateRelease.contractRevisions.jobs) {
    reasons.push("rollback_job_contract_incompatible");
  }

  const providerIdentities = new Set(
    availableProviderIdentities.map(({ kind, value }) => `${kind}:${value}`),
  );
  for (const artifact of candidateRelease.artifacts) {
    const identity = `${artifact.providerIdentity.kind}:${artifact.providerIdentity.value}`;
    if (!providerIdentities.has(identity)) reasons.push("rollback_provider_identity_unavailable");
  }
  const secretRevisions = new Set(
    availableSecretRevisions.map(({ logicalId, revision }) => `${logicalId}:${revision}`),
  );
  for (const secret of candidateRelease.secretRevisions) {
    if (!secretRevisions.has(`${secret.logicalId}:${secret.revision}`)) {
      reasons.push("rollback_secret_revision_unavailable");
    }
  }

  const refusalReasons = [...new Set(reasons)].sort();
  if (refusalReasons.length > 0) {
    return Object.freeze({ outcome: "refused", refusalReasons, actions: [] });
  }
  return Object.freeze({
    outcome: "ready",
    refusalReasons: [],
    actions: Object.freeze([
      { phase: "private-runtime", action: "restore_application_artifacts" },
      { phase: "public-runtime", action: "restore_routes_and_configuration" },
      { phase: "verification", action: "verify_restored_release" },
    ]),
  });
}
