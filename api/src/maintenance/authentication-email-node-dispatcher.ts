import { randomUUID } from "node:crypto";
import {
  dispatchOneAuthenticationEmail as dispatchBoundedAuthenticationEmail,
} from "../application/accounts/authentication-email-dispatcher.js";
import { directConnection, pool } from "../db/client.js";
import type { DirectClientSource } from "../db/connection.js";
import { createAuthenticationEmailSmtpAdapter } from "../email/authentication-email-smtp.js";
import type { AuthenticationEmailTransportAdapter } from "../email/authentication-email-transport.js";
import { readMaintenanceEnv } from "../env.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";

const env = readMaintenanceEnv();
const smtpAdapter = createAuthenticationEmailSmtpAdapter({
  url: env.AUTH_EMAIL_SMTP_URL,
  from: env.AUTH_EMAIL_FROM,
  providerNamespace: env.AUTH_EMAIL_TRANSPORT_NAMESPACE,
  transportRevision: env.AUTH_EMAIL_TRANSPORT_REVISION,
  endpointIdentity: env.AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY,
  tlsPolicy: env.AUTH_EMAIL_SMTP_TLS_POLICY,
  dnsTimeoutMs: env.AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS,
  connectionTimeoutMs: env.AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  greetingTimeoutMs: env.AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS,
  socketTimeoutMs: env.AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS,
});

export async function dispatchOneAuthenticationEmail(
  workerId: string = randomUUID(),
  adapter: AuthenticationEmailTransportAdapter = smtpAdapter,
  timing: Readonly<{ leaseSeconds: number; heartbeatMs: number; maxAttempts?: number }> = {
    leaseSeconds: env.AUTH_EMAIL_DELIVERY_LEASE_SECONDS,
    heartbeatMs: Math.max(100, Math.floor(env.AUTH_EMAIL_DELIVERY_LEASE_SECONDS * 1_000 / 3)),
  },
  directClients: DirectClientSource = directConnection,
): Promise<boolean> {
  return dispatchBoundedAuthenticationEmail({
    workerId,
    adapter,
    timing,
    databaseClients: directClients,
    encryptionKey: env.AUTH_EMAIL_ENCRYPTION_KEY,
    circuitBreakerSeconds: env.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS,
    maxAttempts: timing.maxAttempts ?? env.AUTH_EMAIL_MAX_ATTEMPTS,
    logger: apiLogger,
  });
}

export async function reconcileExpiredAuthenticationEmailState(): Promise<void> {
  await pool.query(
    `update password_reset_grant set encrypted_code = '', claimed_at = null, claim_token = null
     where expires_at < now() and encrypted_code <> ''`,
  );
  await pool.query(
    `update authentication_email_delivery d set encrypted_payload = ''
     from email_verification_attempt a
     where d.attempt_id = a.id and a.expires_at < now() and d.encrypted_payload <> ''`,
  );
  await pool.query("delete from password_reset_grant where expires_at < now() - interval '24 hours'");
  await pool.query("delete from email_verification_attempt where expires_at < now() - interval '24 hours'");
}

export function startAuthenticationEmailDispatcher(
  options: { keepAlive?: boolean } = {},
): () => void {
  const workerId = randomUUID();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void dispatchOneAuthenticationEmail(workerId).catch((error) => {
      apiLogger.emit({
        severity: "ERROR",
        body: "Authentication email dispatcher failed.",
        eventName: "shareslices.authentication_email.dispatcher.failed",
        attributes: exceptionAttributes(error),
      });
    });
    if (ticks % 60 === 0) {
      void reconcileExpiredAuthenticationEmailState().catch((error) => {
        apiLogger.emit({
          severity: "ERROR",
          body: "Authentication email reconciliation failed.",
          eventName: "shareslices.authentication_email.reconciliation.failed",
          attributes: exceptionAttributes(error),
        });
      });
    }
  }, 1_000);
  if (!options.keepAlive) timer.unref();
  return () => {
    clearInterval(timer);
    smtpAdapter.close();
  };
}
