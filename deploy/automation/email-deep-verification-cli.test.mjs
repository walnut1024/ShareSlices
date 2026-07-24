import assert from "node:assert/strict";
import test from "node:test";

import {executorEnvironment} from "./email-deep-verification-cli.mjs";

test("deep email executor inherits no unrelated caller or provider environment", () => {
  const environment = executorEnvironment({
    config: {kubernetes: {email: {
      endpointIdentity: "smtp.example.test:587",
      tlsPolicy: "starttls-required",
    }}},
    execution: {
      adapter: "smtp",
      recipient: "operator@example.test",
      nonce: "one-time-nonce-1234",
      providerNamespace: "enterprise",
      senderIdentity: "no-reply@example.test",
      transportRevision: "smtp-v1",
    },
    secret: "smtp://user:password@smtp.example.test:587?requireTLS=true",
    inherited: {
      PATH: "/usr/bin",
      RESEND_API_KEY: "caller-secret",
      DATABASE_URL: "caller-database",
    },
  });
  assert.deepEqual(Object.keys(environment).sort(), [
    "NODE_ENV",
    "PATH",
    "SHARESLICES_EMAIL_DEEP_ADAPTER",
    "SHARESLICES_EMAIL_DEEP_NONCE",
    "SHARESLICES_EMAIL_DEEP_PROVIDER_NAMESPACE",
    "SHARESLICES_EMAIL_DEEP_RECIPIENT",
    "SHARESLICES_EMAIL_DEEP_SECRET",
    "SHARESLICES_EMAIL_DEEP_SENDER",
    "SHARESLICES_EMAIL_DEEP_SMTP_ENDPOINT",
    "SHARESLICES_EMAIL_DEEP_SMTP_TLS_POLICY",
    "SHARESLICES_EMAIL_DEEP_TRANSPORT_REVISION",
  ]);
});

