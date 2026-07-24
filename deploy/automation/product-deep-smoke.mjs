const steps = Object.freeze([
  "upload",
  "processing",
  "preview",
  "publish",
  "viewer",
  "unpublish",
  "gallery",
]);

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export class ProductDeepSmokeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProductDeepSmokeError";
    this.code = code;
  }
}

function validateAuthorization(authorization) {
  if (
    authorization?.schemaVersion !==
      "shareslices.product-deep-smoke-authorization/v1" ||
    authorization.level !== "deep" ||
    authorization.isolated !== true ||
    !["compose", "kubernetes", "cloudflare"].includes(authorization.target) ||
    !digestPattern.test(authorization.releaseId ?? "") ||
    typeof authorization.operationId !== "string" ||
    authorization.operationId.length === 0 ||
    !Number.isSafeInteger(authorization.fencingToken) ||
    authorization.fencingToken <= 0 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(authorization.nonce ?? "") ||
    !["eligible", "fail_closed"].includes(authorization.galleryExpectation) ||
    !Array.isArray(authorization.ownedResources) ||
    authorization.ownedResources.length === 0 ||
    new Set(authorization.ownedResources).size !==
      authorization.ownedResources.length ||
    authorization.ownedResources.some(
      (resource) => typeof resource !== "string" || resource.length === 0,
    )
  ) {
    throw new ProductDeepSmokeError(
      "product_deep_smoke_authorization_invalid",
      "Product deep smoke requires isolated, fenced, release-bound owned resources.",
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

export async function runProductDeepSmoke({
  authorization,
  probes,
  cleanup,
}) {
  validateAuthorization(authorization);
  if (
    !probes ||
    steps.some((step) => typeof probes[step] !== "function") ||
    typeof cleanup !== "function"
  ) {
    throw new ProductDeepSmokeError(
      "product_deep_smoke_adapter_invalid",
      "Product deep smoke requires every lifecycle probe and cleanup.",
    );
  }
  const ownedResources = Object.freeze([...authorization.ownedResources]);
  const context = Object.freeze({
    target: authorization.target,
    releaseId: authorization.releaseId,
    operationId: authorization.operationId,
    fencingToken: authorization.fencingToken,
    nonce: authorization.nonce,
    galleryExpectation: authorization.galleryExpectation,
    ownedResources,
  });
  const results = [];
  let primaryError;
  try {
    for (const step of steps) {
      const result = await probes[step](context);
      if (
        result?.outcome !== "passed" ||
        !digestPattern.test(result.evidenceDigest ?? "")
      ) {
        throw new ProductDeepSmokeError(
          "product_deep_smoke_probe_failed",
          `Product deep-smoke probe ${step} did not pass.`,
        );
      }
      results.push(Object.freeze({
        step,
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
    throw new ProductDeepSmokeError(
      "product_deep_smoke_cleanup_indeterminate",
      "Product deep-smoke cleanup was indeterminate.",
    );
  }
  if (
    cleanupResult?.outcome !== "cleaned" ||
    !cleanedExactly(ownedResources, cleanupResult.cleanedResources)
  ) {
    throw new ProductDeepSmokeError(
      "product_deep_smoke_cleanup_incomplete",
      "Product deep-smoke cleanup did not account for every owned resource.",
    );
  }
  if (primaryError) throw primaryError;

  return Object.freeze({
    schemaVersion: "shareslices.product-deep-smoke-evidence/v1",
    target: authorization.target,
    releaseId: authorization.releaseId,
    nonce: authorization.nonce,
    galleryExpectation: authorization.galleryExpectation,
    results: Object.freeze(results),
    cleanup: Object.freeze({
      outcome: "cleaned",
      resourceCount: ownedResources.length,
    }),
  });
}
