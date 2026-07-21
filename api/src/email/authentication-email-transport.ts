import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";
import { renderAuthenticationEmailMessage } from "./authentication-email-message.js";

export type AuthenticationEmailTransportSnapshot = Readonly<{
  adapter: "smtp" | "resend";
  providerNamespace: string;
  senderIdentity: string;
  endpointIdentity: string;
  transportRevision: string;
  serializerRevision: "authentication-email-v1";
  payloadDigest: string;
  providerIdempotencyKey: string | null;
  providerSafeReplayUntil: Date | null;
  localMessageId: string;
}>;

export type AuthenticationEmailTransportResult = Readonly<{
  classification: "provider_accepted";
  providerMessageId: string | null;
}>;

export type PreparedAuthenticationEmailTransport = Readonly<{
  snapshot: AuthenticationEmailTransportSnapshot;
  send(): Promise<AuthenticationEmailTransportResult>;
}>;

export type AuthenticationEmailTransportAdapter = Readonly<{
  prepare(
    payload: AuthenticationEmailPayload,
    deliveryId: string,
    preSendAt: Date,
  ): Promise<PreparedAuthenticationEmailTransport>;
}>;

export function authenticationEmailProviderPayload(
  senderIdentity: string,
  payload: AuthenticationEmailPayload,
): Readonly<{
  from: string;
  to: readonly [string];
  subject: string;
  text: string;
  html: string;
}> {
  return {
    from: senderIdentity,
    to: [payload.email],
    ...renderAuthenticationEmailMessage(payload),
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
