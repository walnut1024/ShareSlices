import type { AuthenticationEmailPayload } from "../application/accounts/authentication-email.js";
import {
  authenticationEmailProviderPayload,
  canonicalJson,
  sha256Hex,
  type AuthenticationEmailTransportAdapter,
} from "./authentication-email-transport.js";

export const RESEND_API_URL = "https://api.resend.com/emails";
export const RESEND_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const RESEND_USER_AGENT = "ShareSlices-Cloudflare/1.0";

export type ResendPayload = Readonly<{
  from: string;
  to: readonly [string];
  subject: string;
  text: string;
  html: string;
}>;

export type FrozenResendTransport = Readonly<{
  adapter: "resend";
  providerNamespace: string;
  senderDomain: string;
  transportRevision: string;
  payloadDigest: string;
  idempotencyKey: string;
  providerSafeReplayUntilMs: number;
}>;

export type ResendSendOutcome =
  | Readonly<{ kind: "provider_accepted"; providerMessageId: string; status: number }>
  | Readonly<{
      kind: "retryable" | "quota_exceeded" | "permanent_failure" | "indeterminate";
      errorType: string;
      status: number | null;
      retryAfter: string | null;
    }>;

const retryableTypes = new Set([
  "concurrent_idempotent_requests",
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
]);
const quotaTypes = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);
const permanentTypes = new Set([
  "invalid_idempotency_key",
  "invalid_idempotent_request",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "security_error",
]);

function senderDomain(from: string): string | null {
  const address = from.match(/(?:<)?[^<>\s@]+@([^<>\s@]+)>?$/)?.[1];
  return address?.toLowerCase() ?? null;
}

export function resendPayload(
  from: string,
  payload: AuthenticationEmailPayload,
): ResendPayload {
  return authenticationEmailProviderPayload(from, payload);
}

export class ResendAuthenticationEmailTransportError extends Error {
  constructor(
    public readonly outcome: Exclude<ResendSendOutcome, Readonly<{ kind: "provider_accepted" }>>,
  ) {
    super(outcome.kind);
    this.name = "ResendAuthenticationEmailTransportError";
  }
}

export function createAuthenticationEmailResendAdapter(options: Readonly<{
  apiKey: string;
  from: string;
  providerNamespace: string;
  transportRevision: string;
  safetyMarginMs: number;
  fetch?: typeof fetch;
}>): AuthenticationEmailTransportAdapter {
  return {
    async prepare(payload, deliveryId, preSendAt, frozenSnapshot) {
      const providerPayload = resendPayload(options.from, payload);
      const configuredSenderDomain = senderDomain(options.from) ?? "";
      const frozen = frozenSnapshot
        ? await restoreFrozenResendTransport({
            deliveryId,
            payload: providerPayload,
            snapshot: frozenSnapshot,
            providerNamespace: options.providerNamespace,
            senderIdentity: options.from,
            senderDomain: configuredSenderDomain,
            transportRevision: options.transportRevision,
          })
        : await freezeResendTransport({
            logicalDeliveryId: deliveryId,
            payload: providerPayload,
            providerNamespace: options.providerNamespace,
            senderDomain: configuredSenderDomain,
            transportRevision: options.transportRevision,
            preSendAtMs: preSendAt.getTime(),
            safetyMarginMs: options.safetyMarginMs,
          });
      return {
        snapshot: {
          adapter: "resend",
          providerNamespace: frozen.providerNamespace,
          senderIdentity: options.from,
          endpointIdentity: RESEND_API_URL,
          transportRevision: frozen.transportRevision,
          serializerRevision: "authentication-email-v1",
          payloadDigest: frozen.payloadDigest,
          providerIdempotencyKey: frozen.idempotencyKey,
          providerSafeReplayUntil: new Date(frozen.providerSafeReplayUntilMs),
          localMessageId: `<${deliveryId}@shareslices.local>`,
        },
        async send() {
          const result = await sendWithResend({
            apiKey: options.apiKey,
            frozen,
            payload: providerPayload,
            ...(options.fetch ? { fetch: options.fetch } : {}),
          });
          if (result.kind !== "provider_accepted") {
            throw new ResendAuthenticationEmailTransportError(result);
          }
          return { classification: "provider_accepted", providerMessageId: result.providerMessageId };
        },
      };
    },
  };
}

async function restoreFrozenResendTransport(input: Readonly<{
  deliveryId: string;
  payload: ResendPayload;
  snapshot: import("./authentication-email-transport.js").AuthenticationEmailTransportSnapshot;
  providerNamespace: string;
  senderIdentity: string;
  senderDomain: string;
  transportRevision: string;
}>): Promise<FrozenResendTransport> {
  const { snapshot } = input;
  if (
    snapshot.adapter !== "resend"
    || snapshot.providerNamespace !== input.providerNamespace
    || snapshot.senderIdentity !== input.senderIdentity
    || snapshot.endpointIdentity !== RESEND_API_URL
    || snapshot.transportRevision !== input.transportRevision
    || snapshot.serializerRevision !== "authentication-email-v1"
    || snapshot.localMessageId !== `<${input.deliveryId}@shareslices.local>`
    || !snapshot.providerIdempotencyKey
    || !snapshot.providerSafeReplayUntil
  ) throw new Error("authentication_email_transport_snapshot_conflict");
  const payloadDigest = await sha256Hex(canonicalJson(input.payload));
  if (payloadDigest !== snapshot.payloadDigest) throw new Error("resend_payload_changed");
  if (senderDomain(input.payload.from) !== input.senderDomain.toLowerCase()) {
    throw new Error("resend_sender_domain_mismatch");
  }
  return {
    adapter: "resend",
    providerNamespace: snapshot.providerNamespace,
    senderDomain: input.senderDomain,
    transportRevision: snapshot.transportRevision,
    payloadDigest,
    idempotencyKey: snapshot.providerIdempotencyKey,
    providerSafeReplayUntilMs: snapshot.providerSafeReplayUntil.getTime(),
  };
}

export async function freezeResendTransport(input: Readonly<{
  logicalDeliveryId: string;
  payload: ResendPayload;
  providerNamespace: string;
  senderDomain: string;
  transportRevision: string;
  preSendAtMs: number;
  safetyMarginMs: number;
}>): Promise<FrozenResendTransport> {
  if (!input.providerNamespace || !input.senderDomain || !input.transportRevision) {
    throw new Error("transport_identity_incomplete");
  }
  if (senderDomain(input.payload.from) !== input.senderDomain.toLowerCase()) {
    throw new Error("resend_sender_domain_mismatch");
  }
  if (!(input.safetyMarginMs > 0 && input.safetyMarginMs < RESEND_IDEMPOTENCY_RETENTION_MS)) {
    throw new Error("invalid_resend_safety_margin");
  }
  const payloadDigest = await sha256Hex(canonicalJson(input.payload));
  const keyDigest = await sha256Hex(`shareslices-resend-v1\0${input.logicalDeliveryId}\0${payloadDigest}`);
  return {
    adapter: "resend",
    providerNamespace: input.providerNamespace,
    senderDomain: input.senderDomain,
    transportRevision: input.transportRevision,
    payloadDigest,
    idempotencyKey: `shareslices-email-v1/${keyDigest}`,
    providerSafeReplayUntilMs: input.preSendAtMs + RESEND_IDEMPOTENCY_RETENTION_MS - input.safetyMarginMs,
  };
}

export async function sendWithResend(input: Readonly<{
  apiKey: string;
  frozen: FrozenResendTransport;
  payload: ResendPayload;
  fetch?: typeof fetch;
}>): Promise<ResendSendOutcome> {
  if (!input.apiKey) throw new Error("resend_api_key_missing");
  if (await sha256Hex(canonicalJson(input.payload)) !== input.frozen.payloadDigest) {
    throw new Error("resend_payload_changed");
  }
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.frozen.idempotencyKey,
        "User-Agent": RESEND_USER_AGENT,
      },
      body: canonicalJson(input.payload),
    });
  } catch {
    return { kind: "indeterminate", errorType: "network_error", status: null, retryAfter: null };
  }
  const retryAfter = response.headers.get("retry-after");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      kind: response.status >= 500 ? "retryable" : "indeterminate",
      errorType: "non_json_response",
      status: response.status,
      retryAfter,
    };
  }
  if (response.ok && typeof (body as { id?: unknown }).id === "string") {
    return { kind: "provider_accepted", providerMessageId: (body as { id: string }).id, status: response.status };
  }
  const candidate = body as { name?: unknown; type?: unknown };
  const providerErrorType = typeof candidate.name === "string"
    ? candidate.name
    : typeof candidate.type === "string" ? candidate.type : "unknown_error_type";
  const knownErrorType = retryableTypes.has(providerErrorType)
    || quotaTypes.has(providerErrorType)
    || permanentTypes.has(providerErrorType);
  const errorType = knownErrorType ? providerErrorType : "unknown_error_type";
  const kind = quotaTypes.has(errorType)
    ? "quota_exceeded"
    : retryableTypes.has(errorType) || response.status >= 500 || response.status === 429
      ? "retryable"
      : permanentTypes.has(errorType) ? "permanent_failure" : "indeterminate";
  return { kind, errorType, status: response.status, retryAfter };
}
