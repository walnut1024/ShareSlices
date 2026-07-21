import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import {
  acceptAuthenticationEmailDelivery,
  createVerificationAttempt
} from "../src/db/authentication-email-repository.js";
import { dispatchOneAuthenticationEmail } from "../src/maintenance/authentication-email-node-dispatcher.js";
import {
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
    async verify() {},
    close() {},
  };
}

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
      dnsTimeoutMs: 1_000,
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });
    await pool.query(await readFile(resolve(process.cwd(), "../db/migrations/0005_email_verification_and_password_reset.sql"), "utf8"));
    await pool.query("delete from authentication_email_delivery");
    await pool.query("delete from password_reset_grant");
    await pool.query("delete from email_verification_attempt");
    await pool.query(
      "update authentication_email_circuit_breaker set state = 'closed', reason_code = null, resume_at = null where id = 'global'"
    );
  });

  afterAll(async () => {
    await pool.query("delete from authentication_email_delivery");
    await pool.query("delete from password_reset_grant");
    await pool.query("delete from email_verification_attempt");
    smtpAdapter.close();
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
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
      "select encrypted_payload from authentication_email_delivery where attempt_id = $1",
      [attempt.id]
    );
    expect(deliveries.rowCount).toBe(1);
    expect(deliveries.rows[0].encrypted_payload).not.toContain(email);
    expect(deliveries.rows[0].encrypted_payload).not.toContain("123456");
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
        if (requests.length === 1) throw new Error("response lost");
        return Response.json({ id: "resend-message-replayed" });
      },
    });

    await expect(dispatchOneAuthenticationEmail(
      "resend-replay-1",
      adapter,
      { leaseSeconds: 1, heartbeatMs: 100 },
    )).resolves.toBe(true);
    const first = await pool.query(
      `select id, state, provider_idempotency_key, provider_safe_replay_until
       from authentication_email_delivery where attempt_id = $1`,
      [attempt.id],
    );
    expect(first.rows[0].state).toBe("pending");
    await pool.query(
      "update authentication_email_delivery set available_at = now() where id = $1",
      [first.rows[0].id],
    );

    await expect(dispatchOneAuthenticationEmail(
      "resend-replay-2",
      adapter,
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
    expect(requests[1]).toEqual(requests[0]);
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
});
