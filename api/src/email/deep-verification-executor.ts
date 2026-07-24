import { createAuthenticationEmailSmtpAdapter } from "./authentication-email-smtp.js";
import {
  freezeResendTransport,
  sendWithResend,
} from "./authentication-email-resend.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error("email_deep_verification_executor_input_missing");
  return value;
};

async function execute() {
  const adapter = required("SHARESLICES_EMAIL_DEEP_ADAPTER");
  const recipient = required("SHARESLICES_EMAIL_DEEP_RECIPIENT");
  const nonce = required("SHARESLICES_EMAIL_DEEP_NONCE");
  const providerNamespace = required("SHARESLICES_EMAIL_DEEP_PROVIDER_NAMESPACE");
  const senderIdentity = required("SHARESLICES_EMAIL_DEEP_SENDER");
  const transportRevision = required("SHARESLICES_EMAIL_DEEP_TRANSPORT_REVISION");
  const secret = required("SHARESLICES_EMAIL_DEEP_SECRET");

  if (adapter === "smtp") {
    const endpointIdentity = required("SHARESLICES_EMAIL_DEEP_SMTP_ENDPOINT");
    const tlsPolicy = required("SHARESLICES_EMAIL_DEEP_SMTP_TLS_POLICY") as
      "starttls-required" | "tls-required";
    const smtpUrl = new URL(secret);
    const actualEndpoint =
      `${smtpUrl.hostname}:${smtpUrl.port || (smtpUrl.protocol === "smtps:" ? "465" : "587")}`;
    const tlsMatches =
      (tlsPolicy === "tls-required" && smtpUrl.protocol === "smtps:") ||
      (tlsPolicy === "starttls-required" &&
        smtpUrl.protocol === "smtp:" &&
        smtpUrl.searchParams.get("requireTLS") === "true");
    if (
      actualEndpoint !== endpointIdentity ||
      !tlsMatches ||
      smtpUrl.searchParams.get("tls.rejectUnauthorized") === "false"
    ) {
      throw new Error("email_deep_verification_smtp_identity_mismatch");
    }
    const smtp = createAuthenticationEmailSmtpAdapter({
      url: secret,
      from: senderIdentity,
      providerNamespace,
      transportRevision,
      endpointIdentity,
      tlsPolicy,
      dnsTimeoutMs: 5_000,
      connectionTimeoutMs: 10_000,
      greetingTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
    });
    try {
      const evidence = await smtp.verify(recipient);
      if (!evidence.messageSent) throw new Error("email_deep_verification_not_sent");
      return { outcome: "provider_accepted", providerMessageId: null };
    } finally {
      smtp.close();
    }
  }

  if (adapter === "resend") {
    const providerPayload = {
      from: senderIdentity,
      to: [recipient] as const,
      subject: "ShareSlices Resend check",
      text: "ShareSlices successfully submitted this Resend check message.",
      html: "<p>ShareSlices successfully submitted this Resend check message.</p>",
    };
    const frozen = await freezeResendTransport({
      logicalDeliveryId: `deep-verification-${nonce}`,
      payload: providerPayload,
      providerNamespace,
      senderDomain: senderIdentity.split("@").at(-1) ?? "",
      transportRevision,
      preSendAtMs: Date.now(),
      safetyMarginMs: 5 * 60 * 1_000,
    });
    const result = await sendWithResend({ apiKey: secret, frozen, payload: providerPayload });
    return result.kind === "provider_accepted"
      ? { outcome: result.kind, providerMessageId: result.providerMessageId }
      : { outcome: "indeterminate", providerMessageId: null };
  }

  throw new Error("email_deep_verification_adapter_invalid");
}

try {
  process.stdout.write(`${JSON.stringify(await execute())}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({
    outcome: "indeterminate",
    providerMessageId: null,
  })}\n`);
  process.exitCode = 1;
}
