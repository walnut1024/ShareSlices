const deliveryModes = Object.freeze([
  "kubernetes-direct",
  "kubernetes-external-cdn",
  "cloudflare-web-assets-only",
  "cloudflare-web-and-public-viewer-bytes",
]);

const checks = Object.freeze([
  "full-body-internal-hit",
  "range-206-bypass",
  "cached-unpublish",
  "cached-expiry",
  "cached-replacement",
  "cached-restriction",
]);

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export class ViewerCacheDeepVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ViewerCacheDeepVerificationError";
    this.code = code;
  }
}

function validateAuthorization(authorization) {
  if (
    authorization?.schemaVersion !==
      "shareslices.viewer-cache-deep-authorization/v1" ||
    authorization.level !== "deep" ||
    authorization.isolated !== true ||
    !deliveryModes.includes(authorization.deliveryMode) ||
    !digestPattern.test(authorization.releaseId ?? "") ||
    typeof authorization.operationId !== "string" ||
    authorization.operationId.length === 0 ||
    !Number.isSafeInteger(authorization.fencingToken) ||
    authorization.fencingToken <= 0 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(authorization.nonce ?? "") ||
    !Array.isArray(authorization.ownedResources) ||
    authorization.ownedResources.length === 0 ||
    new Set(authorization.ownedResources).size !==
      authorization.ownedResources.length ||
    authorization.ownedResources.some(
      (resource) => typeof resource !== "string" || resource.length === 0,
    )
  ) {
    throw new ViewerCacheDeepVerificationError(
      "viewer_cache_deep_authorization_invalid",
      "Viewer cache deep verification requires one isolated delivery mode and exact owned resources.",
    );
  }
}

function cleanedExactly(authorized, cleaned) {
  return (
    Array.isArray(cleaned) &&
    cleaned.length === authorized.length &&
    new Set(cleaned).size === cleaned.length &&
    authorized.every((resource) => cleaned.includes(resource))
  );
}

export async function runViewerCacheDeepVerification({
  authorization,
  probes,
  cleanup,
}) {
  validateAuthorization(authorization);
  if (
    !probes ||
    checks.some((check) => typeof probes[check] !== "function") ||
    typeof cleanup !== "function"
  ) {
    throw new ViewerCacheDeepVerificationError(
      "viewer_cache_deep_adapter_invalid",
      "Viewer cache deep verification requires every cache probe and cleanup.",
    );
  }
  const ownedResources = Object.freeze([...authorization.ownedResources]);
  const context = Object.freeze({
    deliveryMode: authorization.deliveryMode,
    releaseId: authorization.releaseId,
    operationId: authorization.operationId,
    fencingToken: authorization.fencingToken,
    nonce: authorization.nonce,
    ownedResources,
    internalViewerCacheExpected:
      authorization.deliveryMode ===
      "cloudflare-web-and-public-viewer-bytes",
  });
  const results = [];
  let primaryError;
  try {
    for (const check of checks) {
      const result = await probes[check](context);
      if (
        result?.outcome !== "passed" ||
        !digestPattern.test(result.evidenceDigest ?? "")
      ) {
        throw new ViewerCacheDeepVerificationError(
          "viewer_cache_deep_check_failed",
          `Viewer cache check ${check} did not pass.`,
        );
      }
      results.push(Object.freeze({
        check,
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
    throw new ViewerCacheDeepVerificationError(
      "viewer_cache_deep_cleanup_indeterminate",
      "Viewer cache deep-verification cleanup was indeterminate.",
    );
  }
  if (
    cleanupResult?.outcome !== "cleaned" ||
    !cleanedExactly(ownedResources, cleanupResult.cleanedResources)
  ) {
    throw new ViewerCacheDeepVerificationError(
      "viewer_cache_deep_cleanup_incomplete",
      "Viewer cache deep-verification cleanup was incomplete.",
    );
  }
  if (primaryError) throw primaryError;
  return Object.freeze({
    schemaVersion: "shareslices.viewer-cache-deep-evidence/v1",
    deliveryMode: authorization.deliveryMode,
    releaseId: authorization.releaseId,
    nonce: authorization.nonce,
    internalViewerCacheExpected: context.internalViewerCacheExpected,
    results: Object.freeze(results),
    cleanup: Object.freeze({
      outcome: "cleaned",
      resourceCount: ownedResources.length,
    }),
  });
}
