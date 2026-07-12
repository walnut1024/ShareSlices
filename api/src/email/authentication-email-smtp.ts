import nodemailer, { type Transporter } from "nodemailer";
import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";

export type AuthenticationEmailSmtpOptions = {
  url: string;
  from: string;
  dnsTimeoutMs: number;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
};

export type AuthenticationEmailSmtpAdapter = {
  send(payload: AuthenticationEmailPayload, deliveryId: string): Promise<string>;
  verify(checkTo?: string): Promise<void>;
  close(): void;
};

type AuthenticationEmailMessage = { subject: string; text: string; html: string };

function messageFor(payload: AuthenticationEmailPayload): AuthenticationEmailMessage {
  if (payload.type === "password-changed") {
    return {
      subject: "Your ShareSlices password was changed",
      text: "Your ShareSlices password was changed. If you did not make this change, contact your administrator.",
      html: "<p>Your ShareSlices password was changed.</p><p>If you did not make this change, contact your administrator.</p>"
    };
  }

  if (payload.type !== "email-verification" && payload.type !== "forget-password") {
    throw new Error(`Unsupported authentication email type: ${payload.type}`);
  }
  const registration = payload.type === "email-verification";
  const subject = registration ? "Verify your ShareSlices email" : "Reset your ShareSlices password";
  const action = registration ? "verify your email" : "reset your password";
  const code = payload.otp ?? "";
  return {
    subject,
    text: `Use this code to ${action}: ${code}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `<p>Use this code to ${action}:</p><p><strong>${code}</strong></p><p>This code expires in 10 minutes.</p><p>If you did not request this, ignore this email.</p>`
  };
}

export function createAuthenticationEmailSmtpAdapter(
  options: AuthenticationEmailSmtpOptions
): AuthenticationEmailSmtpAdapter {
  const transporter: Transporter = nodemailer.createTransport({
    url: options.url,
    dnsTimeout: options.dnsTimeoutMs,
    connectionTimeout: options.connectionTimeoutMs,
    greetingTimeout: options.greetingTimeoutMs,
    socketTimeout: options.socketTimeoutMs,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true
  });

  return {
    async send(payload, deliveryId) {
      const message = messageFor(payload);
      const messageId = `<${deliveryId}@shareslices.local>`;
      const result = await transporter.sendMail({
        from: options.from,
        to: payload.email,
        messageId,
        ...message
      });
      return result.messageId;
    },
    async verify(checkTo) {
      await transporter.verify();
      if (checkTo) {
        await transporter.sendMail({
          from: options.from,
          to: checkTo,
          messageId: `<smtp-check-${crypto.randomUUID()}@shareslices.local>`,
          subject: "ShareSlices SMTP check",
          text: "ShareSlices successfully delivered this SMTP check message.",
          html: "<p>ShareSlices successfully delivered this SMTP check message.</p>"
        });
      }
    },
    close() {
      transporter.close();
    }
  };
}
