const terminalPhaseFailures = new Set(["failed", "indeterminate"]);
const readinessDimensions = Object.freeze([
  "core",
  "email",
  "processing",
  "thumbnail",
  "cdn",
  "gallery",
]);
const readinessStates = new Set([
  "passed",
  "failed",
  "indeterminate",
  "unknown",
  "unavailable",
  "disabled",
  "not_applicable",
]);

function readinessReport(input, optionalCapabilities) {
  const supplied = input.readiness ?? {};
  return Object.fromEntries(readinessDimensions.map((dimension) => {
    const legacy = optionalCapabilities[dimension];
    const value = supplied[dimension] ?? legacy ?? (
      dimension === "core"
        ? {
            state: input.verification === "passed"
              ? "passed"
              : input.verification === "failed"
                ? "failed"
                : input.observation === "indeterminate"
                  ? "indeterminate"
                  : "unknown",
            reasonCode: input.verification === "passed"
              ? null
              : input.verification === "failed"
                ? "core_verification_failed"
                : input.observation === "indeterminate"
                  ? "core_verification_indeterminate"
                  : "core_verification_pending",
          }
        : {state: "unknown", reasonCode: `${dimension}_readiness_unknown`}
    );
    if (
      !value ||
      typeof value !== "object" ||
      !readinessStates.has(value.state) ||
      (value.required !== undefined && typeof value.required !== "boolean")
    ) {
      throw new TypeError(`Deployment readiness for ${dimension} is invalid.`);
    }
    const required = value.required ?? (dimension === "core");
    return [dimension, Object.freeze({
      state: value.state,
      required,
      verified: value.state === "passed",
      reasonCode: value.reasonCode ?? null,
    })];
  }));
}

export function deriveDeploymentStatus(input) {
  const optionalCapabilities = Object.fromEntries(
    Object.entries(input.optionalCapabilities ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const readiness = readinessReport(input, optionalCapabilities);
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
    readiness,
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
    const requiredReadinessPassed = Object.values(readiness)
      .filter(({required}) => required)
      .every(({state}) => state === "passed");
    if (input.verification === "passed" && requiredReadinessPassed) {
      return Object.freeze({ ...base, state: "verified", reasonCode: null });
    }
    return Object.freeze({
      ...base,
      state: "observed",
      reasonCode: input.verification === "passed"
        ? "required_capability_readiness_incomplete"
        : "deployment_verification_pending",
    });
  }
  return Object.freeze(base);
}
