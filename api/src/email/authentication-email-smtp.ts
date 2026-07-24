import nodemailer, { type Transporter } from "nodemailer";
// cspell:ignore EAUTH ECONNECTION EDNS EENVELOPE
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
  endpointIdentity: string;
  tlsPolicy: "plaintext-allowed" | "starttls-required" | "tls-required";
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
  verify(checkTo?: string): Promise<Readonly<{
    endpointIdentity: string;
    tlsPolicy: AuthenticationEmailSmtpOptions["tlsPolicy"];
    authenticationConfigured: boolean;
    senderSyntaxValidated: true;
    messageSent: boolean;
  }>>;
  close(): void;
};

export type AuthenticationEmailSmtpFailureKind =
  | "known_not_submitted_retryable"
  | "provider_rejected"
  | "acceptance_indeterminate";

export class AuthenticationEmailSmtpTransportError extends Error {
  readonly kind: AuthenticationEmailSmtpFailureKind;

  constructor(kind: AuthenticationEmailSmtpFailureKind) {
    super(`authentication_email_smtp_${kind}`);
    this.name = "AuthenticationEmailSmtpTransportError";
    this.kind = kind;
  }
}

function classifySmtpFailure(error: unknown): AuthenticationEmailSmtpFailureKind {
  const evidence = error && typeof error === "object"
    ? error as {
        code?: unknown;
        responseCode?: unknown;
        syscall?: unknown;
        command?: unknown;
      }
    : {};
  if (
    evidence.code === "EDNS" ||
    evidence.code === "ECONNECTION" ||
    (
      evidence.code === "ESOCKET" &&
      evidence.syscall === "connect" &&
      evidence.command === "CONN"
    )
  ) {
    return "known_not_submitted_retryable";
  }
  if (evidence.code === "EENVELOPE") {
    return typeof evidence.responseCode === "number" && evidence.responseCode >= 400 && evidence.responseCode < 500
      ? "known_not_submitted_retryable"
      : "provider_rejected";
  }
  if (evidence.code === "EAUTH") return "provider_rejected";
  return "acceptance_indeterminate";
}

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
      endpointIdentity: options.endpointIdentity,
      transportRevision: options.transportRevision,
      serializerRevision: "authentication-email-v1",
    },
    async prepare(payload, deliveryId, _preSendAt, frozenSnapshot) {
      const providerPayload = authenticationEmailProviderPayload(options.from, payload);
      const snapshot = {
          adapter: "smtp",
          providerNamespace: options.providerNamespace,
          senderIdentity: options.from,
          endpointIdentity: options.endpointIdentity,
          transportRevision: options.transportRevision,
          serializerRevision: "authentication-email-v1",
          payloadDigest: await sha256Hex(canonicalJson(providerPayload)),
          providerIdempotencyKey: null,
          providerSafeReplayUntil: null,
          localMessageId: `<${deliveryId}@shareslices.local>`,
        } as const;
      if (frozenSnapshot && (
        frozenSnapshot.adapter !== snapshot.adapter
        || frozenSnapshot.providerNamespace !== snapshot.providerNamespace
        || frozenSnapshot.senderIdentity !== snapshot.senderIdentity
        || frozenSnapshot.endpointIdentity !== snapshot.endpointIdentity
        || frozenSnapshot.transportRevision !== snapshot.transportRevision
        || frozenSnapshot.serializerRevision !== snapshot.serializerRevision
        || frozenSnapshot.payloadDigest !== snapshot.payloadDigest
        || frozenSnapshot.localMessageId !== snapshot.localMessageId
      )) throw new Error("authentication_email_transport_snapshot_conflict");
      return {
        snapshot: frozenSnapshot ?? snapshot,
        send: async () => ({
          classification: "provider_accepted",
          providerMessageId: await this.send(payload, deliveryId),
        }),
      };
    },
    async send(payload, deliveryId) {
      const message = renderAuthenticationEmailMessage(payload);
      const messageId = `<${deliveryId}@shareslices.local>`;
      try {
        const result = await transporter.sendMail({
          from: options.from,
          to: payload.email,
          messageId,
          ...message
        });
        return result.messageId;
      } catch (error) {
        throw new AuthenticationEmailSmtpTransportError(classifySmtpFailure(error));
      }
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
      return Object.freeze({
        endpointIdentity: options.endpointIdentity,
        tlsPolicy: options.tlsPolicy,
        authenticationConfigured: Boolean(new URL(options.url).username),
        senderSyntaxValidated: true,
        messageSent: Boolean(checkTo),
      });
    },
    close() {
      transporter.close();
    }
  };
}
