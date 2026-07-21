const terminalPhaseFailures = new Set(["failed", "indeterminate"]);

export function deriveDeploymentStatus(input) {
  const optionalCapabilities = Object.fromEntries(
    Object.entries(input.optionalCapabilities ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const observedEvidence = Object.fromEntries([
    ["components", input.components],
    ["phases", input.phases],
    ["migration", input.migration],
    ["routeDigests", input.routeDigests],
    ["configurationDigests", input.configurationDigests],
    ["drift", input.drift],
    ["orphans", input.orphans],
  ].filter(([, value]) => value !== undefined));
  const base = {
    schemaVersion: "shareslices.deployment-status/v1",
    target: input.target,
    desiredReleaseId: input.desiredReleaseId ?? null,
    observedReleaseId: input.observedReleaseId ?? null,
    state: "desired",
    reasonCode: null,
    optionalCapabilities,
    ...(Object.keys(observedEvidence).length > 0 ? {evidence: observedEvidence} : {}),
  };
  if (input.observation === "indeterminate" || input.phases?.some(({ state }) => state === "indeterminate")) {
    return Object.freeze({ ...base, state: "indeterminate", reasonCode: "deployment_observation_indeterminate" });
  }
  const failedPhase = input.phases?.find(({ state }) => terminalPhaseFailures.has(state));
  if (failedPhase) {
    return Object.freeze({ ...base, state: "failed", reasonCode: failedPhase.reasonCode ?? "deployment_phase_failed" });
  }
  const blockedPhase = input.phases?.find(({ state }) => state === "blocked");
  if (blockedPhase) {
    return Object.freeze({ ...base, state: "phase-blocked", reasonCode: blockedPhase.reasonCode ?? "deployment_phase_blocked" });
  }
  if ((input.orphans ?? []).length > 0) {
    return Object.freeze({ ...base, state: "orphaned", reasonCode: "deployment_orphan_detected" });
  }
  if ((input.drift ?? []).length > 0) {
    return Object.freeze({ ...base, state: "drifted", reasonCode: "deployment_drift_detected" });
  }
  if (input.handoff && !input.handoff.observed) {
    return Object.freeze({ ...base, state: "handed-off", reasonCode: "external_reconciler_required" });
  }
  const components = input.components ?? [];
  const matching = components.filter(({ releaseId }) => releaseId === input.desiredReleaseId).length;
  if (matching > 0 && matching < components.length) {
    return Object.freeze({ ...base, state: "partial", reasonCode: "deployment_components_mixed" });
  }
  if (input.observedReleaseId === input.desiredReleaseId) {
    if (input.verification === "passed") {
      return Object.freeze({ ...base, state: "verified", reasonCode: null });
    }
    return Object.freeze({ ...base, state: "observed", reasonCode: "deployment_verification_pending" });
  }
  return Object.freeze(base);
}
