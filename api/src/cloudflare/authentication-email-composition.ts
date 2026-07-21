import type { AuthenticationEmailDispatchInput } from "../application/accounts/authentication-email-dispatcher.js";
import { createDatabaseConnection } from "../db/connection.js";
import { createAuthenticationEmailResendAdapter } from "../email/authentication-email-resend.js";
import type { LogRecordInput } from "../logging/log-record.js";
import type { CloudflareJobWake } from "./job-wake.js";

export type CloudflareAuthenticationEmailBindings = Readonly<{
  HYPERDRIVE: Readonly<{ connectionString: string }>;
  AUTH_EMAIL_ENCRYPTION_KEY: string;
  RESEND_API_KEY: string;
  AUTH_EMAIL_FROM: string;
  AUTH_EMAIL_PROVIDER_NAMESPACE: string;
  AUTH_EMAIL_TRANSPORT_REVISION: string;
  AUTH_EMAIL_RESEND_SAFETY_MARGIN_SECONDS: string;
  AUTH_EMAIL_DELIVERY_LEASE_SECONDS: string;
  AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS: string;
}>;

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid_cloudflare_binding_${name}`);
  return parsed;
}

export function createCloudflareAuthenticationEmailComposition(input: Readonly<{
  logger: Readonly<{ emit(record: LogRecordInput): void }>;
  fetch?: typeof fetch;
}>) {
  return (
    bindings: CloudflareAuthenticationEmailBindings,
    wake: CloudflareJobWake,
  ): AuthenticationEmailDispatchInput & Readonly<{ dispose(): Promise<void> }> => {
    const leaseSeconds = positiveInteger("delivery_lease_seconds", bindings.AUTH_EMAIL_DELIVERY_LEASE_SECONDS);
    const safetyMarginSeconds = positiveInteger(
      "resend_safety_margin_seconds",
      bindings.AUTH_EMAIL_RESEND_SAFETY_MARGIN_SECONDS,
    );
    const connection = createDatabaseConnection({
      mode: "hyperdrive",
      cache: "disabled",
      connectionString: bindings.HYPERDRIVE.connectionString,
      maxConnections: 1,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });
    return {
      workerId: `cloudflare:${wake.wakeId}`,
      adapter: createAuthenticationEmailResendAdapter({
        apiKey: bindings.RESEND_API_KEY,
        from: bindings.AUTH_EMAIL_FROM,
        providerNamespace: bindings.AUTH_EMAIL_PROVIDER_NAMESPACE,
        transportRevision: bindings.AUTH_EMAIL_TRANSPORT_REVISION,
        safetyMarginMs: safetyMarginSeconds * 1_000,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      }),
      timing: {
        leaseSeconds,
        heartbeatMs: Math.max(100, Math.floor(leaseSeconds * 1_000 / 3)),
      },
      databaseClients: connection,
      encryptionKey: bindings.AUTH_EMAIL_ENCRYPTION_KEY,
      circuitBreakerSeconds: positiveInteger(
        "circuit_breaker_seconds",
        bindings.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS,
      ),
      logger: input.logger,
      dispose: () => connection.close(),
    };
  };
}
