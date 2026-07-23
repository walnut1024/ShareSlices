import { randomUUID, verify } from "node:crypto";
import { z } from "zod";
import type { DirectClientSource } from "../../db/connection.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const authenticationEmailReconciliationEnvelopeSchema = z.object({
  version: z.literal("shareslices-authentication-email-reconciliation-v1"),
  issuer: z.string().min(1),
  audience: z.string().min(1),
  subject: z.string().min(1),
  installation: z.string().min(1),
  action: z.literal("resolve-authentication-email-delivery"),
  deliveryId: z.string().min(1),
  expectedDeliveryRevision: z.number().int().nonnegative(),
  transportSnapshotRevision: z.number().int().nonnegative(),
  attemptId: z.string().min(1),
  attemptFence: z.number().int().positive(),
  providerNamespace: z.string().min(1),
  senderIdentity: z.string().min(1),
  localMessageId: z.string().min(1),
  providerMessageId: z.string().min(1).nullable(),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  providerSafeReplayUntil: timestamp.nullable(),
  decision: z.enum(["provider_accepted", "provider_rejected", "acceptance_unresolved"]),
  evidenceDigest: digest,
  nonce: z.string().min(16).max(256),
  issuedAt: timestamp,
  expiresAt: timestamp,
}).strict();

export type AuthenticationEmailReconciliationEnvelope = z.infer<
  typeof authenticationEmailReconciliationEnvelopeSchema
>;

export class AuthenticationEmailReconciliationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AuthenticationEmailReconciliationError";
  }
}

export function canonicalAuthenticationEmailReconciliationEnvelope(
  input: AuthenticationEmailReconciliationEnvelope,
): string {
  const envelope = authenticationEmailReconciliationEnvelopeSchema.parse(input);
  return JSON.stringify(envelope);
}

export function verifyAuthenticationEmailReconciliationAuthorization(input: Readonly<{
  envelope: unknown;
  signature: string;
  publicKeyPem: string;
  issuer: string;
  audience: string;
  installation: string;
  now: Date;
  maximumLifetimeSeconds: number;
}>): AuthenticationEmailReconciliationEnvelope {
  const parsed = authenticationEmailReconciliationEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success) throw new AuthenticationEmailReconciliationError("authorization_invalid");
  const envelope = parsed.data;
  if (envelope.issuer !== input.issuer || envelope.audience !== input.audience ||
      envelope.installation !== input.installation) {
    throw new AuthenticationEmailReconciliationError("authorization_scope_invalid");
  }
  const issuedAt = new Date(envelope.issuedAt);
  const expiresAt = new Date(envelope.expiresAt);
  if (issuedAt > input.now || expiresAt <= input.now || expiresAt <= issuedAt ||
      expiresAt.getTime() - issuedAt.getTime() > input.maximumLifetimeSeconds * 1_000) {
    throw new AuthenticationEmailReconciliationError("authorization_time_invalid");
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(input.signature, "base64url");
  } catch {
    throw new AuthenticationEmailReconciliationError("authorization_signature_invalid");
  }
  if (!verify(null, Buffer.from(canonicalAuthenticationEmailReconciliationEnvelope(envelope)), input.publicKeyPem, signature)) {
    throw new AuthenticationEmailReconciliationError("authorization_signature_invalid");
  }
  return envelope;
}

type LockedDelivery = Readonly<{
  id: string;
  state: string;
  delivery_revision: string | number;
  transport_snapshot_revision: string | number;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  transport_adapter: string;
  provider_namespace: string;
  sender_identity: string;
  payload_digest: string;
  provider_safe_replay_until: Date | null;
  local_message_id: string;
  provider_message_id: string | null;
  attempt_id: string;
  fence: string | number;
  phase: string;
  maximum_call_deadline: Date;
  quiescent_at: Date | null;
}>;

function sameTime(left: Date | null, right: string | null): boolean {
  return left === null ? right === null : right !== null && left.toISOString() === new Date(right).toISOString();
}

export async function reconcileAuthenticationEmailDelivery(input: Readonly<{
  envelope: unknown;
  signature: string;
  publicKeyPem: string;
  issuer: string;
  audience: string;
  installation: string;
  maximumLifetimeSeconds: number;
  providerSafetyMarginSeconds: number;
  databaseClients: DirectClientSource;
  now?: Date;
}>): Promise<Readonly<{ deliveryId: string; state: "sent" | "failed"; classification: string; repeated: boolean }>> {
  const now = input.now ?? new Date();
  const envelope = verifyAuthenticationEmailReconciliationAuthorization({ ...input, now });
  return input.databaseClients.withClient(async (client) => {
    await client.query("begin");
    try {
      try {
        await client.query(
          `insert into authentication_email_reconciliation_nonce
             (nonce, issuer, subject, installation, delivery_id, issued_at, expires_at, claimed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [envelope.nonce, envelope.issuer, envelope.subject, envelope.installation,
            envelope.deliveryId, envelope.issuedAt, envelope.expiresAt, now],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new AuthenticationEmailReconciliationError("authorization_replayed");
        }
        throw error;
      }
      const result = await client.query<LockedDelivery>(
        `select d.id, d.state, d.delivery_revision, d.transport_snapshot_revision,
                d.lease_owner, d.lease_expires_at,
                d.transport_adapter, d.provider_namespace, d.sender_identity, d.payload_digest,
                d.provider_safe_replay_until, d.local_message_id, d.provider_message_id,
                p.id as attempt_id, p.fence, p.phase, p.maximum_call_deadline, p.quiescent_at
           from authentication_email_delivery d
           join authentication_email_provider_attempt p on p.delivery_id = d.id and p.id = $2
           join email_verification_attempt verification on verification.id = d.attempt_id
          where d.id = $1
          for update of d, p, verification`,
        [envelope.deliveryId, envelope.attemptId],
      );
      const delivery = result.rows[0];
      if (!delivery) throw new AuthenticationEmailReconciliationError("delivery_not_found");
      await client.query(
        "select id from password_reset_grant where attempt_id = (select attempt_id from authentication_email_delivery where id = $1) for update",
        [delivery.id],
      );
      const identityMatches = Number(delivery.delivery_revision) === envelope.expectedDeliveryRevision &&
        Number(delivery.transport_snapshot_revision) === envelope.transportSnapshotRevision &&
        delivery.attempt_id === envelope.attemptId && Number(delivery.fence) === envelope.attemptFence &&
        delivery.provider_namespace === envelope.providerNamespace &&
        delivery.sender_identity === envelope.senderIdentity && delivery.local_message_id === envelope.localMessageId &&
        delivery.payload_digest === envelope.payloadDigest &&
        sameTime(delivery.provider_safe_replay_until, envelope.providerSafeReplayUntil);
      if (!identityMatches) throw new AuthenticationEmailReconciliationError("delivery_evidence_mismatch");

      const existing = await client.query<{
        decision: string; evidence_digest: string; resolved_delivery_revision: string | number;
        provider_message_id: string | null; transport_snapshot_revision: string | number;
      }>("select * from authentication_email_reconciliation_resolution where delivery_id = $1", [delivery.id]);
      const resolution = existing.rows[0];
      if (resolution) {
        if (Number(resolution.resolved_delivery_revision) !== envelope.expectedDeliveryRevision ||
            Number(resolution.transport_snapshot_revision) !== envelope.transportSnapshotRevision ||
            resolution.decision !== envelope.decision || resolution.evidence_digest !== envelope.evidenceDigest ||
            resolution.provider_message_id !== envelope.providerMessageId) {
          throw new AuthenticationEmailReconciliationError("resolution_conflict");
        }
        await client.query(
          `insert into authentication_email_reconciliation_audit
             (id, delivery_id, authorization_nonce, kind, operator_subject, decision,
              evidence_digest, prior_state, reason_code, created_at)
           values ($1, $2, $3, 'idempotent_invocation', $4, $5, $6, $7, 'exact_match_repeat', $8)`,
          [randomUUID(), delivery.id, envelope.nonce, envelope.subject, envelope.decision,
            envelope.evidenceDigest, delivery.state, now],
        );
        await client.query("commit");
        return { deliveryId: delivery.id, state: delivery.state as "sent" | "failed",
          classification: envelope.decision, repeated: true };
      }

      if (delivery.state !== "manual_reconciliation" || delivery.phase !== "manual_reconciliation") {
        throw new AuthenticationEmailReconciliationError("delivery_not_reconcilable");
      }
      if (delivery.lease_owner !== null && delivery.lease_expires_at !== null && delivery.lease_expires_at > now) {
        throw new AuthenticationEmailReconciliationError("delivery_lease_active");
      }
      const safeAfter = new Date(delivery.maximum_call_deadline.getTime() + input.providerSafetyMarginSeconds * 1_000);
      if (delivery.quiescent_at === null || now < safeAfter ||
          (delivery.provider_safe_replay_until !== null && now < delivery.provider_safe_replay_until)) {
        throw new AuthenticationEmailReconciliationError("delivery_not_quiescent");
      }
      if (envelope.decision === "provider_accepted" && envelope.providerMessageId === null &&
          delivery.transport_adapter === "resend") {
        throw new AuthenticationEmailReconciliationError("provider_identifier_required");
      }
      const state = envelope.decision === "provider_accepted" ? "sent" : "failed";
      const reason = envelope.decision === "provider_accepted" ? "manual_provider_acceptance" :
        envelope.decision === "provider_rejected" ? "manual_provider_rejection" : "manual_acceptance_unresolved";
      const updated = await client.query<{ delivery_revision: string | number }>(
        `update authentication_email_delivery
            set state = $2, result_classification = $3, provider_message_id = $4,
                failure_reason_code = $5, encrypted_payload = '', sent_at = case when $2 = 'sent' then $6 else sent_at end,
                lease_owner = null, lease_expires_at = null, delivery_revision = delivery_revision + 1
          where id = $1
          returning delivery_revision`,
        [delivery.id, state, envelope.decision, envelope.providerMessageId, reason, now],
      );
      const resolvedRevision = Number(updated.rows[0]!.delivery_revision);
      await client.query(
        `insert into authentication_email_reconciliation_resolution
           (delivery_id, prior_delivery_revision, resolved_delivery_revision, transport_snapshot_revision,
            attempt_id, attempt_fence, decision, evidence_digest, operator_subject, provider_namespace,
            sender_identity, local_message_id, provider_message_id, payload_digest, provider_safe_replay_until,
            authorization_issuer, authorization_nonce, resolved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [delivery.id, envelope.expectedDeliveryRevision, resolvedRevision, envelope.transportSnapshotRevision,
          envelope.attemptId, envelope.attemptFence, envelope.decision, envelope.evidenceDigest,
          envelope.subject, envelope.providerNamespace, envelope.senderIdentity, envelope.localMessageId,
          envelope.providerMessageId, envelope.payloadDigest, envelope.providerSafeReplayUntil,
          envelope.issuer, envelope.nonce, now],
      );
      await client.query(
        `insert into authentication_email_reconciliation_audit
           (id, delivery_id, authorization_nonce, kind, operator_subject, decision,
            evidence_digest, prior_state, reason_code, created_at)
         values ($1,$2,$3,'resolution',$4,$5,$6,'manual_reconciliation',$7,$8)`,
        [randomUUID(), delivery.id, envelope.nonce, envelope.subject, envelope.decision,
          envelope.evidenceDigest, reason, now],
      );
      await client.query("commit");
      return { deliveryId: delivery.id, state, classification: envelope.decision, repeated: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
