import nodemailer, { type Transporter } from "nodemailer";
import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";
import { renderAuthenticationEmailMessage } from "./authentication-email-message.js";
import {
  authenticationEmailProviderPayload,
  canonicalJson,
  sha256Hex,
  type AuthenticationEmailTransportAdapter,
} from "./authentication-email-transport.js";

export type AuthenticationEmailSmtpOptions = {
  url: string;
  from: string;
  providerNamespace: string;
  transportRevision: string;
  dnsTimeoutMs: number;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
};

export type AuthenticationEmailSmtpAdapter = AuthenticationEmailTransportAdapter & {
  identity: Readonly<{
    adapter: "smtp";
    providerNamespace: string;
    senderIdentity: string;
    endpointIdentity: string;
    transportRevision: string;
    serializerRevision: "authentication-email-v1";
  }>;
  send(payload: AuthenticationEmailPayload, deliveryId: string): Promise<string>;
  verify(checkTo?: string): Promise<void>;
  close(): void;
};

export function createAuthenticationEmailSmtpAdapter(
  options: AuthenticationEmailSmtpOptions
): AuthenticationEmailSmtpAdapter {
  const endpoint = new URL(options.url);
  endpoint.username = "";
  endpoint.password = "";
  endpoint.search = "";
  endpoint.hash = "";
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
    identity: {
      adapter: "smtp",
      providerNamespace: options.providerNamespace,
      senderIdentity: options.from,
      endpointIdentity: endpoint.toString(),
      transportRevision: options.transportRevision,
      serializerRevision: "authentication-email-v1",
    },
    async prepare(payload, deliveryId) {
      const providerPayload = authenticationEmailProviderPayload(options.from, payload);
      return {
        snapshot: {
          adapter: "smtp",
          providerNamespace: options.providerNamespace,
          senderIdentity: options.from,
          endpointIdentity: endpoint.toString(),
          transportRevision: options.transportRevision,
          serializerRevision: "authentication-email-v1",
          payloadDigest: await sha256Hex(canonicalJson(providerPayload)),
          providerIdempotencyKey: null,
          providerSafeReplayUntil: null,
          localMessageId: `<${deliveryId}@shareslices.local>`,
        },
        send: async () => ({
          classification: "provider_accepted",
          providerMessageId: await this.send(payload, deliveryId),
        }),
      };
    },
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
