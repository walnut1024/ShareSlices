import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {
  authorizeEmailDeepVerification,
  createEmailDeepVerificationAuthorization,
  deepEmailConfigurationDigest,
  EmailDeepVerificationError,
  runEmailDeepVerification,
} from "./email-deep-verification.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
));
const now = new Date("2026-07-24T12:00:00.000Z");

function authorization(config = fixture) {
  return {
    schemaVersion: "shareslices.email-deep-verification-authorization/v1",
    acknowledgement: "send-one-transactional-email",
    installationId: config.installationId,
    target: config.target,
    adapter: "resend",
    recipient: "operator@example.test",
    configurationDigest: deepEmailConfigurationDigest(config),
    nonce: "one-time-nonce-1234",
    issuedAt: "2026-07-24T11:55:00.000Z",
    expiresAt: "2026-07-24T12:05:00.000Z",
  };
}

test("authorizes one short-lived delivery bound to the exact deployment configuration", async () => {
  const result = await authorizeEmailDeepVerification({
    config: fixture,
    authorization: authorization(),
    now,
  });
  assert.equal(result.execution.adapter, "resend");
  assert.equal(result.execution.providerNamespace, "shareslices-production");
  assert.match(result.execution.recipientDigest, /^sha256:[a-f0-9]{64}$/);
});

test("creates a bounded explicit authorization without resolving a Secret", async () => {
  const result = await createEmailDeepVerificationAuthorization({
    config: fixture,
    recipient: "operator@example.test",
    now,
    nonce: "one-time-nonce-1234",
  });
  assert.deepEqual(result, {
    ...authorization(),
    issuedAt: "2026-07-24T12:00:00.000Z",
    expiresAt: "2026-07-24T12:15:00.000Z",
  });
  assert.equal(JSON.stringify(result).includes("secret://resend/sending"), false);
});

test("rejects expired, mismatched, or administratively unhealthy authorization", async () => {
  for (const mutate of [
    (config, auth) => { auth.expiresAt = "2026-07-24T11:59:59.000Z"; },
    (config, auth) => { auth.configurationDigest = `sha256:${"0".repeat(64)}`; },
    (config) => { config.cloudflare.email.operatorEvidence.teamRatePosture = "unknown"; },
    (config) => { config.cloudflare.email.operatorEvidence.accountSuspended = true; },
  ]) {
    const config = structuredClone(fixture);
    const auth = authorization(config);
    mutate(config, auth);
    await assert.rejects(
      authorizeEmailDeepVerification({config, authorization: auth, now}),
      (error) => error instanceof EmailDeepVerificationError,
    );
  }
});

test("claims a receipt before sending, redacts recipient, and refuses replay", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-email-deep-"));
  const receiptPath = resolve(root, "receipt.json");
  let calls = 0;
  try {
    const result = await runEmailDeepVerification({
      config: fixture,
      authorization: authorization(),
      receiptPath,
      now,
      send: async ({recipient}) => {
        calls += 1;
        assert.equal(recipient, "operator@example.test");
        return {
          outcome: "provider_accepted",
          providerMessageId: "provider-1",
          providerSafeReplayUntil: "2026-07-25T11:55:00.000Z",
        };
      },
    });
    assert.equal(result.state, "provider_accepted");
    assert.equal(
      result.providerSafeReplayUntil,
      "2026-07-25T11:55:00.000Z",
    );
    assert.equal(JSON.stringify(result).includes("operator@example.test"), false);
    await assert.rejects(
      runEmailDeepVerification({
        config: fixture,
        authorization: authorization(),
        receiptPath,
        now,
        send: async () => ({outcome: "provider_accepted"}),
      }),
      (error) => error.code === "email_deep_verification_already_attempted",
    );
    assert.equal(calls, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("Resend acceptance requires a provider ID and a live safe replay window", async () => {
  for (const result of [
    {
      outcome: "provider_accepted",
      providerMessageId: null,
      providerSafeReplayUntil: "2026-07-25T11:55:00.000Z",
    },
    {
      outcome: "provider_accepted",
      providerMessageId: "provider-1",
      providerSafeReplayUntil: "2026-07-24T11:59:59.000Z",
    },
  ]) {
    const root = await mkdtemp(resolve(tmpdir(), "shareslices-email-deep-"));
    try {
      const receipt = await runEmailDeepVerification({
        config: fixture,
        authorization: authorization(),
        receiptPath: resolve(root, "receipt.json"),
        now,
        send: async () => result,
      });
      assert.equal(receipt.state, "indeterminate");
      assert.equal(receipt.providerSafeReplayUntil, null);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  }
});

test("retains an indeterminate receipt when the provider call throws", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-email-deep-"));
  const receiptPath = resolve(root, "receipt.json");
  try {
    const result = await runEmailDeepVerification({
      config: fixture,
      authorization: authorization(),
      receiptPath,
      now,
      send: async () => { throw new Error("secret provider detail"); },
    });
    assert.equal(result.state, "indeterminate");
    assert.equal((await readFile(receiptPath, "utf8")).includes("secret provider detail"), false);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
