import nodemailer, { type Transporter } from "nodemailer";
import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";
import { renderAuthenticationEmailMessage } from "./authentication-email-message.js";

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
      const message = renderAuthenticationEmailMessage(payload);
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
