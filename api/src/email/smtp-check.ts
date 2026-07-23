import { readSmtpProbeEnv } from "../env.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { createAuthenticationEmailSmtpAdapter } from "./authentication-email-smtp.js";

const env = readSmtpProbeEnv();
const adapter = createAuthenticationEmailSmtpAdapter({
  url: env.AUTH_EMAIL_SMTP_URL,
  from: env.AUTH_EMAIL_FROM,
  providerNamespace: env.AUTH_EMAIL_TRANSPORT_NAMESPACE,
  transportRevision: env.AUTH_EMAIL_TRANSPORT_REVISION,
  endpointIdentity: env.AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY,
  tlsPolicy: env.AUTH_EMAIL_SMTP_TLS_POLICY,
  dnsTimeoutMs: env.AUTH_EMAIL_SMTP_DNS_TIMEOUT_MS,
  connectionTimeoutMs: env.AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  greetingTimeoutMs: env.AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS,
  socketTimeoutMs: env.AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS
});

try {
  const evidence = await adapter.verify(env.AUTH_EMAIL_SMTP_CHECK_TO);
  apiLogger.emit({
    severity: "INFO",
    body: env.AUTH_EMAIL_SMTP_CHECK_TO ? "SMTP probe delivered." : "SMTP connection verified.",
    eventName: env.AUTH_EMAIL_SMTP_CHECK_TO
      ? "shareslices.authentication_email.smtp.probe_delivered"
      : "shareslices.authentication_email.smtp.verified",
    attributes: {
      "shareslices.authentication_email.smtp.endpoint_identity": evidence.endpointIdentity,
      "shareslices.authentication_email.smtp.tls_policy": evidence.tlsPolicy,
      "shareslices.authentication_email.smtp.authentication_configured": evidence.authenticationConfigured,
      "shareslices.authentication_email.smtp.sender_syntax_validated": evidence.senderSyntaxValidated,
      "shareslices.authentication_email.smtp.message_sent": evidence.messageSent,
    },
  });
} catch (error) {
  apiLogger.emit({
    severity: "ERROR",
    body: "SMTP verification failed.",
    eventName: "shareslices.authentication_email.smtp.verification_failed",
    attributes: exceptionAttributes(error)
  });
  process.exitCode = 1;
} finally {
  adapter.close();
}
