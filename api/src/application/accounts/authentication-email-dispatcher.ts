import { decryptAuthenticationEmail } from "./authentication-email.js";
import type { DatabaseClientSource } from "../../db/connection.js";
import { exceptionAttributes, type LogRecordInput } from "../../logging/log-record.js";
import type {
  AuthenticationEmailTransportAdapter,
  AuthenticationEmailTransportSnapshot,
  PreparedAuthenticationEmailTransport,
} from "../../email/authentication-email-transport.js";
import { ResendAuthenticationEmailTransportError } from "../../email/authentication-email-resend.js";
import { AuthenticationEmailSmtpTransportError } from "../../email/authentication-email-smtp.js";

type DeliveryRow = {
  id: string;
  encrypted_payload: string;
  delivery_revision: string | number;
  transport_adapter: "smtp" | "resend" | null;
  provider_namespace: string | null;
  sender_identity: string | null;
  endpoint_identity: string | null;
  transport_configuration_revision: string | null;
  serializer_revision: "authentication-email-v1" | null;
  payload_digest: string | null;
  provider_idempotency_key: string | null;
  provider_safe_replay_until: Date | null;
  local_message_id: string | null;
};

function frozenSnapshot(row: DeliveryRow): AuthenticationEmailTransportSnapshot | undefined {
  if (!row.transport_adapter) return undefined;
  if (
    !row.provider_namespace || !row.sender_identity || !row.endpoint_identity
    || !row.transport_configuration_revision || !row.serializer_revision
    || !row.payload_digest || !row.local_message_id
  ) throw new Error("authentication_email_transport_snapshot_incomplete");
  return {
    adapter: row.transport_adapter,
    providerNamespace: row.provider_namespace,
    senderIdentity: row.sender_identity,
    endpointIdentity: row.endpoint_identity,
    transportRevision: row.transport_configuration_revision,
    serializerRevision: row.serializer_revision,
    payloadDigest: row.payload_digest,
    providerIdempotencyKey: row.provider_idempotency_key,
    providerSafeReplayUntil: row.provider_safe_replay_until,
    localMessageId: row.local_message_id,
  };
}

function boundedRetryDelaySeconds(retryAfter: string | null, fallback: number): number {
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.min(3_600, Math.ceil(seconds)));
  const at = Date.parse(retryAfter);
  if (Number.isNaN(at)) return fallback;
  return Math.max(1, Math.min(3_600, Math.ceil((at - Date.now()) / 1_000)));
}
export type AuthenticationEmailDispatchInput = Readonly<{
  workerId: string;
  adapter: AuthenticationEmailTransportAdapter;
  timing: Readonly<{ leaseSeconds: number; heartbeatMs: number }>;
  databaseClients: DatabaseClientSource;
  encryptionKey: string;
  circuitBreakerSeconds: number;
  logger: Readonly<{ emit(input: LogRecordInput): void }>;
}>;

export async function dispatchOneAuthenticationEmail(
  input: AuthenticationEmailDispatchInput,
): Promise<boolean> {
  const { workerId, adapter, timing, databaseClients, encryptionKey, circuitBreakerSeconds, logger } = input;
  return databaseClients.withClient(async (client) => {
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
      logger.emit({
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
      `select id, encrypted_payload, delivery_revision, transport_adapter,
              provider_namespace, sender_identity, endpoint_identity,
              transport_configuration_revision, serializer_revision, payload_digest,
              provider_idempotency_key, provider_safe_replay_until, local_message_id
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
    payload = decryptAuthenticationEmail(delivery.encrypted_payload, encryptionKey);
    const existingSnapshot = frozenSnapshot(delivery);
    prepared = await adapter.prepare(payload, delivery.id, new Date(), existingSnapshot);
    const snapshot = prepared.snapshot;
    if (
      existingSnapshot?.adapter === "resend"
      && existingSnapshot.providerSafeReplayUntil
      && existingSnapshot.providerSafeReplayUntil <= new Date()
    ) {
      await client.query(
        `update authentication_email_delivery
         set state = 'manual_reconciliation', failure_reason_code = 'resend_safe_replay_cutoff_elapsed',
             lease_owner = null, lease_expires_at = null
         where id = $1 and state = 'pending'`,
        [delivery.id],
      );
      await client.query("commit");
      logger.emit({
        severity: "WARN",
        body: "Authentication email safe replay cutoff elapsed before provider submission.",
        eventName: "shareslices.authentication_email.delivery.manual_reconciliation_required",
        attributes: {
          "shareslices.authentication_email.delivery.id": delivery.id,
          "shareslices.retry.reason_code": "resend_safe_replay_cutoff_elapsed",
        },
      });
      return true;
    }
    fence = Number(delivery.delivery_revision) + 1;
    providerAttemptId = crypto.randomUUID();
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
      logger.emit({
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

    let providerMessageId: string | null;
    try {
      const result = await prepared.send();
      providerMessageId = result.providerMessageId;
    } catch (error) {
      try {
        await client.query("begin");
        if (error instanceof AuthenticationEmailSmtpTransportError && error.kind !== "acceptance_indeterminate") {
          const retryable = error.kind === "known_not_submitted_retryable";
          const attemptPhase = retryable ? "known_not_submitted" : "provider_rejected";
          await client.query(
            `update authentication_email_provider_attempt attempt
             set phase = $4, failure_reason_code = $5, quiescent_at = now(), updated_at = now()
             where attempt.id = $1 and attempt.delivery_id = $2 and attempt.fence = $3
               and attempt.phase in ('submitting', 'awaiting_final_acceptance')
               and exists (
                 select 1 from authentication_email_delivery delivery
                 where delivery.id = attempt.delivery_id and delivery.state = 'sending'
                   and delivery.lease_owner = $6 and delivery.delivery_revision = attempt.fence
               )`,
            [providerAttemptId, delivery.id, fence, attemptPhase, error.kind, workerId],
          );
          const transitioned = await client.query(
            `update authentication_email_delivery
             set state = $4,
                 available_at = case when $4 = 'pending' then now() + ($5 * interval '1 second') else available_at end,
                 result_classification = case when $4 = 'failed' then 'provider_rejected' else null end,
                 failure_reason_code = $6,
                 encrypted_payload = case when $4 = 'failed' then '' else encrypted_payload end,
                 lease_owner = null, lease_expires_at = null
             where id = $1 and state = 'sending' and lease_owner = $2 and delivery_revision = $3`,
            [delivery.id, workerId, fence, retryable ? "pending" : "failed", timing.leaseSeconds, error.kind],
          );
          await client.query("commit");
          if (transitioned.rowCount !== 1) {
            logger.emit({
              severity: "WARN",
              body: "Authentication email SMTP outcome arrived after lease ownership changed.",
              eventName: "shareslices.authentication_email.delivery.outcome_after_lease_lost",
              attributes: {
                "shareslices.authentication_email.delivery.id": delivery.id,
                "shareslices.retry.reason_code": "acceptance_indeterminate",
              },
            });
            return true;
          }
          logger.emit({
            severity: "WARN",
            body: retryable
              ? "Authentication email SMTP attempt was not submitted and is scheduled for retry."
              : "Authentication email SMTP relay rejected the message before submission.",
            eventName: retryable
              ? "shareslices.authentication_email.delivery.retry_scheduled"
              : "shareslices.authentication_email.delivery.provider_rejected",
            attributes: {
              "shareslices.authentication_email.delivery.id": delivery.id,
              "shareslices.retry.reason_code": error.kind,
            },
          });
          return true;
        }
        if (error instanceof ResendAuthenticationEmailTransportError) {
          const outcome = error.outcome;
          const now = new Date();
          const safeReplayUntil = prepared.snapshot.providerSafeReplayUntil;
          const beforeCutoff = safeReplayUntil !== null && now < safeReplayUntil;
          const knownNotSubmitted = outcome.kind === "quota_exceeded"
            || (outcome.kind === "retryable" && outcome.errorType === "rate_limit_exceeded");
          const shouldRetry = outcome.kind !== "permanent_failure" && beforeCutoff;
          const attemptPhase = knownNotSubmitted ? "known_not_submitted" : "acceptance_indeterminate";
          await client.query(
            `update authentication_email_provider_attempt attempt
             set phase = $4, failure_reason_code = $5, quiescent_at = now(), updated_at = now()
             where attempt.id = $1 and attempt.delivery_id = $2 and attempt.fence = $3
               and attempt.phase in ('submitting', 'awaiting_final_acceptance')`,
            [providerAttemptId, delivery.id, fence, attemptPhase, outcome.errorType],
          );
          if (shouldRetry) {
            const retryDelaySeconds = boundedRetryDelaySeconds(outcome.retryAfter, timing.leaseSeconds);
            const scheduled = await client.query(
              `update authentication_email_delivery
               set state = 'pending', available_at = greatest(
                     now() + ($4 * interval '1 second'),
                     (select maximum_call_deadline from authentication_email_provider_attempt where id = $5)
                   ),
                   failure_reason_code = $6, lease_owner = null, lease_expires_at = null
               where id = $1 and state = 'sending' and lease_owner = $2 and delivery_revision = $3`,
              [delivery.id, workerId, fence, retryDelaySeconds, providerAttemptId, outcome.errorType],
            );
            if (scheduled.rowCount !== 1) {
              await client.query("rollback");
              logger.emit({
                severity: "WARN",
                body: "Authentication email provider outcome arrived after lease ownership changed.",
                eventName: "shareslices.authentication_email.delivery.outcome_after_lease_lost",
                attributes: {
                  "shareslices.authentication_email.delivery.id": delivery.id,
                  "shareslices.retry.reason_code": "acceptance_indeterminate",
                },
              });
              return true;
            }
            await client.query("commit");
            await client.query(
              `update authentication_email_circuit_breaker
               set state = 'open', reason_code = 'provider_failure', opened_at = now(),
                   resume_at = now() + ($1 * interval '1 second'), updated_at = now()
               where id = 'global'`,
              [circuitBreakerSeconds],
            );
            logger.emit({
              severity: "WARN",
              body: "Authentication email provider request scheduled for safe replay.",
              eventName: "shareslices.authentication_email.delivery.retry_scheduled",
              attributes: {
                "shareslices.authentication_email.delivery.id": delivery.id,
                "shareslices.retry.reason_code": outcome.errorType,
              },
            });
            return true;
          }
          const requiresManualReconciliation = !knownNotSubmitted && outcome.kind !== "permanent_failure";
          const terminal = await client.query(
            `update authentication_email_delivery
             set state = $4,
                 result_classification = $5,
                 failure_reason_code = $6,
                 encrypted_payload = case when $4 = 'failed' then '' else encrypted_payload end,
                 lease_owner = null, lease_expires_at = null
             where id = $1 and state = 'sending' and lease_owner = $2 and delivery_revision = $3`,
            [
              delivery.id,
              workerId,
              fence,
              requiresManualReconciliation ? "manual_reconciliation" : "failed",
              requiresManualReconciliation ? null : "provider_rejected",
              requiresManualReconciliation ? "acceptance_indeterminate" : outcome.errorType,
            ],
          );
          if (terminal.rowCount !== 1) {
            await client.query("rollback");
            logger.emit({
              severity: "WARN",
              body: "Authentication email provider outcome arrived after lease ownership changed.",
              eventName: "shareslices.authentication_email.delivery.outcome_after_lease_lost",
              attributes: {
                "shareslices.authentication_email.delivery.id": delivery.id,
                "shareslices.retry.reason_code": "acceptance_indeterminate",
              },
            });
            return true;
          }
          if (requiresManualReconciliation) {
            await client.query(
              `update authentication_email_provider_attempt
               set phase = 'manual_reconciliation', updated_at = now()
               where id = $1 and phase = 'acceptance_indeterminate'`,
              [providerAttemptId],
            );
          } else {
            await client.query(
              `update authentication_email_provider_attempt
               set phase = 'provider_rejected', updated_at = now()
               where id = $1 and phase in ('known_not_submitted', 'acceptance_indeterminate')`,
              [providerAttemptId],
            );
          }
          await client.query("commit");
          logger.emit({
            severity: requiresManualReconciliation ? "ERROR" : "WARN",
            body: requiresManualReconciliation
              ? "Authentication email delivery requires manual reconciliation."
              : "Authentication email provider rejected the request.",
            eventName: requiresManualReconciliation
              ? "shareslices.authentication_email.delivery.manual_reconciliation_required"
              : "shareslices.authentication_email.delivery.provider_rejected",
            attributes: {
              "shareslices.authentication_email.delivery.id": delivery.id,
              "shareslices.retry.reason_code": requiresManualReconciliation
                ? "acceptance_indeterminate"
                : outcome.errorType,
            },
          });
          return true;
        }
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
          logger.emit({
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
          [circuitBreakerSeconds]
        );
        logger.emit({
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
      logger.emit({
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
    logger.emit({
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
