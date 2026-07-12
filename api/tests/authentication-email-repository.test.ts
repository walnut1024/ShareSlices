import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import {
  acceptAuthenticationEmailDelivery,
  createVerificationAttempt
} from "../src/db/authentication-email-repository.js";
import { dispatchOneAuthenticationEmail } from "../src/application/accounts/authentication-email-dispatcher.js";
import {
  createAuthenticationEmailSmtpAdapter,
  type AuthenticationEmailSmtpAdapter
} from "../src/email/authentication-email-smtp.js";
import { pool } from "../src/db/client.js";

let smtpServer: SMTPServer;
let smtpAdapter: AuthenticationEmailSmtpAdapter;
let receivedMessages = 0;

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

  it("marks a delivery sent only after SMTP accepts it and removes its encrypted payload", async () => {
    const before = receivedMessages;
    await expect(dispatchOneAuthenticationEmail("test-dispatcher", smtpAdapter)).resolves.toBe(true);
    const sent = await pool.query(
      "select state, encrypted_payload, provider_message_id from authentication_email_delivery where state = 'sent' order by sent_at desc limit 1"
    );
    expect(sent.rows[0]).toMatchObject({ state: "sent", encrypted_payload: "" });
    expect(sent.rows[0].provider_message_id).toMatch(/^<.+@shareslices\.local>$/);
    expect(receivedMessages).toBe(before + 1);
  });
});
