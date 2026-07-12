import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticationEmailSmtpAdapter } from "../src/email/authentication-email-smtp.js";

type ReceivedAuthenticationEmail = { raw: string; envelopeFrom: string; envelopeTo: string[] };

const servers: SMTPServer[] = [];

async function within<T>(label: string, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 1_000))
  ]);
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

async function smtpFixture(options: { rejectRecipient?: boolean } = {}): Promise<{
  url: string;
  received: Promise<ReceivedAuthenticationEmail>;
}> {
  let resolveMessage!: (message: ReceivedAuthenticationEmail) => void;
  const received = new Promise<ReceivedAuthenticationEmail>((resolve) => { resolveMessage = resolve; });
  const server = new SMTPServer({
    authOptional: true,
    disableReverseLookup: true,
    disabledCommands: ["STARTTLS"],
    closeTimeout: 100,
    onAuth(_auth, _session, callback) {
      callback(null, { user: "test" });
    },
    onRcptTo(address, _session, callback) {
      if (options.rejectRecipient) {
        callback(Object.assign(new Error(`Mailbox unavailable for ${address.address}`), { responseCode: 550 }));
        return;
      }
      callback();
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        resolveMessage({
          raw: Buffer.concat(chunks).toString("utf8"),
          envelopeFrom: _session.envelope.mailFrom && _session.envelope.mailFrom.address || "",
          envelopeTo: _session.envelope.rcptTo.map((recipient) => recipient.address)
        });
        callback();
      });
      stream.resume();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("SMTP fixture did not bind a TCP port.");
  return { url: `smtp://127.0.0.1:${address.port}`, received };
}

describe("authentication email SMTP transport", () => {
  it("sends a registration code with stable identity through SMTP", async () => {
    const fixture = await within("fixture startup", smtpFixture());
    const transport = createAuthenticationEmailSmtpAdapter({
      url: fixture.url,
      from: "ShareSlices <no-reply@shareslices.local>",
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });

    const messageId = await within("SMTP send", transport.send(
      { email: "ada@example.com", otp: "123456", type: "email-verification" },
      "019f5a36-66df-7000-8000-000000000001"
    ));
    const message = await within("message receipt", fixture.received);

    expect(messageId).toBe("<019f5a36-66df-7000-8000-000000000001@shareslices.local>");
    expect(message.raw).toContain("From: ShareSlices <no-reply@shareslices.local>");
    expect(message.raw).toContain("To: ada@example.com");
    expect(message).toMatchObject({
      envelopeFrom: "no-reply@shareslices.local",
      envelopeTo: ["ada@example.com"]
    });
    expect(message.raw).toContain("Subject: Verify your ShareSlices email");
    expect(message.raw).toContain("123456");
    expect(message.raw).toContain("10 minutes");
    expect(message.raw).not.toContain("http://");
    expect(message.raw).not.toContain("https://");

    transport.close();
  });

  it("renders a password-reset message without links or a code in its subject", async () => {
    const fixture = await within("fixture startup", smtpFixture());
    const transport = createAuthenticationEmailSmtpAdapter({
      url: fixture.url,
      from: "ShareSlices <no-reply@shareslices.local>",
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });

    await within("SMTP send", transport.send(
      { email: "ada@example.com", otp: "654321", type: "forget-password" },
      "019f5a36-66df-7000-8000-000000000002"
    ));
    const reset = await within("message receipt", fixture.received);
    expect(reset.raw).toContain("Subject: Reset your ShareSlices password");
    expect(reset.raw).toContain("654321");
    expect(reset.raw).not.toContain("Subject: 654321");

    transport.close();
  });

  it("sends a password-changed notification without a verification code", async () => {
    const fixture = await within("fixture startup", smtpFixture());
    const transport = createAuthenticationEmailSmtpAdapter({
      url: fixture.url,
      from: "ShareSlices <no-reply@shareslices.local>",
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });

    await within("SMTP send", transport.send(
      { email: "ada@example.com", type: "password-changed" },
      "019f5a36-66df-7000-8000-000000000003"
    ));
    const notification = await within("message receipt", fixture.received);
    expect(notification.raw).toContain("Subject: Your ShareSlices password was changed");
    expect(notification.raw).toContain("contact your administrator");
    expect(notification.raw).not.toMatch(/\b\d{6}\b/);
    expect(notification.raw).not.toContain("http://");
    expect(notification.raw).not.toContain("https://");

    transport.close();
  });

  it("reports an SMTP recipient rejection without retrying inside Nodemailer", async () => {
    const fixture = await within("fixture startup", smtpFixture({ rejectRecipient: true }));
    const transport = createAuthenticationEmailSmtpAdapter({
      url: fixture.url,
      from: "ShareSlices <no-reply@shareslices.local>",
      connectionTimeoutMs: 1_000,
      greetingTimeoutMs: 1_000,
      socketTimeoutMs: 2_000
    });

    await expect(transport.send(
      { email: "rejected@example.com", otp: "123456", type: "email-verification" },
      "019f5a36-66df-7000-8000-000000000004"
    )).rejects.toMatchObject({ responseCode: 550 });

    transport.close();
  });
});
