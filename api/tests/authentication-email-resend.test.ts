import { describe, expect, it, vi } from "vitest";
import {
  RESEND_API_URL,
  RESEND_IDEMPOTENCY_RETENTION_MS,
  RESEND_USER_AGENT,
  createAuthenticationEmailResendAdapter,
  freezeResendTransport,
  resendPayload,
  sendWithResend,
} from "../src/email/authentication-email-resend.js";

const payload = resendPayload("ShareSlices <onboarding@resend.dev>", {
  email: "delivered+shareslices@resend.dev",
  otp: "123456",
  type: "email-verification",
});

async function frozen() {
  return freezeResendTransport({
    logicalDeliveryId: "delivery-123",
    payload,
    providerNamespace: "team-a",
    senderDomain: "resend.dev",
    transportRevision: "test-v1",
    preSendAtMs: 1_000_000,
    safetyMarginMs: 300_000,
  });
}

describe("authentication email Resend transport", () => {
  it("prepares a bounded shared transport with the frozen provider request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: "message-1" }));
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-a",
      transportRevision: "test-v1",
      safetyMarginMs: 300_000,
      fetch,
    });
    const prepared = await adapter.prepare(
      { email: "delivered+shareslices@resend.dev", otp: "123456", type: "email-verification" },
      "delivery-123",
      new Date(1_000_000),
    );

    expect(prepared.snapshot).toMatchObject({
      adapter: "resend",
      providerNamespace: "team-a",
      senderIdentity: "ShareSlices <onboarding@resend.dev>",
      endpointIdentity: RESEND_API_URL,
      transportRevision: "test-v1",
      serializerRevision: "authentication-email-v1",
      localMessageId: "<delivery-123@shareslices.local>",
    });
    expect(prepared.snapshot.providerIdempotencyKey).toMatch(/^shareslices-email-v1\//);
    expect(prepared.snapshot.providerSafeReplayUntil).toEqual(
      new Date(1_000_000 + RESEND_IDEMPOTENCY_RETENTION_MS - 300_000),
    );
    await expect(prepared.send()).resolves.toEqual({
      classification: "provider_accepted",
      providerMessageId: "message-1",
    });
  });

  it("freezes deterministic identity and a non-extendable replay cutoff", async () => {
    const first = await frozen();
    const second = await frozen();
    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^shareslices-email-v1\/[a-f0-9]{64}$/);
    expect(first.providerSafeReplayUntilMs).toBe(
      1_000_000 + RESEND_IDEMPOTENCY_RETENTION_MS - 300_000,
    );
  });

  it("restores the first frozen key and cutoff instead of extending them", async () => {
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-a",
      transportRevision: "test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => Response.json({ id: "message-1" }),
    });
    const first = await adapter.prepare(
      { email: "delivered+shareslices@resend.dev", otp: "123456", type: "email-verification" },
      "delivery-123",
      new Date(1_000_000),
    );
    const replay = await adapter.prepare(
      { email: "delivered+shareslices@resend.dev", otp: "123456", type: "email-verification" },
      "delivery-123",
      new Date(10_000_000),
      first.snapshot,
    );

    expect(replay.snapshot).toEqual(first.snapshot);
  });

  it("refuses to replay a frozen request through a changed provider namespace", async () => {
    const firstAdapter = createAuthenticationEmailResendAdapter({
      apiKey: "secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-a",
      transportRevision: "test-v1",
      safetyMarginMs: 300_000,
    });
    const changedAdapter = createAuthenticationEmailResendAdapter({
      apiKey: "rotated-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-b",
      transportRevision: "test-v1",
      safetyMarginMs: 300_000,
    });
    const first = await firstAdapter.prepare(
      { email: "delivered+shareslices@resend.dev", otp: "123456", type: "email-verification" },
      "delivery-123",
      new Date(1_000_000),
    );

    await expect(changedAdapter.prepare(
      { email: "delivered+shareslices@resend.dev", otp: "123456", type: "email-verification" },
      "delivery-123",
      new Date(2_000_000),
      first.snapshot,
    )).rejects.toThrow("authentication_email_transport_snapshot_conflict");
  });

  it("refuses a declared sender domain that differs from the request", async () => {
    await expect(freezeResendTransport({
      logicalDeliveryId: "delivery-123",
      payload,
      providerNamespace: "team-a",
      senderDomain: "example.com",
      transportRevision: "test-v1",
      preSendAtMs: 1_000_000,
      safetyMarginMs: 300_000,
    })).rejects.toThrow("resend_sender_domain_mismatch");
  });

  it("sends the minimal stable HTTPS request without attachments", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: "message-1" }));
    const result = await sendWithResend({ apiKey: "secret-key", frozen: await frozen(), payload, fetch });

    expect(result).toEqual({ kind: "provider_accepted", providerMessageId: "message-1", status: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init = {}] = fetch.mock.calls[0]!;
    expect(url).toBe(RESEND_API_URL);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
      "User-Agent": RESEND_USER_AGENT,
    });
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(JSON.parse(init.body as string)).not.toHaveProperty("attachments");
  });

  it("refuses changed provider bytes under a frozen idempotency key", async () => {
    await expect(sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload: { ...payload, text: "changed" },
      fetch: vi.fn(),
    })).rejects.toThrow("resend_payload_changed");
  });

  it.each([
    ["invalid_idempotency_key", 400, "permanent_failure"],
    ["invalid_idempotent_request", 409, "permanent_failure"],
    ["concurrent_idempotent_requests", 409, "retryable"],
    ["daily_quota_exceeded", 429, "quota_exceeded"],
    ["monthly_quota_exceeded", 429, "quota_exceeded"],
    ["rate_limit_exceeded", 429, "retryable"],
    ["validation_error", 422, "permanent_failure"],
    ["missing_api_key", 401, "permanent_failure"],
    ["restricted_api_key", 403, "permanent_failure"],
    ["invalid_api_key", 403, "permanent_failure"],
    ["invalid_from_address", 422, "permanent_failure"],
    ["invalid_access", 403, "permanent_failure"],
    ["security_error", 403, "permanent_failure"],
    ["future_error", 400, "indeterminate"],
  ] as const)("classifies %s conservatively", async (name, status, kind) => {
    const result = await sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload,
      fetch: async () => Response.json({ name }, { status }),
    });
    expect(result.kind).toBe(kind);
    if (name === "future_error") expect(result).toMatchObject({ errorType: "unknown_error_type" });
  });

  it.each([
    [400, "indeterminate"],
    [500, "retryable"],
    [503, "retryable"],
  ] as const)("classifies a non-JSON %s response as %s", async (status, kind) => {
    const result = await sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload,
      fetch: async () => new Response("upstream response", {
        status,
        headers: { "Content-Type": "text/plain", "Retry-After": "17" },
      }),
    });
    expect(result).toEqual({
      kind,
      errorType: "non_json_response",
      status,
      retryAfter: "17",
    });
  });

  it("treats an undocumented JSON 5xx as retryable without trusting its type", async () => {
    await expect(sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload,
      fetch: async () => Response.json(
        { name: "future_server_error" },
        { status: 502, headers: { "Retry-After": "23" } },
      ),
    })).resolves.toEqual({
      kind: "retryable",
      errorType: "unknown_error_type",
      status: 502,
      retryAfter: "23",
    });
  });

  it("treats a nominal success without a provider message ID as indeterminate", async () => {
    await expect(sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload,
      fetch: async () => Response.json({}, { status: 200 }),
    })).resolves.toEqual({
      kind: "indeterminate",
      errorType: "unknown_error_type",
      status: 200,
      retryAfter: null,
    });
  });

  it("treats a network outcome as indeterminate and never returns the key", async () => {
    const result = await sendWithResend({
      apiKey: "secret-key",
      frozen: await frozen(),
      payload,
      fetch: async () => { throw new Error("network failed with secret-key"); },
    });
    expect(result).toEqual({ kind: "indeterminate", errorType: "network_error", status: null, retryAfter: null });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
