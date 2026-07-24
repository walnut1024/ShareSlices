const checks = Object.freeze([
  "duplicateWake",
  "lostWake",
  "containerTermination",
  "staleFence",
  "followOnWork",
]);

export class ProcessingFailureDrillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProcessingFailureDrillError";
    this.code = code;
  }
}

function validateAuthorization(authorization) {
  if (
    authorization?.schemaVersion !==
      "shareslices.processing-failure-drill-authorization/v1" ||
    !new Set(["pre_traffic", "deep"]).has(authorization.level) ||
    authorization.isolated !== true ||
    !/^sha256:[a-f0-9]{64}$/.test(authorization.releaseId ?? "") ||
    typeof authorization.operationId !== "string" ||
    authorization.operationId.length === 0 ||
    !Number.isSafeInteger(authorization.fencingToken) ||
    authorization.fencingToken <= 0 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(authorization.nonce ?? "") ||
    !Array.isArray(authorization.ownedResources) ||
    authorization.ownedResources.length === 0 ||
    authorization.ownedResources.some(
      (resource) => typeof resource !== "string" || resource.length === 0,
    )
  ) {
    throw new ProcessingFailureDrillError(
      "processing_failure_drill_authorization_invalid",
      "Processing failure drills require isolated pre-traffic or deep authorization.",
    );
  }
}

export async function runProcessingFailureDrill({
  authorization,
  probes,
  cleanup,
}) {
  validateAuthorization(authorization);
  if (
    !probes ||
    checks.some((name) => typeof probes[name] !== "function") ||
    typeof cleanup !== "function"
  ) {
    throw new ProcessingFailureDrillError(
      "processing_failure_drill_adapter_invalid",
      "Every processing failure probe and cleanup Adapter is required.",
    );
  }
  const context = Object.freeze({
    releaseId: authorization.releaseId,
    operationId: authorization.operationId,
    fencingToken: authorization.fencingToken,
    nonce: authorization.nonce,
    ownedResources: Object.freeze([...authorization.ownedResources]),
  });
  const results = [];
  let primaryError;
  try {
    for (const name of checks) {
      const result = await probes[name](context);
      if (
        result?.outcome !== "passed" ||
        !/^sha256:[a-f0-9]{64}$/.test(result.evidenceDigest ?? "")
      ) {
        throw new ProcessingFailureDrillError(
          "processing_failure_drill_check_failed",
          `Processing failure drill ${name} did not produce passing evidence.`,
        );
      }
      results.push(Object.freeze({
        id: name,
        outcome: "passed",
        evidenceDigest: result.evidenceDigest,
      }));
    }
  } catch (error) {
    primaryError = error;
  }

  let cleanupResult;
  try {
    cleanupResult = await cleanup(context);
  } catch {
    throw new ProcessingFailureDrillError(
      "processing_failure_drill_cleanup_indeterminate",
      "Processing failure-drill cleanup was indeterminate.",
    );
  }
  if (
    cleanupResult?.outcome !== "cleaned" ||
    cleanupResult.cleanedResources?.length !== authorization.ownedResources.length ||
    !authorization.ownedResources.every(
      (resource) => cleanupResult.cleanedResources.includes(resource),
    )
  ) {
    throw new ProcessingFailureDrillError(
      "processing_failure_drill_cleanup_incomplete",
      "Processing failure-drill cleanup did not remove every authorized resource.",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    schemaVersion: "shareslices.processing-failure-drill-evidence/v1",
    level: authorization.level,
    releaseId: authorization.releaseId,
    nonce: authorization.nonce,
    results: Object.freeze(results),
    cleanup: Object.freeze({
      outcome: "cleaned",
      resourceCount: cleanupResult.cleanedResources.length,
    }),
  });
}

