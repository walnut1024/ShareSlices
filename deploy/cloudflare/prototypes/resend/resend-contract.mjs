import { createHash } from "node:crypto";

export const RESEND_API_URL = "https://api.resend.com/emails";
export const RESEND_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const RESEND_USER_AGENT = "ShareSlices-Cloudflare-qualification/1.0";

const retryableErrorTypes = new Set([
  "concurrent_idempotent_requests",
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error"
]);

const quotaErrorTypes = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

const permanentErrorTypes = new Set([
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "security_error"
]);

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function payloadDigest(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function deriveIdempotencyKey(logicalDeliveryId, digest) {
  const suffix = createHash("sha256")
    .update(`shareslices-resend-v1\0${logicalDeliveryId}\0${digest}`)
    .digest("base64url");
  return `shareslices-email-v1/${suffix}`;
}

export function freezeTransport({
  logicalDeliveryId,
  payload,
  providerNamespace,
  senderDomain,
  transportRevision,
  preSendAtMs,
  safetyMarginMs
}) {
  if (!providerNamespace || !senderDomain || !transportRevision) {
    throw new Error("transport_identity_incomplete");
  }
  if (!(safetyMarginMs > 0 && safetyMarginMs < RESEND_IDEMPOTENCY_RETENTION_MS)) {
    throw new Error("invalid_resend_safety_margin");
  }

  const digest = payloadDigest(payload);
  return Object.freeze({
    adapter: "resend",
    providerNamespace,
    senderDomain,
    transportRevision,
    payloadDigest: digest,
    idempotencyKey: deriveIdempotencyKey(logicalDeliveryId, digest),
    providerSafeReplayUntilMs:
      preSendAtMs + RESEND_IDEMPOTENCY_RETENTION_MS - safetyMarginMs
  });
}

export function assertRotationCompatible(frozen, candidate) {
  if (
    frozen.adapter !== "resend" ||
    candidate.providerNamespace !== frozen.providerNamespace ||
    candidate.senderDomain !== frozen.senderDomain
  ) {
    throw new Error("provider_namespace_rotation_refused");
  }
}

export function buildSendRequest({ apiKey, frozen, payload }) {
  if (!apiKey) {
    throw new Error("resend_api_key_missing");
  }
  if (payloadDigest(payload) !== frozen.payloadDigest) {
    throw new Error("resend_payload_changed");
  }

  return {
    url: RESEND_API_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": frozen.idempotencyKey,
        "User-Agent": RESEND_USER_AGENT
      },
      body: canonicalJson(payload)
    }
  };
}

function quotaHeaders(headers) {
  return {
    daily: headers.get("x-resend-daily-quota") ?? "unknown",
    monthly: headers.get("x-resend-monthly-quota") ?? "unknown",
    rateLimit: headers.get("ratelimit-limit") ?? "unknown",
    rateRemaining: headers.get("ratelimit-remaining") ?? "unknown",
    rateReset: headers.get("ratelimit-reset") ?? "unknown",
    retryAfter: headers.get("retry-after") ?? "unknown"
  };
}

export async function classifyResponse(response) {
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return {
      outcome: response.status >= 500 ? "retryable" : response.ok ? "indeterminate" : "provider_failure",
      errorType: "non_json_response",
      status: response.status,
      quota: quotaHeaders(response.headers)
    };
  }

  if (response.ok && typeof body.id === "string" && body.id.length > 0) {
    return {
      outcome: "provider_accepted",
      providerMessageId: body.id,
      status: response.status,
      quota: quotaHeaders(response.headers)
    };
  }

  const errorType =
    typeof body.name === "string"
      ? body.name
      : typeof body.type === "string"
        ? body.type
        : "unknown_error_type";
  let outcome = "provider_failure";
  if (quotaErrorTypes.has(errorType)) outcome = "quota_exceeded";
  else if (retryableErrorTypes.has(errorType)) outcome = "retryable";
  else if (permanentErrorTypes.has(errorType)) outcome = "permanent_failure";
  else if (response.status >= 500) outcome = "retryable";
  else if (response.status === 429) outcome = "retryable";

  return {
    outcome,
    errorType,
    status: response.status,
    quota: quotaHeaders(response.headers)
  };
}

export function decideIndeterminateReplay({
  frozen,
  nowMs,
  previousDeadlineMs,
  quiescent,
  candidateTransport,
  payload
}) {
  if (!quiescent || nowMs <= previousDeadlineMs) return "wait";
  if (nowMs >= frozen.providerSafeReplayUntilMs) return "manual_reconciliation";
  assertRotationCompatible(frozen, candidateTransport);
  if (payloadDigest(payload) !== frozen.payloadDigest) return "manual_reconciliation";
  return "replay_same_request";
}

export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/authorization|api.?key|idempotency.?key|body|html|text|from|to|subject/i.test(key)) {
        return [key, "[REDACTED]"];
      }
      if (/providerMessageId/i.test(key) && typeof item === "string") {
        return [key, `sha256:${createHash("sha256").update(item).digest("hex").slice(0, 16)}`];
      }
      return [key, redactEvidence(item)];
    })
  );
}
