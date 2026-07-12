import assert from "node:assert/strict";
import test from "node:test";
import { buildSmtpCheckEnv } from "./run-smtp-check.mjs";

test("a higher-priority SMTP URL file replaces the catalog URL default", () => {
  assert.deepEqual(
    buildSmtpCheckEnv(
      { AUTH_EMAIL_SMTP_URL: "smtp://127.0.0.1:1025", PORT: "7456" },
      { AUTH_EMAIL_SMTP_URL_FILE: "/run/secrets/smtp-url" },
      {}
    ),
    { AUTH_EMAIL_SMTP_URL_FILE: "/run/secrets/smtp-url", PORT: "7456" }
  );
});

test("conflicting values from the same layer remain visible to typed validation", () => {
  assert.deepEqual(
    buildSmtpCheckEnv(
      {},
      { AUTH_EMAIL_SMTP_URL: "smtp://mailpit:1025", AUTH_EMAIL_SMTP_URL_FILE: "/run/secrets/smtp-url" },
      {}
    ),
    { AUTH_EMAIL_SMTP_URL: "smtp://mailpit:1025", AUTH_EMAIL_SMTP_URL_FILE: "/run/secrets/smtp-url" }
  );
});

test("a higher-priority direct SMTP URL replaces a URL file", () => {
  assert.deepEqual(
    buildSmtpCheckEnv(
      {},
      { AUTH_EMAIL_SMTP_URL_FILE: "/run/secrets/smtp-url" },
      { AUTH_EMAIL_SMTP_URL: "smtps://user:pass@smtp.example.com:465" }
    ),
    { AUTH_EMAIL_SMTP_URL: "smtps://user:pass@smtp.example.com:465" }
  );
});
