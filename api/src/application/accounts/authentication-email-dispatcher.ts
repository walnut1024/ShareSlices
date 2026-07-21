import { randomUUID } from "node:crypto";
import { decryptAuthenticationEmail } from "./authentication-email.js";
import { directConnection, pool } from "../../db/client.js";
import type { DirectClientSource } from "../../db/connection.js";
import { readMaintenanceEnv } from "../../env.js";
import {
  createAuthenticationEmailSmtpAdapter
} from "../../email/authentication-email-smtp.js";
import { apiLogger, exceptionAttributes } from "../../logging/index.js";
import type {
  AuthenticationEmailTransportAdapter,
  PreparedAuthenticationEmailTransport,
} from "../../email/authentication-email-transport.js";

type DeliveryRow = {
  id: string;
  encrypted_payload: string;
  delivery_revision: string | number;
};
const env = readMaintenanceEnv();

const smtpAdapter = createAuthenticationEmailSmtpAdapter({
  url: env.AUTH_EMAIL_SMTP_URL,
  from: env.AUTH_EMAIL_FROM,
  providerNamespace: env.AUTH_EMAIL_TRANSPORT_NAMESPACE,
  transportRevision: env.AUTH_EMAIL_TRANSPORT_REVISION,
  dnsTimeoutMs: env.AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS,
  connectionTimeoutMs: env.AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  greetingTimeoutMs: env.AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS,
  socketTimeoutMs: env.AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS
});

export async function dispatchOneAuthenticationEmail(
  workerId: string = randomUUID(),
  adapter: AuthenticationEmailTransportAdapter = smtpAdapter,
  timing: { leaseSeconds: number; heartbeatMs: number } = {
    leaseSeconds: env.AUTH_EMAIL_DELIVERY_LEASE_SECONDS,
    heartbeatMs: Math.max(100, Math.floor(env.AUTH_EMAIL_DELIVERY_LEASE_SECONDS * 1000 / 3))
  },
  directClients: DirectClientSource = directConnection,
): Promise<boolean> {
  return directClients.withClient(async (client) => {
    let delivery: DeliveryRow | undefined;
    let payload: ReturnType<typeof decryptAuthenticationEmail> | undefined;
    let providerAttemptId: string | undefined;
    let fence: number | undefined;
    let prepared: PreparedAuthenticationEmailTransport;
    try {
      await client.query("begin");
    const recovered = await client.query<{ id: string }>(
      `update authentication_email_delivery
       set state = 'manual_reconciliation', failure_reason_code = 'acceptance_indeterminate',
           lease_owner = null, lease_expires_at = null
       where state = 'sending' and lease_expires_at <= now()
       returning id`
    );
    for (const row of recovered.rows) {
      await client.query(
        `update authentication_email_provider_attempt
         set phase = 'manual_reconciliation', failure_reason_code = 'lease_expired_after_submission', updated_at = now()
         where delivery_id = $1 and phase in ('prepared', 'submitting', 'awaiting_final_acceptance')`,
        [row.id],
      );
      apiLogger.emit({
        severity: "WARN",
        body: "Ambiguous authentication email delivery requires manual reconciliation.",
        eventName: "shareslices.authentication_email.delivery.manual_reconciliation_required",
        attributes: {
          "shareslices.authentication_email.delivery.id": row.id,
          "shareslices.retry.reason_code": "acceptance_indeterminate"
        }
      });
    }
    const claimed = await client.query<DeliveryRow>(
      `select id, encrypted_payload, delivery_revision
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
    payload = decryptAuthenticationEmail(delivery.encrypted_payload, env.AUTH_EMAIL_ENCRYPTION_KEY);
    prepared = await adapter.prepare(payload, delivery.id, new Date());
    const snapshot = prepared.snapshot;
    fence = Number(delivery.delivery_revision) + 1;
    providerAttemptId = randomUUID();
    const claimedForSend = await client.query(
      `update authentication_email_delivery
       set state = 'sending', lease_owner = $2,
           lease_expires_at = now() + ($3 * interval '1 second'), attempt_count = attempt_count + 1,
           delivery_revision = $4, transport_adapter = coalesce(transport_adapter, $5),
           provider_namespace = coalesce(provider_namespace, $6),
           sender_identity = coalesce(sender_identity, $7), endpoint_identity = coalesce(endpoint_identity, $8),
           transport_configuration_revision = coalesce(transport_configuration_revision, $9),
           serializer_revision = coalesce(serializer_revision, $10), payload_digest = coalesce(payload_digest, $11),
           local_message_id = coalesce(local_message_id, $12),
           provider_idempotency_key = coalesce(provider_idempotency_key, $13),
           provider_safe_replay_until = coalesce(provider_safe_replay_until, $14)
       where id = $1 and state = 'pending'
         and (transport_adapter is null or (
           transport_adapter = $5 and provider_namespace = $6 and sender_identity = $7
           and endpoint_identity = $8 and transport_configuration_revision = $9
           and serializer_revision = $10 and payload_digest = $11 and local_message_id = $12
           and provider_idempotency_key is not distinct from $13
           and provider_safe_replay_until is not distinct from $14
         ))`,
      [delivery.id, workerId, timing.leaseSeconds, fence, snapshot.adapter, snapshot.providerNamespace,
        snapshot.senderIdentity, snapshot.endpointIdentity, snapshot.transportRevision,
        snapshot.serializerRevision, snapshot.payloadDigest, snapshot.localMessageId,
        snapshot.providerIdempotencyKey, snapshot.providerSafeReplayUntil]
    );
    if (claimedForSend.rowCount !== 1) throw new Error("authentication_email_transport_snapshot_conflict");
    await client.query(
      `insert into authentication_email_provider_attempt
        (id, delivery_id, fence, phase, maximum_call_deadline)
       values ($1, $2, $3, 'submitting', now() + ($4 * interval '1 second'))`,
      [providerAttemptId, delivery.id, fence, timing.leaseSeconds],
    );
    await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    const heartbeat = setInterval(() => {
    void client.query(
      `update authentication_email_delivery
       set lease_expires_at = now() + ($3 * interval '1 second')
       where id = $1 and state = 'sending' and lease_owner = $2`,
      [delivery.id, workerId, timing.leaseSeconds]
    ).catch((error) => {
      apiLogger.emit({
        severity: "ERROR",
        body: "Authentication email delivery lease renewal failed.",
        eventName: "shareslices.authentication_email.delivery.lease_renewal_failed",
        attributes: {
          "shareslices.authentication_email.delivery.id": delivery!.id,
          ...exceptionAttributes(error)
        }
      });
    });
    }, timing.heartbeatMs);
    heartbeat.unref();

    let providerMessageId: string | null;
    try {
      const result = await prepared.send();
      providerMessageId = result.providerMessageId;
    } catch (error) {
      try {
        await client.query("begin");
        const indeterminateAttempt = await client.query(
          `update authentication_email_provider_attempt attempt
           set phase = 'acceptance_indeterminate', failure_reason_code = 'provider_outcome_unknown', updated_at = now()
           where attempt.id = $1 and attempt.delivery_id = $2 and attempt.fence = $3
             and attempt.phase in ('submitting', 'awaiting_final_acceptance')
             and exists (
               select 1 from authentication_email_delivery delivery
               where delivery.id = attempt.delivery_id and delivery.state = 'sending'
                 and delivery.lease_owner = $4 and delivery.delivery_revision = attempt.fence
             )`,
          [providerAttemptId, delivery.id, fence, workerId],
        );
        const failed = indeterminateAttempt.rowCount === 1 ? await client.query(
          `update authentication_email_delivery
           set state = 'manual_reconciliation', failure_reason_code = 'acceptance_indeterminate',
               lease_owner = null, lease_expires_at = null
           where id = $1 and state = 'sending' and lease_owner = $2 and delivery_revision = $3`,
          [delivery.id, workerId, fence]
        ) : { rowCount: 0 };
        await client.query("commit");
        if (failed.rowCount === 0) {
          apiLogger.emit({
            severity: "WARN",
            body: "Authentication email delivery failed after lease ownership changed.",
            eventName: "shareslices.authentication_email.delivery.outcome_after_lease_lost",
            attributes: {
              "shareslices.authentication_email.delivery.id": delivery.id,
              "shareslices.retry.reason_code": "acceptance_indeterminate"
            }
          });
          return true;
        }
        await client.query(
          `update authentication_email_circuit_breaker
           set state = 'open', reason_code = 'provider_failure', opened_at = now(),
               resume_at = now() + ($1 * interval '1 second'), updated_at = now()
           where id = 'global'`,
          [env.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS]
        );
        apiLogger.emit({
          severity: "ERROR",
          body: "Authentication email delivery requires manual reconciliation.",
          eventName: "shareslices.authentication_email.delivery.manual_reconciliation_required",
          attributes: {
            "shareslices.authentication_email.delivery.id": delivery.id,
            "shareslices.retry.reason_code": "acceptance_indeterminate",
            ...exceptionAttributes(error)
          }
        });
        return true;
      } catch (persistenceError) {
        await client.query("rollback");
        throw persistenceError;
      } finally {
        clearInterval(heartbeat);
      }
    }

    try {
    await client.query("begin");
    const attemptCompleted = await client.query(
      `update authentication_email_provider_attempt attempt
       set phase = 'accepted', complete_submission_at = now(), updated_at = now()
       where attempt.id = $1 and attempt.delivery_id = $2 and attempt.fence = $3
         and attempt.phase in ('submitting', 'awaiting_final_acceptance')
         and exists (
           select 1 from authentication_email_delivery delivery
           where delivery.id = attempt.delivery_id and delivery.state = 'sending'
             and delivery.lease_owner = $4 and delivery.delivery_revision = attempt.fence
         )`,
      [providerAttemptId, delivery.id, fence, workerId],
    );
    const completed = attemptCompleted.rowCount === 1 ? await client.query(
      `update authentication_email_delivery
       set state = 'sent', sent_at = now(), provider_message_id = $2,
           result_classification = 'provider_accepted', encrypted_payload = '',
           lease_owner = null, lease_expires_at = null
       where id = $1 and state = 'sending' and lease_owner = $3 and delivery_revision = $4`,
      [delivery.id, providerMessageId, workerId, fence]
    ) : { rowCount: 0 };
    await client.query("commit");
    if (completed.rowCount === 0) {
      apiLogger.emit({
        severity: "WARN",
        body: "Authentication email delivery completed after lease ownership changed.",
        eventName: "shareslices.authentication_email.delivery.outcome_after_lease_lost",
        attributes: {
          "shareslices.authentication_email.delivery.id": delivery.id,
          "shareslices.retry.reason_code": "ambiguous_delivery_retry"
        }
      });
      return true;
    }
    apiLogger.emit({
      severity: "INFO",
      body: "Authentication email delivered.",
      eventName: "shareslices.authentication_email.delivery.sent",
      attributes: { "shareslices.authentication_email.delivery.id": delivery.id }
    });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  });
}

export async function reconcileExpiredAuthenticationEmailState(): Promise<void> {
  await pool.query(
    `update password_reset_grant set encrypted_code = '', claimed_at = null, claim_token = null
     where expires_at < now() and encrypted_code <> ''`
  );
  await pool.query(
    `update authentication_email_delivery d set encrypted_payload = ''
     from email_verification_attempt a
     where d.attempt_id = a.id and a.expires_at < now() and d.encrypted_payload <> ''`
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
  if (!options.keepAlive) timer.unref();
  return () => {
    clearInterval(timer);
    smtpAdapter.close();
  };
}
