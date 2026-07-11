import { randomUUID } from "node:crypto";
// cspell:ignore hashtext xact
import type { PoolClient } from "pg";
import {
  encryptAuthenticationEmail,
  newVerificationAttempt,
  safeHash,
  type AuthenticationEmailPayload,
  type VerificationAttempt,
  type VerificationPurpose
} from "../application/accounts/authentication-email.js";
import { env } from "../env.js";
import { apiLogger } from "../logging/index.js";
import { pool } from "./client.js";

export type DeliveryResult =
  | { status: "accepted"; resendAvailableIn: number }
  | { status: "waiting"; resendAvailableIn: number }
  | { status: "limited" }
  | { status: "unavailable" };

type AttemptRow = {
  id: string;
  purpose: VerificationPurpose;
  email: string;
  destination_hint: string;
  synthetic: boolean;
  expires_at: Date;
  verified_at: Date | null;
  consumed_at: Date | null;
};

function mapAttempt(row: AttemptRow): VerificationAttempt {
  return {
    id: row.id,
    purpose: row.purpose,
    email: row.email,
    destinationHint: row.destination_hint,
    synthetic: row.synthetic,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at
  };
}

export async function createVerificationAttempt(input: {
  email: string;
  purpose: VerificationPurpose;
  synthetic?: boolean;
}): Promise<VerificationAttempt> {
  const attempt = newVerificationAttempt(input);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`verification:${input.purpose}:${input.email}`]);
    await client.query(
      `update email_verification_attempt set consumed_at = now()
       where email = $1 and purpose = $2 and consumed_at is null and expires_at <= now()`,
      [input.email, input.purpose]
    );
    const existing = await client.query<AttemptRow>(
      `select id, purpose, email, destination_hint, synthetic, expires_at, verified_at, consumed_at
       from email_verification_attempt
       where email = $1 and purpose = $2 and consumed_at is null
       order by created_at desc limit 1`,
      [input.email, input.purpose]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].synthetic && !input.synthetic) {
        await client.query(
          "update email_verification_attempt set synthetic = false where id = $1",
          [existing.rows[0].id]
        );
        existing.rows[0].synthetic = false;
      }
      await client.query("commit");
      return mapAttempt(existing.rows[0]);
    }
    await client.query(
      `insert into email_verification_attempt
        (id, purpose, email, destination_hint, synthetic, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [attempt.id, attempt.purpose, attempt.email, attempt.destinationHint, attempt.synthetic, attempt.expiresAt]
    );
    await client.query("commit");
    return attempt;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function findVerificationAttempt(id: string): Promise<VerificationAttempt | null> {
  const result = await pool.query<AttemptRow>(
    `select id, purpose, email, destination_hint, synthetic, expires_at, verified_at, consumed_at
     from email_verification_attempt where id = $1`,
    [id]
  );
  return result.rows[0] ? mapAttempt(result.rows[0]) : null;
}

export async function findLatestVerificationAttempt(
  email: string,
  purpose: VerificationPurpose
): Promise<VerificationAttempt | null> {
  const result = await pool.query<AttemptRow>(
    `select id, purpose, email, destination_hint, synthetic, expires_at, verified_at, consumed_at
     from email_verification_attempt
     where email = $1 and purpose = $2 and expires_at > now() and consumed_at is null
     order by created_at desc limit 1`,
    [email, purpose]
  );
  return result.rows[0] ? mapAttempt(result.rows[0]) : null;
}

export async function markVerificationAttemptVerified(id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update email_verification_attempt
       set verified_at = coalesce(verified_at, now()), consumed_at = coalesce(consumed_at, now())
       where id = $1 and consumed_at is null and expires_at > now()`,
      [id]
    );
    await client.query("update authentication_email_delivery set encrypted_payload = '' where attempt_id = $1", [id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function terminateVerificationAttempt(id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update email_verification_attempt set consumed_at = coalesce(consumed_at, now()) where id = $1",
      [id]
    );
    await client.query("update authentication_email_delivery set encrypted_payload = '' where attempt_id = $1", [id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPasswordResetGrant(attemptId: string, encryptedCode: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into password_reset_grant (id, attempt_id, encrypted_code, expires_at)
     values ($1, $2, $3, now() + interval '10 minutes')
     on conflict (attempt_id) do update set
       id = excluded.id, encrypted_code = excluded.encrypted_code,
       created_at = now(), expires_at = excluded.expires_at, consumed_at = null`,
    [id, attemptId, encryptedCode]
  );
  return id;
}

export async function claimPasswordResetGrant(id: string): Promise<{
  email: string;
  encryptedCode: string;
} | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ email: string; encrypted_code: string }>(
      `select a.email, g.encrypted_code
       from password_reset_grant g
       join email_verification_attempt a on a.id = g.attempt_id
       where g.id = $1
         and (g.claimed_at is null or g.claimed_at < now() - interval '1 minute')
         and g.consumed_at is null and g.expires_at > now()
       for update of g`,
      [id]
    );
    const grant = result.rows[0];
    if (!grant) {
      await client.query("rollback");
      return null;
    }
    await client.query("update password_reset_grant set claimed_at = now() where id = $1", [id]);
    await client.query("commit");
    return { email: grant.email, encryptedCode: grant.encrypted_code };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function completePasswordResetGrant(id: string): Promise<void> {
  await pool.query(
    `update password_reset_grant
     set consumed_at = now(), claimed_at = null, encrypted_code = ''
     where id = $1 and claimed_at is not null and consumed_at is null`,
    [id]
  );
}

export async function releasePasswordResetGrant(id: string): Promise<void> {
  await pool.query(
    "update password_reset_grant set claimed_at = null where id = $1 and consumed_at is null",
    [id]
  );
}

async function countDeliveries(client: PoolClient, where: string, parameters: unknown[]): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from authentication_email_delivery
     where state in ('pending', 'sending', 'sent') and ${where}`,
    parameters
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function acceptAuthenticationEmailDelivery(input: {
  attemptId: string;
  email: string;
  purpose: VerificationPurpose | "password_changed";
  sourceIp: string;
  payload: AuthenticationEmailPayload;
  idempotencyKey?: string;
}): Promise<DeliveryResult> {
  const emailHash = safeHash(input.email, env.AUTH_EMAIL_ENCRYPTION_KEY);
  const sourceIpHash = safeHash(input.sourceIp || "unknown", env.AUTH_EMAIL_ENCRYPTION_KEY);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`auth-email:${emailHash}`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`auth-ip:${sourceIpHash}`]);

    if (input.idempotencyKey) {
      const repeated = await client.query(
        "select 1 from authentication_email_delivery where idempotency_key = $1",
        [input.idempotencyKey]
      );
      if (repeated.rowCount) {
        await client.query("commit");
        return { status: "accepted", resendAvailableIn: env.AUTH_EMAIL_RESEND_SECONDS };
      }
    }

    const breaker = await client.query<{ state: string; resume_at: Date | null }>(
      "select state, resume_at from authentication_email_circuit_breaker where id = 'global' for update"
    );
    const currentBreaker = breaker.rows[0];
    if (currentBreaker?.state === "open" && currentBreaker.resume_at && currentBreaker.resume_at > new Date()) {
      apiLogger.emit({
        severity: "WARN",
        body: "Authentication email delivery suppressed.",
        eventName: "shareslices.authentication_email.delivery.suppressed",
        attributes: { "shareslices.authentication_email.reason_code": "circuit_breaker_open" }
      });
      await client.query("commit");
      return { status: "unavailable" };
    }
    if (currentBreaker?.state === "open") {
      await client.query(
        "update authentication_email_circuit_breaker set state = 'closed', reason_code = null, opened_at = null, resume_at = null, updated_at = now() where id = 'global'"
      );
      apiLogger.emit({
        severity: "INFO",
        body: "Authentication email circuit breaker closed.",
        eventName: "shareslices.authentication_email.circuit_breaker.closed",
        attributes: {}
      });
    }

    const latest = await client.query<{ created_at: Date }>(
      `select created_at from authentication_email_delivery
       where email_hash = $1 and purpose = $2 and state in ('pending', 'sending', 'sent')
       order by created_at desc limit 1`,
      [emailHash, input.purpose]
    );
    if (latest.rows[0]) {
      const elapsed = (Date.now() - latest.rows[0].created_at.getTime()) / 1000;
      if (elapsed < env.AUTH_EMAIL_RESEND_SECONDS) {
        apiLogger.emit({
          severity: "INFO",
          body: "Authentication email delivery suppressed.",
          eventName: "shareslices.authentication_email.delivery.suppressed",
          attributes: { "shareslices.authentication_email.reason_code": "resend_wait" }
        });
        await client.query("commit");
        return { status: "waiting", resendAvailableIn: Math.ceil(env.AUTH_EMAIL_RESEND_SECONDS - elapsed) };
      }
    }

    const emailHour = await countDeliveries(
      client,
      "email_hash = $1 and purpose = $2 and created_at > now() - interval '1 hour'",
      [emailHash, input.purpose]
    );
    const emailDay = await countDeliveries(
      client,
      "email_hash = $1 and purpose = $2 and created_at > now() - interval '24 hours'",
      [emailHash, input.purpose]
    );
    const ipHour = await countDeliveries(
      client,
      "source_ip_hash = $1 and created_at > now() - interval '1 hour'",
      [sourceIpHash]
    );
    const ipDay = await countDeliveries(
      client,
      "source_ip_hash = $1 and created_at > now() - interval '24 hours'",
      [sourceIpHash]
    );
    const globalHour = await countDeliveries(client, "created_at > now() - interval '1 hour'", []);

    if (globalHour >= env.AUTH_EMAIL_GLOBAL_HOUR) {
      await client.query(
        `update authentication_email_circuit_breaker
         set state = 'open', reason_code = 'global_rate_exhausted', opened_at = now(),
             resume_at = now() + ($1 * interval '1 second'), updated_at = now()
         where id = 'global'`,
        [env.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS]
      );
      apiLogger.emit({
        severity: "WARN",
        body: "Authentication email circuit breaker opened.",
        eventName: "shareslices.authentication_email.circuit_breaker.opened",
        attributes: { "shareslices.authentication_email.reason_code": "global_rate_exhausted" }
      });
      await client.query("commit");
      return { status: "unavailable" };
    }
    if (
      emailHour >= env.AUTH_EMAIL_PER_EMAIL_HOUR ||
      emailDay >= env.AUTH_EMAIL_PER_EMAIL_DAY ||
      ipHour >= env.AUTH_EMAIL_PER_IP_HOUR ||
      ipDay >= env.AUTH_EMAIL_PER_IP_DAY
    ) {
      apiLogger.emit({
        severity: "WARN",
        body: "Authentication email delivery rate limited.",
        eventName: "shareslices.authentication_email.delivery.rate_limited",
        attributes: { "shareslices.authentication_email.reason_code": "protected_limit_exhausted" }
      });
      await client.query("commit");
      return { status: "limited" };
    }

    await client.query(
      `insert into authentication_email_delivery
       (id, attempt_id, email_hash, purpose, source_ip_hash, encrypted_payload, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.attemptId,
        emailHash,
        input.purpose,
        sourceIpHash,
        encryptAuthenticationEmail(input.payload, env.AUTH_EMAIL_ENCRYPTION_KEY),
        input.idempotencyKey ?? null
      ]
    );
    await client.query("commit");
    return { status: "accepted", resendAvailableIn: env.AUTH_EMAIL_RESEND_SECONDS };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
