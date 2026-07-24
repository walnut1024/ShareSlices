const dimensions = Object.freeze([
  "registrable-site",
  "credentials",
  "governance",
  "content",
  "network",
]);

const failureReasons = Object.freeze({
  "registrable-site": "gallery_registrable_site_unproven",
  credentials: "gallery_credentials_unproven",
  governance: "gallery_governance_unavailable",
  content: "gallery_content_unavailable",
  network: "gallery_network_policy_unavailable",
});

const evidenceMaxAgeMilliseconds = 60_000;
const releasePattern = /^sha256:[a-f0-9]{64}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export class GalleryReadinessVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GalleryReadinessVerificationError";
    this.code = code;
  }
}

function validateAuthorization(authorization) {
  if (
    authorization?.schemaVersion !==
      "shareslices.gallery-readiness-authorization/v1" ||
    !["pre_traffic", "deep"].includes(authorization.level) ||
    !["kubernetes", "cloudflare"].includes(authorization.target) ||
    !releasePattern.test(authorization.releaseId ?? "")
  ) {
    throw new GalleryReadinessVerificationError(
      "gallery_readiness_authorization_invalid",
      "Gallery readiness requires release-bound pre-traffic or deep authorization.",
    );
  }
}

function classifyObservation(dimension, observation, nowMilliseconds) {
  if (
    !observation ||
    !["passed", "failed", "indeterminate"].includes(observation.outcome)
  ) {
    return {
      dimension,
      outcome: "indeterminate",
      reasonCode: "gallery_observation_invalid",
      evidenceDigest: null,
    };
  }
  const observedAt = Date.parse(observation.observedAt ?? "");
  const fresh =
    Number.isFinite(observedAt) &&
    observedAt <= nowMilliseconds &&
    nowMilliseconds - observedAt <= evidenceMaxAgeMilliseconds;
  if (!fresh) {
    return {
      dimension,
      outcome: "indeterminate",
      reasonCode: "gallery_evidence_stale",
      evidenceDigest: null,
    };
  }
  if (!digestPattern.test(observation.evidenceDigest ?? "")) {
    return {
      dimension,
      outcome: "indeterminate",
      reasonCode: "gallery_evidence_invalid",
      evidenceDigest: null,
    };
  }
  return {
    dimension,
    outcome: observation.outcome,
    reasonCode:
      observation.outcome === "passed"
        ? null
        : failureReasons[dimension],
    evidenceDigest: observation.evidenceDigest,
  };
}

export async function verifyGalleryReadiness({
  authorization,
  observer,
  now = new Date(),
}) {
  validateAuthorization(authorization);
  if (typeof observer !== "function" || !Number.isFinite(now.getTime())) {
    throw new GalleryReadinessVerificationError(
      "gallery_readiness_verifier_invalid",
      "Gallery readiness requires an observer and a valid verification time.",
    );
  }
  const results = [];
  for (const dimension of dimensions) {
    let observation;
    try {
      observation = await observer({
        target: authorization.target,
        releaseId: authorization.releaseId,
        level: authorization.level,
        dimension,
      });
    } catch {
      observation = {outcome: "indeterminate"};
    }
    results.push(Object.freeze(
      classifyObservation(dimension, observation, now.getTime()),
    ));
  }
  const state = results.every(({outcome}) => outcome === "passed")
    ? "passed"
    : results.some(({outcome}) => outcome === "indeterminate")
      ? "indeterminate"
      : "failed";
  return Object.freeze({
    schemaVersion: "shareslices.gallery-readiness-evidence/v1",
    target: authorization.target,
    releaseId: authorization.releaseId,
    state,
    enabled: state === "passed",
    results: Object.freeze(results),
  });
}
