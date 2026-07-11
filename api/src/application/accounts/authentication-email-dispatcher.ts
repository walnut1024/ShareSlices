import { randomUUID } from "node:crypto";
import { decryptAuthenticationEmail } from "./authentication-email.js";
import { pool } from "../../db/client.js";
import { env } from "../../env.js";
import { apiLogger, exceptionAttributes } from "../../logging/index.js";

type DeliveryRow = { id: string; encrypted_payload: string; attempt_count: number };

async function sendHttp(payload: unknown, deliveryId: string): Promise<string | null> {
  if (!env.AUTH_EMAIL_HTTP_URL) throw new Error("Authentication email HTTP provider is not configured.");
  const response = await fetch(env.AUTH_EMAIL_HTTP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": deliveryId,
      ...(env.AUTH_EMAIL_HTTP_TOKEN ? { authorization: `Bearer ${env.AUTH_EMAIL_HTTP_TOKEN}` } : {})
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Authentication email provider returned ${response.status}.`);
  return response.headers.get("x-message-id");
}

export async function dispatchOneAuthenticationEmail(workerId: string = randomUUID()): Promise<boolean> {
  const client = await pool.connect();
  let delivery: DeliveryRow | undefined;
  try {
    await client.query("begin");
    await client.query(
      `update authentication_email_delivery
       set state = 'pending', lease_owner = null, lease_expires_at = null
       where state = 'sending' and lease_expires_at <= now()`
    );
    const claimed = await client.query<DeliveryRow>(
      `select id, encrypted_payload, attempt_count
       from authentication_email_delivery
       where state = 'pending' and available_at <= now()
       order by created_at
       for update skip locked limit 1`
    );
    delivery = claimed.rows[0];
    if (!delivery) {
      await client.query("commit");
      return false;
    }
    await client.query(
      `update authentication_email_delivery
       set state = 'sending', lease_owner = $2, lease_expires_at = now() + interval '30 seconds', attempt_count = attempt_count + 1
       where id = $1`,
      [delivery.id, workerId]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  try {
    const payload = decryptAuthenticationEmail(delivery.encrypted_payload, env.AUTH_EMAIL_ENCRYPTION_KEY);
    const providerMessageId = env.AUTH_EMAIL_DELIVERY_MODE === "capture"
      ? `capture:${delivery.id}`
      : await sendHttp(payload, delivery.id);
    await pool.query(
      `update authentication_email_delivery
       set state = 'sent', sent_at = now(), provider_message_id = $2,
           encrypted_payload = '', lease_owner = null, lease_expires_at = null
       where id = $1 and state = 'sending'`,
      [delivery.id, providerMessageId]
    );
    apiLogger.emit({
      severity: "INFO",
      body: "Authentication email delivered.",
      eventName: "shareslices.authentication_email.delivery.sent",
      attributes: { "shareslices.authentication_email.delivery.id": delivery.id }
    });
  } catch (error) {
    const retry = delivery.attempt_count + 1 < env.AUTH_EMAIL_MAX_ATTEMPTS;
    await pool.query(
      `update authentication_email_delivery
       set state = $2, available_at = case when $2 = 'pending' then now() + interval '30 seconds' else available_at end,
           failure_reason_code = 'provider_failure', lease_owner = null, lease_expires_at = null
       where id = $1`,
      [delivery.id, retry ? "pending" : "failed"]
    );
    if (!retry) {
      await pool.query(
        `update authentication_email_circuit_breaker
         set state = 'open', reason_code = 'provider_failure', opened_at = now(),
             resume_at = now() + ($1 * interval '1 second'), updated_at = now()
         where id = 'global'`,
        [env.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS]
      );
      apiLogger.emit({
        severity: "ERROR",
        body: "Authentication email circuit breaker opened.",
        eventName: "shareslices.authentication_email.circuit_breaker.opened",
        attributes: { "shareslices.authentication_email.reason_code": "provider_failure" }
      });
    }
    apiLogger.emit({
      severity: retry ? "WARN" : "ERROR",
      body: "Authentication email delivery failed.",
      eventName: "shareslices.authentication_email.delivery.failed",
      attributes: {
        "shareslices.authentication_email.delivery.id": delivery.id,
        "shareslices.retry.reason_code": "provider_failure",
        ...exceptionAttributes(error)
      }
    });
  }
  return true;
}

export async function reconcileExpiredAuthenticationEmailState(): Promise<void> {
  await pool.query("delete from password_reset_grant where expires_at < now() - interval '24 hours'");
  await pool.query("delete from email_verification_attempt where expires_at < now() - interval '24 hours'");
}

export function startAuthenticationEmailDispatcher(): () => void {
  const workerId = randomUUID();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void dispatchOneAuthenticationEmail(workerId).catch((error) => {
      apiLogger.emit({
        severity: "ERROR",
        body: "Authentication email dispatcher failed.",
        eventName: "shareslices.authentication_email.dispatcher.failed",
        attributes: exceptionAttributes(error)
      });
    });
    if (ticks % 60 === 0) {
      void reconcileExpiredAuthenticationEmailState().catch((error) => {
        apiLogger.emit({
          severity: "ERROR",
          body: "Authentication email reconciliation failed.",
          eventName: "shareslices.authentication_email.reconciliation.failed",
          attributes: exceptionAttributes(error)
        });
      });
    }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
