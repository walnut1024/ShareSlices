import { describe, expect, it, vi } from "vitest";
import { createCloudflareAuthenticationEmailComposition } from "../src/cloudflare/authentication-email-composition.js";
import { createCloudflareJobWake } from "../src/cloudflare/job-wake.js";

const bindings = {
  HYPERDRIVE: { connectionString: "postgres://user:password@hyperdrive.example.test/shareslices" },
  AUTH_EMAIL_ENCRYPTION_KEY: "test-email-encryption-key-at-least-32-bytes",
  RESEND_API_KEY: "secret-resend-key",
  AUTH_EMAIL_FROM: "ShareSlices <onboarding@resend.dev>",
  AUTH_EMAIL_PROVIDER_NAMESPACE: "team-a",
  AUTH_EMAIL_TRANSPORT_REVISION: "resend-v1",
  AUTH_EMAIL_RESEND_SAFETY_MARGIN_SECONDS: "300",
  AUTH_EMAIL_DELIVERY_LEASE_SECONDS: "30",
  AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: "300",
};

describe("Cloudflare authentication email composition", () => {
  it("composes cache-disabled Hyperdrive and Resend from bindings without process environment", async () => {
    const compose = createCloudflareAuthenticationEmailComposition({ logger: { emit: vi.fn() } });
    const wake = createCloudflareJobWake({
      lane: "authentication-email",
      wakeId: "019f738a-c4e0-7000-8000-000000000001",
    });
    const result = compose(bindings, wake);

    expect(result.workerId).toBe(`cloudflare:${wake.wakeId}`);
    expect(result.databaseClients.mode).toBe("hyperdrive");
    expect(result.timing).toEqual({ leaseSeconds: 30, heartbeatMs: 10_000 });
    expect(JSON.stringify({ wake, workerId: result.workerId })).not.toContain("secret-resend-key");
    await result.dispose();
  });

  it("rejects invalid numeric bindings before opening provider work", () => {
    const compose = createCloudflareAuthenticationEmailComposition({ logger: { emit: vi.fn() } });
    expect(() => compose({ ...bindings, AUTH_EMAIL_DELIVERY_LEASE_SECONDS: "0" }, createCloudflareJobWake({
      lane: "authentication-email",
    }))).toThrow("invalid_cloudflare_binding_delivery_lease_seconds");
  });
});
