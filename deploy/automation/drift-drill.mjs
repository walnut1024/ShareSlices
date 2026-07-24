const dimensionsByTarget = Object.freeze({
  kubernetes: Object.freeze([
    "resources",
    "configuration-digests",
    "deployment-records",
  ]),
  cloudflare: Object.freeze([
    "versions",
    "routes",
    "bindings",
    "configuration-digests",
    "deployment-records",
  ]),
});

export class DriftDrillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DriftDrillError";
    this.code = code;
  }
}

function validateAuthorization(authorization) {
  const dimensions = dimensionsByTarget[authorization?.target];
  if (
    authorization?.schemaVersion !== "shareslices.drift-drill-authorization/v1" ||
    authorization?.level !== "deep" ||
    authorization.isolated !== true ||
    !dimensions ||
    !/^sha256:[a-f0-9]{64}$/.test(authorization.releaseId ?? "") ||
    typeof authorization.operationId !== "string" ||
    authorization.operationId.length === 0 ||
    !Number.isSafeInteger(authorization.fencingToken) ||
    authorization.fencingToken <= 0 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(authorization.nonce ?? "") ||
    !authorization.ownedResources ||
    dimensions.some(
      (dimension) =>
        !Array.isArray(authorization.ownedResources[dimension]) ||
        authorization.ownedResources[dimension].length === 0 ||
        authorization.ownedResources[dimension].some(
          (resource) => typeof resource !== "string" || resource.length === 0,
        ),
    ) ||
    Object.keys(authorization.ownedResources).some(
      (dimension) => !dimensions.includes(dimension),
    )
  ) {
    throw new DriftDrillError(
      "drift_drill_authorization_invalid",
      "Drift drills require an isolated deep authorization with exact owned resources.",
    );
  }
  return dimensions;
}

function cleanObservation(observation) {
  return observation?.outcome === "observed" &&
    Array.isArray(observation.drift) &&
    observation.drift.length === 0;
}

export async function runDriftDrill({authorization, adapter}) {
  const dimensions = validateAuthorization(authorization);
  if (
    !adapter ||
    typeof adapter.observe !== "function" ||
    typeof adapter.inject !== "function" ||
    typeof adapter.restore !== "function"
  ) {
    throw new DriftDrillError(
      "drift_drill_adapter_invalid",
      "Drift drills require observe, inject, and restore Adapters.",
    );
  }
  const context = Object.freeze({
    target: authorization.target,
    releaseId: authorization.releaseId,
    operationId: authorization.operationId,
    fencingToken: authorization.fencingToken,
    nonce: authorization.nonce,
  });
  if (!cleanObservation(await adapter.observe({...context, phase: "baseline"}))) {
    throw new DriftDrillError(
      "drift_drill_baseline_not_clean",
      "Drift drill baseline is not clean.",
    );
  }
  const results = [];
  for (const dimension of dimensions) {
    const resources = Object.freeze([
      ...authorization.ownedResources[dimension],
    ]);
    let injected = false;
    let primaryError;
    try {
      const injection = await adapter.inject({...context, dimension, resources});
      if (injection?.outcome !== "injected") {
        throw new DriftDrillError(
          "drift_drill_injection_indeterminate",
          `Drift injection for ${dimension} was indeterminate.`,
        );
      }
      injected = true;
      const observation = await adapter.observe({
        ...context,
        phase: "drifted",
        dimension,
      });
      if (
        observation?.outcome !== "observed" ||
        !Array.isArray(observation.drift) ||
        !observation.drift.some(
          (entry) =>
            entry.dimension === dimension &&
            typeof entry.reasonCode === "string" &&
            entry.reasonCode.length > 0,
        )
      ) {
        throw new DriftDrillError(
          "drift_drill_not_detected",
          `Injected ${dimension} drift was not detected.`,
        );
      }
      results.push(Object.freeze({
        dimension,
        outcome: "detected",
        reasonCodes: Object.freeze([
          ...new Set(
            observation.drift
              .filter((entry) => entry.dimension === dimension)
              .map(({reasonCode}) => reasonCode),
          ),
        ].sort()),
      }));
    } catch (error) {
      primaryError = error;
    }
    if (injected) {
      let restoration;
      try {
        restoration = await adapter.restore({...context, dimension, resources});
      } catch {
        throw new DriftDrillError(
          "drift_drill_restore_indeterminate",
          `Drift restoration for ${dimension} was indeterminate.`,
        );
      }
      if (restoration?.outcome !== "restored") {
        throw new DriftDrillError(
          "drift_drill_restore_incomplete",
          `Drift restoration for ${dimension} was incomplete.`,
        );
      }
      if (!cleanObservation(await adapter.observe({
        ...context,
        phase: "restored",
        dimension,
      }))) {
        throw new DriftDrillError(
          "drift_drill_restore_unverified",
          `Drift restoration for ${dimension} was not verified.`,
        );
      }
    }
    if (primaryError) throw primaryError;
  }
  return Object.freeze({
    schemaVersion: "shareslices.drift-drill-evidence/v1",
    target: authorization.target,
    releaseId: authorization.releaseId,
    nonce: authorization.nonce,
    results: Object.freeze(results),
  });
}
