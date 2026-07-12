import { env } from "../env.js";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { createAuthenticationEmailSmtpAdapter } from "./authentication-email-smtp.js";

const adapter = createAuthenticationEmailSmtpAdapter({
  url: env.AUTH_EMAIL_SMTP_URL,
  from: env.AUTH_EMAIL_FROM,
  connectionTimeoutMs: env.AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS,
  greetingTimeoutMs: env.AUTH_EMAIL_SMTP_GREETING_TIMEOUT_MS,
  socketTimeoutMs: env.AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS
});

try {
  await adapter.verify(env.AUTH_EMAIL_SMTP_CHECK_TO);
  apiLogger.emit({
    severity: "INFO",
    body: env.AUTH_EMAIL_SMTP_CHECK_TO ? "SMTP probe delivered." : "SMTP connection verified.",
    eventName: env.AUTH_EMAIL_SMTP_CHECK_TO
      ? "shareslices.authentication_email.smtp.probe_delivered"
      : "shareslices.authentication_email.smtp.verified"
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
