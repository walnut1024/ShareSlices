import { describe, expect, it, vi } from "vitest";
import { createAuthenticationEmailResendAdapter } from "../src/email/authentication-email-resend.js";
import { createAuthenticationEmailSmtpAdapter } from "../src/email/authentication-email-smtp.js";
import type { AuthenticationEmailTransportAdapter } from "../src/email/authentication-email-transport.js";

const payload = {
  email: "ada@example.com",
  otp: "123456",
  type: "email-verification",
} as const;
const deliveryId = "019f5a36-66df-7000-8000-000000000001";

type ContractFixture = Readonly<{
  adapter: AuthenticationEmailTransportAdapter;
  rotatedCredentialAdapter: AuthenticationEmailTransportAdapter;
  changedIdentityAdapter: AuthenticationEmailTransportAdapter;
  expected: Readonly<{
    adapter: "smtp" | "resend";
    providerNamespace: string;
    senderIdentity: string;
    endpointIdentity: string;
    transportRevision: string;
  }>;
  close(): void;
}>;

function smtpFixture(): ContractFixture {
  const options = {
    from: "ShareSlices <no-reply@example.com>",
    providerNamespace: "enterprise-relay",
    transportRevision: "smtp-v1",
    endpointIdentity: "smtp.example.com:587",
    tlsPolicy: "starttls-required" as const,
    dnsTimeoutMs: 1_000,
    connectionTimeoutMs: 1_000,
    greetingTimeoutMs: 1_000,
    socketTimeoutMs: 1_000,
  };
  const first = createAuthenticationEmailSmtpAdapter({
    ...options,
    url: "smtp://first:secret@smtp.example.com:587?requireTLS=true",
  });
  const rotated = createAuthenticationEmailSmtpAdapter({
    ...options,
    url: "smtp://rotated:new-secret@smtp.example.com:587?requireTLS=true",
  });
  const changed = createAuthenticationEmailSmtpAdapter({
    ...options,
    url: "smtp://first:secret@smtp.other.example.com:587?requireTLS=true",
    endpointIdentity: "smtp.other.example.com:587",
  });
  return {
    adapter: first,
    rotatedCredentialAdapter: rotated,
    changedIdentityAdapter: changed,
    expected: {
      adapter: "smtp",
      providerNamespace: options.providerNamespace,
      senderIdentity: options.from,
      endpointIdentity: options.endpointIdentity,
      transportRevision: options.transportRevision,
    },
    close() {
      first.close();
      rotated.close();
      changed.close();
    },
  };
}

function resendFixture(): ContractFixture {
  const options = {
    from: "ShareSlices <onboarding@resend.dev>",
    providerNamespace: "team-a",
    transportRevision: "resend-v1",
    safetyMarginMs: 300_000,
    fetch: vi.fn<typeof globalThis.fetch>(async () => Response.json({ id: "message-1" })),
  };
  return {
    adapter: createAuthenticationEmailResendAdapter({ ...options, apiKey: "first-secret" }),
    rotatedCredentialAdapter: createAuthenticationEmailResendAdapter({ ...options, apiKey: "rotated-secret" }),
    changedIdentityAdapter: createAuthenticationEmailResendAdapter({
      ...options,
      apiKey: "first-secret",
      providerNamespace: "team-b",
    }),
    expected: {
      adapter: "resend",
      providerNamespace: "team-a",
      senderIdentity: options.from,
      endpointIdentity: "https://api.resend.com/emails",
      transportRevision: options.transportRevision,
    },
    close() {},
  };
}

describe.each([
  ["enterprise SMTP", smtpFixture],
  ["Resend", resendFixture],
] as const)("shared authentication email transport contract: %s", (_name, createFixture) => {
  it("freezes declared non-secret identity before provider work", async () => {
    const fixture = createFixture();
    try {
      const prepared = await fixture.adapter.prepare(payload, deliveryId, new Date("2026-07-23T00:00:00Z"));
      expect(prepared.snapshot).toMatchObject({
        ...fixture.expected,
        serializerRevision: "authentication-email-v1",
        localMessageId: `<${deliveryId}@shareslices.local>`,
      });
      expect(prepared.snapshot.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      fixture.close();
    }
  });

  it("allows credential rotation only while the frozen transport identity remains unchanged", async () => {
    const fixture = createFixture();
    try {
      const first = await fixture.adapter.prepare(payload, deliveryId, new Date("2026-07-23T00:00:00Z"));
      await expect(fixture.rotatedCredentialAdapter.prepare(
        payload,
        deliveryId,
        new Date("2026-07-23T00:01:00Z"),
        first.snapshot,
      )).resolves.toMatchObject({ snapshot: first.snapshot });
      await expect(fixture.changedIdentityAdapter.prepare(
        payload,
        deliveryId,
        new Date("2026-07-23T00:01:00Z"),
        first.snapshot,
      )).rejects.toThrow("authentication_email_transport_snapshot_conflict");
    } finally {
      fixture.close();
    }
  });

  it("refuses changed provider bytes under a frozen delivery identity", async () => {
    const fixture = createFixture();
    try {
      const first = await fixture.adapter.prepare(payload, deliveryId, new Date("2026-07-23T00:00:00Z"));
      await expect(fixture.adapter.prepare(
        { ...payload, otp: "654321" },
        deliveryId,
        new Date("2026-07-23T00:01:00Z"),
        first.snapshot,
      )).rejects.toThrow();
    } finally {
      fixture.close();
    }
  });
});
