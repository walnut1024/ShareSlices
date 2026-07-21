import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEND_IDEMPOTENCY_RETENTION_MS,
  RESEND_USER_AGENT,
  assertRotationCompatible,
  buildSendRequest,
  classifyResponse,
  decideIndeterminateReplay,
  freezeTransport,
  payloadDigest,
  redactEvidence
} from "./resend-contract.mjs";

const payload = {
  from: "ShareSlices <onboarding@resend.dev>",
  to: ["delivered+shareslices@resend.dev"],
  subject: "ShareSlices Resend qualification",
  text: "Qualification message",
  html: "<p>Qualification message</p>"
};

function frozen(overrides = {}) {
  return freezeTransport({
    logicalDeliveryId: "delivery-123",
    payload,
    providerNamespace: "team-namespace-a",
    senderDomain: "resend.dev",
    transportRevision: "resend-test-v1",
    preSendAtMs: 1_000_000,
    safetyMarginMs: 5 * 60 * 1000,
    ...overrides
  });
}

test("builds the minimal direct HTTPS request with stable required headers", () => {
  const request = buildSendRequest({ apiKey: "secret-key", frozen: frozen(), payload });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers["User-Agent"], RESEND_USER_AGENT);
  assert.match(request.init.headers["Idempotency-Key"], /^shareslices-email-v1\//);
  assert.equal(request.init.headers.Authorization, "Bearer secret-key");
  assert.deepEqual(JSON.parse(request.init.body), payload);
});

test("logical delivery and payload produce one deterministic idempotency key", () => {
  assert.equal(frozen().idempotencyKey, frozen().idempotencyKey);
  assert.notEqual(
    frozen().idempotencyKey,
    freezeTransport({
      logicalDeliveryId: "delivery-456",
      payload,
      providerNamespace: "team-namespace-a",
      senderDomain: "resend.dev",
      transportRevision: "resend-test-v1",
      preSendAtMs: 1_000_000,
      safetyMarginMs: 5 * 60 * 1000
    }).idempotencyKey
  );
  assert.throws(
    () => buildSendRequest({ apiKey: "secret-key", frozen: frozen(), payload: { ...payload, text: "changed" } }),
    /resend_payload_changed/
  );
});

test("freezes a conservative non-extendable replay cutoff", () => {
  const transport = frozen();
  assert.equal(
    transport.providerSafeReplayUntilMs,
    1_000_000 + RESEND_IDEMPOTENCY_RETENTION_MS - 5 * 60 * 1000
  );
  assert.equal(
    decideIndeterminateReplay({
      frozen: transport,
      nowMs: transport.providerSafeReplayUntilMs - 1,
      previousDeadlineMs: 1_000_001,
      quiescent: true,
      candidateTransport: transport,
      payload
    }),
    "replay_same_request"
  );
  assert.equal(
    decideIndeterminateReplay({
      frozen: transport,
      nowMs: transport.providerSafeReplayUntilMs,
      previousDeadlineMs: 1_000_001,
      quiescent: true,
      candidateTransport: transport,
      payload
    }),
    "manual_reconciliation"
  );
});

test("waits for deadline and observed quiescence before replay", () => {
  const transport = frozen();
  const input = {
    frozen: transport,
    nowMs: 2_000_000,
    previousDeadlineMs: 1_500_000,
    candidateTransport: transport,
    payload
  };
  assert.equal(decideIndeterminateReplay({ ...input, quiescent: false }), "wait");
  assert.equal(
    decideIndeterminateReplay({ ...input, nowMs: 1_500_000, quiescent: true }),
    "wait"
  );
});

test("allows attested credential rotation only inside the same namespace and sender domain", () => {
  const transport = frozen();
  assert.doesNotThrow(() =>
    assertRotationCompatible(transport, {
      providerNamespace: "team-namespace-a",
      senderDomain: "resend.dev",
      transportRevision: "resend-test-v2"
    })
  );
  assert.throws(
    () =>
      assertRotationCompatible(transport, {
        providerNamespace: "team-namespace-b",
        senderDomain: "resend.dev"
      }),
    /provider_namespace_rotation_refused/
  );
  assert.throws(
    () =>
      assertRotationCompatible(transport, {
        providerNamespace: "team-namespace-a",
        senderDomain: "example.com"
      }),
    /provider_namespace_rotation_refused/
  );
});

test("classifies acceptance, idempotency conflicts, quota, retryable, and unknown responses", async () => {
  const accepted = await classifyResponse(
    new Response(JSON.stringify({ id: "provider-message-1" }), {
      status: 200,
      headers: {
        "x-resend-daily-quota": "1/100",
        "x-resend-monthly-quota": "1/3000"
      }
    })
  );
  assert.equal(accepted.outcome, "provider_accepted");
  assert.equal(accepted.providerMessageId, "provider-message-1");
  assert.equal(accepted.quota.daily, "1/100");

  for (const [name, status, outcome] of [
    ["invalid_idempotent_request", 409, "permanent_failure"],
    ["concurrent_idempotent_requests", 409, "retryable"],
    ["daily_quota_exceeded", 429, "quota_exceeded"],
    ["monthly_quota_exceeded", 429, "quota_exceeded"],
    ["rate_limit_exceeded", 429, "retryable"],
    ["invalid_api_key", 403, "permanent_failure"],
    ["future_error", 503, "retryable"]
  ]) {
    const result = await classifyResponse(
      new Response(JSON.stringify({ name, message: "sensitive provider detail" }), { status })
    );
    assert.equal(result.outcome, outcome);
    assert.equal(result.errorType, name);
    assert.equal(result.quota.daily, "unknown");
  }

  const nonJson = await classifyResponse(new Response("upstream body", { status: 502 }));
  assert.equal(nonJson.outcome, "retryable");
  assert.equal(nonJson.errorType, "non_json_response");

  const typedError = await classifyResponse(
    new Response(JSON.stringify({ type: "monthly_quota_exceeded" }), { status: 429 })
  );
  assert.equal(typedError.outcome, "quota_exceeded");
});

test("redacts credentials, message content, addresses, and provider identifiers", () => {
  const redacted = redactEvidence({
    apiKey: "secret",
    authorization: "Bearer secret",
    body: { html: "secret html" },
    idempotencyKey: "stable-provider-key",
    to: "person@example.com",
    providerMessageId: "provider-message-1",
    outcome: "provider_accepted"
  });
  assert.equal(redacted.apiKey, "[REDACTED]");
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.body, "[REDACTED]");
  assert.equal(redacted.idempotencyKey, "[REDACTED]");
  assert.equal(redacted.to, "[REDACTED]");
  assert.match(redacted.providerMessageId, /^sha256:[a-f0-9]{16}$/);
  assert.equal(redacted.outcome, "provider_accepted");
  assert.equal(payloadDigest(payload).length, 64);
});
