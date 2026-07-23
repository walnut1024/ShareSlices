import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import {
  acceptAuthenticationEmailDelivery,
  createVerificationAttempt
} from "../src/db/authentication-email-repository.js";
import { dispatchOneAuthenticationEmail } from "../src/maintenance/authentication-email-node-dispatcher.js";
import {
  AuthenticationEmailSmtpTransportError,
  createAuthenticationEmailSmtpAdapter,
  type AuthenticationEmailSmtpAdapter
} from "../src/email/authentication-email-smtp.js";
import { createAuthenticationEmailResendAdapter } from "../src/email/authentication-email-resend.js";
import { pool } from "../src/db/client.js";

let smtpServer: SMTPServer;
let smtpAdapter: AuthenticationEmailSmtpAdapter;
let receivedMessages = 0;
const smtpIdentity = {
  adapter: "smtp" as const,
  providerNamespace: "test-smtp",
  senderIdentity: "ShareSlices <no-reply@shareslices.local>",
  endpointIdentity: "smtp://mail.test:1025",
  transportRevision: "test-smtp-v1",
  serializerRevision: "authentication-email-v1" as const,
};

function smtpAdapterWithSend(
  send: AuthenticationEmailSmtpAdapter["send"],
): AuthenticationEmailSmtpAdapter {
  return {
    identity: smtpIdentity,
    send,
    async prepare(payload, deliveryId, preSendAt) {
      const prepared = await smtpAdapter.prepare(payload, deliveryId, preSendAt);
      return {
        snapshot: prepared.snapshot,
        send: async () => ({
          classification: "provider_accepted",
          providerMessageId: await send(payload, deliveryId),
        }),
      };
    },
    async verify() {
      return {
        endpointIdentity: smtpIdentity.endpointIdentity,
        tlsPolicy: "plaintext-allowed",
        authenticationConfigured: false,
        senderSyntaxValidated: true,
        messageSent: false,
      };
    },
    close() {},
  };
}

const sharedTransportFixtures = [
  {
    name: "enterprise SMTP",
    create: () => smtpAdapter,
  },
  {
    name: "Resend",
    create: () => createAuthenticationEmailResendAdapter({
      apiKey: "shared-contract-secret",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "shared-contract-team",
      transportRevision: "shared-contract-v1",
      safetyMarginMs: 300_000,
      fetch: async () => Response.json({ id: "shared-contract-message" }),
    }),
  },
] as const;

describe("authentication email repository", () => {
  beforeAll(async () => {
    smtpServer = new SMTPServer({
      authOptional: true,
      disableReverseLookup: true,
      disabledCommands: ["STARTTLS"],
      closeTimeout: 100,
      onData(stream, _session, callback) {
        stream.on("data", () => undefined);
        stream.on("end", () => {
          receivedMessages += 1;
          callback();
        });
        stream.resume();
      }
    });
    await new Promise<void>((resolve) => smtpServer.listen(0, "127.0.0.1", resolve));
    const address = smtpServer.server.address();
    if (!address || typeof address === "string") throw new Error("SMTP test server did not bind a TCP port.");
    smtpAdapter = createAuthenticationEmailSmtpAdapter({
      url: `smtp://127.0.0.1:${address.port}`,
      from: "ShareSlices <no-reply@shareslices.local>",
      providerNamespace: "test-smtp",
      transportRevision: "test-smtp-v1",
      endpointIdentity: `127.0.0.1:${address.port}`,
      tlsPolicy: "plaintext-allowed",
      dnsTimeoutMs: 1_000,
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });
    await pool.query(await readFile(resolve(process.cwd(), "../db/migrations/0005_email_verification_and_password_reset.sql"), "utf8"));
  });

  beforeEach(async () => {
    await pool.query("delete from cloudflare_job_dispatch_outbox where lane = 'authentication-email'");
    await pool.query("delete from authentication_email_delivery");
    await pool.query("delete from password_reset_grant");
    await pool.query("delete from email_verification_attempt");
    await pool.query(
      "update authentication_email_circuit_breaker set state = 'closed', reason_code = null, resume_at = null where id = 'global'"
    );
  });

  afterAll(async () => {
    await pool.query("delete from cloudflare_job_dispatch_outbox where lane = 'authentication-email'");
    await pool.query("delete from authentication_email_delivery");
    await pool.query("delete from password_reset_grant");
    await pool.query("delete from email_verification_attempt");
    await pool.query(
      "update authentication_email_circuit_breaker set state = 'closed', reason_code = null, resume_at = null where id = 'global'"
    );
    smtpAdapter.close();
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
  });

  describe.each(sharedTransportFixtures)("shared dispatcher contract: $name", ({ create }) => {
    it("freezes the first-claim configuration and records provider acceptance separately", async () => {
      const email = `shared-accepted-${crypto.randomUUID()}@example.com`;
      const attempt = await createVerificationAttempt({ email, purpose: "registration" });
      await acceptAuthenticationEmailDelivery({
        attemptId: attempt.id,
        email,
        purpose: "registration",
        sourceIp: "203.0.113.88",
        payload: { email, otp: "123456", type: "email-verification" },
      });

      await expect(dispatchOneAuthenticationEmail(`shared-accepted-${crypto.randomUUID()}`, create()))
        .resolves.toBe(true);

      const delivery = await pool.query(
        `select state, result_classification, transport_adapter, provider_namespace,
                sender_identity, endpoint_identity, transport_configuration_revision,
                payload_digest, local_message_id, encrypted_payload
         from authentication_email_delivery where attempt_id = $1`,
        [attempt.id],
      );
      expect(delivery.rows[0]).toMatchObject({
        state: "sent",
        result_classification: "provider_accepted",
        encrypted_payload: "",
      });
      expect(delivery.rows[0].transport_adapter).toMatch(/^(smtp|resend)$/);
      expect(delivery.rows[0].provider_namespace).toBeTruthy();
      expect(delivery.rows[0].sender_identity).toBeTruthy();
      expect(delivery.rows[0].endpoint_identity).toBeTruthy();
      expect(delivery.rows[0].transport_configuration_revision).toBeTruthy();
      expect(delivery.rows[0].payload_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(delivery.rows[0].local_message_id).toBeTruthy();
    });

    it("does not freeze transport identity when preparation crashes before submission", async () => {
      const email = `shared-prepare-${crypto.randomUUID()}@example.com`;
      const attempt = await createVerificationAttempt({ email, purpose: "registration" });
      await acceptAuthenticationEmailDelivery({
        attemptId: attempt.id,
        email,
        purpose: "registration",
        sourceIp: "203.0.113.89",
        payload: { email, otp: "123456", type: "email-verification" },
      });
      const base = create();
      const crashingAdapter = {
        async prepare(...args: Parameters<typeof base.prepare>) {
          await base.prepare(...args);
          throw new Error("crash_before_provider_boundary");
        },
      };

      await expect(dispatchOneAuthenticationEmail("shared-prepare-crash", crashingAdapter))
        .rejects.toThrow("crash_before_provider_boundary");
      const delivery = await pool.query(
        `select state, attempt_count, transport_adapter, provider_namespace, local_message_id
         from authentication_email_delivery where attempt_id = $1`,
        [attempt.id],
      );
      expect(delivery.rows[0]).toEqual({
        state: "pending",
        attempt_count: 0,
        transport_adapter: null,
        provider_namespace: null,
        local_message_id: null,
      });
    });

    it("rejects a late accepted outcome after lease ownership changes", async () => {
      const email = `shared-late-${crypto.randomUUID()}@example.com`;
      const attempt = await createVerificationAttempt({ email, purpose: "registration" });
      await acceptAuthenticationEmailDelivery({
        attemptId: attempt.id,
        email,
        purpose: "registration",
        sourceIp: "203.0.113.90",
        payload: { email, otp: "123456", type: "email-verification" },
      });
      const base = create();
      const lateAdapter = {
        async prepare(...args: Parameters<typeof base.prepare>) {
          const prepared = await base.prepare(...args);
          return {
            snapshot: prepared.snapshot,
            async send() {
              await pool.query(
                `update authentication_email_delivery
                 set lease_owner = 'replacement-worker', lease_expires_at = now() + interval '1 minute'
                 where id = $1`,
                [args[1]],
              );
              return prepared.send();
            },
          };
        },
      };

      await expect(dispatchOneAuthenticationEmail("shared-late-worker", lateAdapter, {
        leaseSeconds: 1,
        heartbeatMs: 500,
      })).resolves.toBe(true);
      const delivery = await pool.query(
        `select state, lease_owner, provider_message_id, result_classification
         from authentication_email_delivery where attempt_id = $1`,
        [attempt.id],
      );
      expect(delivery.rows[0]).toEqual({
        state: "sending",
        lease_owner: "replacement-worker",
        provider_message_id: null,
        result_classification: null,
      });
    });
  });

  it("deduplicates repeated delivery during the server waiting period", async () => {
    const email = `delivery-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    const input = {
      attemptId: attempt.id,
      email,
      purpose: "registration" as const,
      sourceIp: "203.0.113.10",
      payload: { email, otp: "123456", type: "email-verification" as const }
    };

    await expect(acceptAuthenticationEmailDelivery(input)).resolves.toEqual({
      status: "accepted",
      resendAvailableIn: 60
    });
    await expect(acceptAuthenticationEmailDelivery(input)).resolves.toMatchObject({ status: "waiting" });

    const deliveries = await pool.query(
      "select id, encrypted_payload from authentication_email_delivery where attempt_id = $1",
      [attempt.id]
    );
    expect(deliveries.rowCount).toBe(1);
    expect(deliveries.rows[0].encrypted_payload).not.toContain(email);
    expect(deliveries.rows[0].encrypted_payload).not.toContain("123456");
    const dispatch = await pool.query(
      `select state from cloudflare_job_dispatch_outbox
       where lane = 'authentication-email' and durable_job_id = $1`,
      [deliveries.rows[0].id],
    );
    expect(dispatch.rows).toEqual([{ state: "pending" }]);
  });

  it("reuses one pending verification for the same email and purpose", async () => {
    const email = `pending-${crypto.randomUUID()}@example.com`;
    const first = await createVerificationAttempt({ email, purpose: "registration" });
    const second = await createVerificationAttempt({ email, purpose: "registration" });

    expect(second.id).toBe(first.id);
    const attempts = await pool.query(
      "select count(*)::int as count from email_verification_attempt where email = $1 and purpose = 'registration' and consumed_at is null",
      [email]
    );
    expect(attempts.rows[0].count).toBe(1);
  });

  it("suppresses new delivery while the deployment circuit breaker is open", async () => {
    await pool.query(
      "update authentication_email_circuit_breaker set state = 'open', reason_code = 'test', resume_at = now() + interval '5 minutes' where id = 'global'"
    );
    const email = `breaker-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "password_reset" });

    await expect(acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "password_reset",
      sourceIp: "203.0.113.11",
      payload: { email, otp: "654321", type: "forget-password" }
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("limits one email independently of source address", async () => {
    await pool.query(
      "update authentication_email_circuit_breaker set state = 'closed', reason_code = null, resume_at = null where id = 'global'"
    );
    const email = `email-limit-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    for (let index = 0; index < 5; index += 1) {
      await expect(acceptAuthenticationEmailDelivery({
        attemptId: attempt.id,
        email,
        purpose: "registration",
        sourceIp: `203.0.113.${20 + index}`,
        payload: { email, otp: "123456", type: "email-verification" }
      })).resolves.toMatchObject({ status: "accepted" });
      await pool.query(
        "update authentication_email_delivery set created_at = created_at - interval '2 minutes' where attempt_id = $1",
        [attempt.id]
      );
    }

    await expect(acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.99",
      payload: { email, otp: "123456", type: "email-verification" }
    })).resolves.toEqual({ status: "limited" });
  });

  it("renews the delivery lease while the SMTP adapter remains active", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `lease-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.77",
      payload: { email, otp: "123456", type: "email-verification" }
    });

    const adapter = smtpAdapterWithSend(async (_payload, deliveryId) => {
        const initial = await pool.query<{ lease_expires_at: Date }>(
          "select lease_expires_at from authentication_email_delivery where id = $1",
          [deliveryId]
        );
        await new Promise((resolve) => setTimeout(resolve, 180));
        const renewed = await pool.query<{ lease_expires_at: Date }>(
          "select lease_expires_at from authentication_email_delivery where id = $1",
          [deliveryId]
        );
        expect(renewed.rows[0]!.lease_expires_at.getTime())
          .toBeGreaterThan(initial.rows[0]!.lease_expires_at.getTime());
        return `<${deliveryId}@shareslices.local>`;
    });

    await expect(dispatchOneAuthenticationEmail("lease-test", adapter, {
      leaseSeconds: 0.3,
      heartbeatMs: 50
    })).resolves.toBe(true);
  });

  it("does not overwrite a delivery claimed by a new lease owner", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `fence-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.79",
      payload: { email, otp: "123456", type: "email-verification" }
    });

    const adapter = smtpAdapterWithSend(async (_payload, deliveryId) => {
        await pool.query(
          `update authentication_email_delivery
           set lease_owner = 'replacement-worker', lease_expires_at = now() + interval '1 minute'
           where id = $1`,
          [deliveryId]
        );
        return `<${deliveryId}@shareslices.local>`;
    });

    await expect(dispatchOneAuthenticationEmail("original-worker", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 500
    })).resolves.toBe(true);
    const delivery = await pool.query(
      "select state, lease_owner, provider_message_id from authentication_email_delivery where attempt_id = $1",
      [attempt.id]
    );
    expect(delivery.rows[0]).toMatchObject({
      state: "sending",
      lease_owner: "replacement-worker",
      provider_message_id: null
    });
  });

  it("marks a delivery sent only after SMTP accepts it and removes its encrypted payload", async () => {
    const email = `smtp-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.78",
      payload: { email, otp: "123456", type: "email-verification" }
    });
    const before = receivedMessages;
    await expect(dispatchOneAuthenticationEmail("test-dispatcher", smtpAdapter)).resolves.toBe(true);
    const sent = await pool.query(
      `select id, state, encrypted_payload, provider_message_id, result_classification,
              transport_adapter, provider_namespace, sender_identity, endpoint_identity,
              transport_configuration_revision, serializer_revision, payload_digest, local_message_id
       from authentication_email_delivery where state = 'sent' order by sent_at desc limit 1`
    );
    expect(sent.rows[0]).toMatchObject({
      state: "sent",
      encrypted_payload: "",
      result_classification: "provider_accepted",
      transport_adapter: "smtp",
      provider_namespace: "test-smtp",
      sender_identity: "ShareSlices <no-reply@shareslices.local>",
      transport_configuration_revision: "test-smtp-v1",
      serializer_revision: "authentication-email-v1",
    });
    expect(sent.rows[0].payload_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sent.rows[0].local_message_id).toBe(`<${sent.rows[0].id}@shareslices.local>`);
    expect(sent.rows[0].provider_message_id).toMatch(/^<.+@shareslices\.local>$/);
    const providerAttempt = await pool.query(
      "select fence, phase, complete_submission_at from authentication_email_provider_attempt where delivery_id = $1",
      [sent.rows[0].id]
    );
    expect(providerAttempt.rows).toEqual([
      expect.objectContaining({ fence: "1", phase: "accepted", complete_submission_at: expect.any(Date) })
    ]);
    expect(receivedMessages).toBe(before + 1);
  });

  it("leaves a delivery unbound when preparation fails before the side-effect boundary", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `prepare-failed-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.86",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = {
      async prepare() {
        throw new Error("crash_before_provider_boundary");
      },
    };

    await expect(dispatchOneAuthenticationEmail("prepare-failed", adapter)).rejects.toThrow(
      "crash_before_provider_boundary",
    );
    const delivery = await pool.query(
      `select state, attempt_count, delivery_revision, transport_adapter, provider_namespace,
              provider_idempotency_key, local_message_id
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "pending",
      attempt_count: 0,
      delivery_revision: "0",
      transport_adapter: null,
      provider_namespace: null,
      provider_idempotency_key: null,
      local_message_id: null,
    });
  });

  it("routes an unknown provider outcome to manual reconciliation without automatic resend", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `indeterminate-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.80",
      payload: { email, otp: "123456", type: "email-verification" }
    });
    let sends = 0;
    const adapter = smtpAdapterWithSend(async () => {
        sends += 1;
        throw new Error("response_lost_after_submission");
    });

    await expect(dispatchOneAuthenticationEmail("indeterminate-worker", adapter)).resolves.toBe(true);
    await expect(dispatchOneAuthenticationEmail("next-worker", adapter)).resolves.toBe(false);

    const delivery = await pool.query(
      `select state, failure_reason_code, lease_owner from authentication_email_delivery where attempt_id = $1`,
      [attempt.id]
    );
    expect(delivery.rows[0]).toMatchObject({
      state: "manual_reconciliation",
      failure_reason_code: "acceptance_indeterminate",
      lease_owner: null
    });
    const providerAttempt = await pool.query(
      `select phase, failure_reason_code from authentication_email_provider_attempt
       where delivery_id = (select id from authentication_email_delivery where attempt_id = $1)`,
      [attempt.id]
    );
    expect(providerAttempt.rows).toEqual([{
      phase: "acceptance_indeterminate",
      failure_reason_code: "provider_outcome_unknown"
    }]);
    expect(sends).toBe(1);
  });

  it("retries only an SMTP failure proven to occur before submission", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `smtp-pre-submit-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.82",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = smtpAdapterWithSend(async () => {
      throw new AuthenticationEmailSmtpTransportError("known_not_submitted_retryable");
    });

    await expect(dispatchOneAuthenticationEmail("smtp-pre-submit-worker", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 500,
    })).resolves.toBe(true);
    const delivery = await pool.query(
      "select state, result_classification, failure_reason_code, encrypted_payload from authentication_email_delivery where attempt_id = $1",
      [attempt.id],
    );
    expect(delivery.rows[0]).toMatchObject({
      state: "pending",
      result_classification: null,
      failure_reason_code: "known_not_submitted_retryable",
    });
    expect(delivery.rows[0].encrypted_payload).not.toBe("");
    const providerAttempt = await pool.query(
      "select phase, failure_reason_code, quiescent_at from authentication_email_provider_attempt where delivery_id = (select id from authentication_email_delivery where attempt_id = $1)",
      [attempt.id],
    );
    expect(providerAttempt.rows).toEqual([expect.objectContaining({
      phase: "known_not_submitted",
      failure_reason_code: "known_not_submitted_retryable",
      quiescent_at: expect.any(Date),
    })]);
  });

  it("fails an SMTP delivery rejected before DATA without retry or provider acceptance", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `smtp-rejected-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.83",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = smtpAdapterWithSend(async () => {
      throw new AuthenticationEmailSmtpTransportError("provider_rejected");
    });

    await expect(dispatchOneAuthenticationEmail("smtp-rejected-worker", adapter)).resolves.toBe(true);
    await expect(dispatchOneAuthenticationEmail("smtp-rejected-worker-2", adapter)).resolves.toBe(false);
    const delivery = await pool.query(
      "select state, result_classification, failure_reason_code, encrypted_payload from authentication_email_delivery where attempt_id = $1",
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "failed",
      result_classification: "provider_rejected",
      failure_reason_code: "provider_rejected",
      encrypted_payload: "",
    });
  });

  it("bounds SMTP retries that are proven not to have submitted", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = `smtp-exhausted-${crypto.randomUUID()}@example.com`;
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.84",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    let sends = 0;
    const adapter = smtpAdapterWithSend(async () => {
      sends += 1;
      throw new AuthenticationEmailSmtpTransportError("known_not_submitted_retryable");
    });
    const timing = { leaseSeconds: 1, heartbeatMs: 500, maxAttempts: 2 };

    await expect(dispatchOneAuthenticationEmail("smtp-exhausted-1", adapter, timing)).resolves.toBe(true);
    await pool.query(
      "update authentication_email_delivery set available_at = now() where attempt_id = $1",
      [attempt.id],
    );
    await expect(dispatchOneAuthenticationEmail("smtp-exhausted-2", adapter, timing)).resolves.toBe(true);

    const delivery = await pool.query(
      `select state, attempt_count, result_classification, failure_reason_code, encrypted_payload
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "failed",
      attempt_count: 2,
      result_classification: null,
      failure_reason_code: "attempts_exhausted",
      encrypted_payload: "",
    });
    expect(sends).toBe(2);
  });

  it("freezes Resend idempotency evidence before the bounded provider call", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.81",
      payload: { email, otp: "123456", type: "email-verification" }
    });
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => Response.json({ id: "resend-message-1" })
    });

    await expect(dispatchOneAuthenticationEmail("resend-worker", adapter)).resolves.toBe(true);

    const delivery = await pool.query(
      `select state, transport_adapter, provider_namespace, provider_idempotency_key,
              provider_safe_replay_until, provider_message_id, result_classification
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id]
    );
    expect(delivery.rows[0]).toMatchObject({
      state: "sent",
      transport_adapter: "resend",
      provider_namespace: "test-team",
      provider_message_id: "resend-message-1",
      result_classification: "provider_accepted"
    });
    expect(delivery.rows[0].provider_idempotency_key).toMatch(/^shareslices-email-v1\//);
    expect(delivery.rows[0].provider_safe_replay_until).toBeInstanceOf(Date);
  });

  it("replays an indeterminate Resend call with the original key, payload, and cutoff", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.82",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const requests: Array<{ authorization: string | null; key: string | null; body: string }> = [];
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: String(init?.body),
      });
      if (requests.length === 1) throw new Error("response lost");
      return Response.json({ id: "resend-message-replayed" });
    };
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key-first",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch,
    });
    const rotatedCredentialAdapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key-rotated",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch,
    });

    await expect(dispatchOneAuthenticationEmail(
      "resend-replay-1",
      adapter,
      { leaseSeconds: 1, heartbeatMs: 100 },
    )).resolves.toBe(true);
    const first = await pool.query(
      `select delivery.id, delivery.state, delivery.available_at,
              delivery.provider_idempotency_key, delivery.provider_safe_replay_until,
              attempt.maximum_call_deadline, attempt.quiescent_at
       from authentication_email_delivery delivery
       join authentication_email_provider_attempt attempt on attempt.delivery_id = delivery.id
       where delivery.attempt_id = $1`,
      [attempt.id],
    );
    expect(first.rows[0].state).toBe("pending");
    expect(first.rows[0].quiescent_at).toBeInstanceOf(Date);
    expect(first.rows[0].available_at.getTime())
      .toBeGreaterThanOrEqual(first.rows[0].maximum_call_deadline.getTime());
    await pool.query(
      "update authentication_email_delivery set available_at = now() where id = $1",
      [first.rows[0].id],
    );

    await expect(dispatchOneAuthenticationEmail(
      "resend-replay-2",
      rotatedCredentialAdapter,
      { leaseSeconds: 1, heartbeatMs: 100 },
    )).resolves.toBe(true);

    const completed = await pool.query(
      `select state, provider_idempotency_key, provider_safe_replay_until,
              provider_message_id, result_classification
       from authentication_email_delivery where id = $1`,
      [first.rows[0].id],
    );
    expect(completed.rows[0]).toMatchObject({
      state: "sent",
      provider_idempotency_key: first.rows[0].provider_idempotency_key,
      provider_safe_replay_until: first.rows[0].provider_safe_replay_until,
      provider_message_id: "resend-message-replayed",
      result_classification: "provider_accepted",
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.key).toBe(requests[0]!.key);
    expect(requests[1]!.body).toBe(requests[0]!.body);
    expect(requests.map(({ authorization }) => authorization)).toEqual([
      "Bearer test-secret-key-first",
      "Bearer test-secret-key-rotated",
    ]);
  });

  it("replays a quiescent Resend 5xx with the same frozen request", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.93",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const requests: Array<{ key: string | null; body: string }> = [];
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async (_url, init) => {
        requests.push({
          key: new Headers(init?.headers).get("Idempotency-Key"),
          body: String(init?.body),
        });
        return requests.length === 1
          ? Response.json({ name: "internal_server_error" }, { status: 503 })
          : Response.json({ id: "resend-5xx-replayed" });
      },
    });

    await dispatchOneAuthenticationEmail("resend-5xx-1", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
    });
    await pool.query(
      "update authentication_email_delivery set available_at = now() where attempt_id = $1",
      [attempt.id],
    );
    await dispatchOneAuthenticationEmail("resend-5xx-2", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
    });

    const delivery = await pool.query(
      "select state, provider_message_id, result_classification from authentication_email_delivery where attempt_id = $1",
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "sent",
      provider_message_id: "resend-5xx-replayed",
      result_classification: "provider_accepted",
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("refuses to replay an attempted delivery through another provider namespace", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.87",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    let providerCalls = 0;
    const firstAdapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-a",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => {
        providerCalls += 1;
        throw new Error("response lost");
      },
    });
    const otherNamespaceAdapter = createAuthenticationEmailResendAdapter({
      apiKey: "other-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "team-b",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => {
        providerCalls += 1;
        return Response.json({ id: "must-not-send" });
      },
    });

    await dispatchOneAuthenticationEmail("namespace-first", firstAdapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
    });
    await pool.query(
      "update authentication_email_delivery set available_at = now() where attempt_id = $1",
      [attempt.id],
    );
    await expect(dispatchOneAuthenticationEmail("namespace-other", otherNamespaceAdapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
    })).rejects.toThrow("authentication_email_transport_snapshot_conflict");

    const delivery = await pool.query(
      `select state, attempt_count, provider_namespace, transport_configuration_revision
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "pending",
      attempt_count: 1,
      provider_namespace: "team-a",
      transport_configuration_revision: "resend-test-v1",
    });
    expect(providerCalls).toBe(1);
  });

  it("moves an expired Resend replay to reconciliation without another provider call", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.83",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    let sends = 0;
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => {
        sends += 1;
        throw new Error("response lost");
      },
    });

    await dispatchOneAuthenticationEmail("resend-cutoff-1", adapter, { leaseSeconds: 1, heartbeatMs: 100 });
    await pool.query(
      `update authentication_email_delivery
       set available_at = now(), provider_safe_replay_until = now() - interval '1 second'
       where attempt_id = $1`,
      [attempt.id],
    );
    await dispatchOneAuthenticationEmail("resend-cutoff-2", adapter, { leaseSeconds: 1, heartbeatMs: 100 });

    const delivery = await pool.query(
      "select state, failure_reason_code from authentication_email_delivery where attempt_id = $1",
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "manual_reconciliation",
      failure_reason_code: "resend_safe_replay_cutoff_elapsed",
    });
    expect(sends).toBe(1);
  });

  it("routes an exhausted indeterminate Resend attempt to reconciliation", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.85",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => { throw new Error("response lost"); },
    });

    await expect(dispatchOneAuthenticationEmail("resend-exhausted", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
      maxAttempts: 1,
    })).resolves.toBe(true);

    const delivery = await pool.query(
      `select state, attempt_count, result_classification, failure_reason_code
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "manual_reconciliation",
      attempt_count: 1,
      result_classification: null,
      failure_reason_code: "acceptance_indeterminate",
    });
  });

  it("persists concurrent Resend replay as indeterminate before a bounded retry", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.91",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => Response.json(
        { name: "concurrent_idempotent_requests" },
        { status: 409, headers: { "Retry-After": "17" } },
      ),
    });

    await expect(dispatchOneAuthenticationEmail("resend-concurrent", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
      maxAttempts: 3,
    })).resolves.toBe(true);

    const delivery = await pool.query(
      `select state, attempt_count, failure_reason_code, provider_idempotency_key,
              provider_safe_replay_until
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toMatchObject({
      state: "pending",
      attempt_count: 1,
      failure_reason_code: "concurrent_idempotent_requests",
      provider_idempotency_key: expect.stringMatching(/^shareslices-email-v1\//),
      provider_safe_replay_until: expect.any(Date),
    });
    const providerAttempt = await pool.query(
      `select phase, failure_reason_code, quiescent_at
       from authentication_email_provider_attempt
       where delivery_id = (select id from authentication_email_delivery where attempt_id = $1)`,
      [attempt.id],
    );
    expect(providerAttempt.rows).toEqual([expect.objectContaining({
      phase: "acceptance_indeterminate",
      failure_reason_code: "concurrent_idempotent_requests",
      quiescent_at: expect.any(Date),
    })]);
  });

  it("bounds a Resend quota refusal that is proven not to have submitted", async () => {
    await pool.query("delete from authentication_email_delivery");
    const email = "delivered+shareslices@resend.dev";
    const attempt = await createVerificationAttempt({ email, purpose: "registration" });
    await acceptAuthenticationEmailDelivery({
      attemptId: attempt.id,
      email,
      purpose: "registration",
      sourceIp: "203.0.113.92",
      payload: { email, otp: "123456", type: "email-verification" },
    });
    const adapter = createAuthenticationEmailResendAdapter({
      apiKey: "test-secret-key",
      from: "ShareSlices <onboarding@resend.dev>",
      providerNamespace: "test-team",
      transportRevision: "resend-test-v1",
      safetyMarginMs: 300_000,
      fetch: async () => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }),
    });

    await expect(dispatchOneAuthenticationEmail("resend-quota", adapter, {
      leaseSeconds: 1,
      heartbeatMs: 100,
      maxAttempts: 1,
    })).resolves.toBe(true);

    const delivery = await pool.query(
      `select state, attempt_count, result_classification, failure_reason_code, encrypted_payload
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(delivery.rows[0]).toEqual({
      state: "failed",
      attempt_count: 1,
      result_classification: null,
      failure_reason_code: "attempts_exhausted",
      encrypted_payload: "",
    });
  });
});
