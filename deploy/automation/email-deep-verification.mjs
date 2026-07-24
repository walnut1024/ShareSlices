import {open, readFile, writeFile} from "node:fs/promises";

import {sha256Digest} from "./canonical.mjs";
import {validateDeploymentConfig} from "./config.mjs";

const acknowledgement = "send-one-transactional-email";
const maximumAuthorizationLifetimeMs = 15 * 60 * 1_000;

export class EmailDeepVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EmailDeepVerificationError";
    this.code = code;
  }
}

function emailConfiguration(config) {
  return config.target === "kubernetes"
    ? {
        adapter: "smtp",
        providerNamespace: config.kubernetes.email.relayNamespace,
        senderIdentity: config.kubernetes.email.sender,
        transportRevision: config.kubernetes.email.configurationRevision,
        secretRevision: config.kubernetes.email.smtp.revision,
      }
    : {
        adapter: "resend",
        providerNamespace: config.cloudflare.email.teamNamespace,
        senderIdentity: config.cloudflare.email.senderAddress,
        transportRevision: config.cloudflare.email.transportRevision,
        secretRevision: config.cloudflare.email.resend.revision,
        operatorEvidence: config.cloudflare.email.operatorEvidence,
      };
}

export function deepEmailConfigurationDigest(config) {
  return sha256Digest({
    installationId: config.installationId,
    target: config.target,
    email: emailConfiguration(config),
  });
}

export async function createEmailDeepVerificationAuthorization({
  config: inputConfig,
  recipient,
  now = new Date(),
  nonce = crypto.randomUUID(),
}) {
  const config = await validateDeploymentConfig(inputConfig);
  if (typeof recipient !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new EmailDeepVerificationError(
      "email_deep_verification_recipient_invalid",
      "Deep email verification requires one valid recipient address.",
    );
  }
  const configuration = emailConfiguration(config);
  return Object.freeze({
    schemaVersion: "shareslices.email-deep-verification-authorization/v1",
    acknowledgement,
    installationId: config.installationId,
    target: config.target,
    adapter: configuration.adapter,
    recipient,
    configurationDigest: deepEmailConfigurationDigest(config),
    nonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + maximumAuthorizationLifetimeMs).toISOString(),
  });
}

function assertCurrentResendEvidence(configuration, now) {
  const evidence = configuration.operatorEvidence;
  const observedAt = Date.parse(evidence?.observedAt);
  const age = now.getTime() - observedAt;
  if (
    !Number.isFinite(observedAt) ||
    age < 0 ||
    age > evidence.maximumAgeSeconds * 1_000 ||
    evidence.domainVerified !== true ||
    evidence.trackingDisabled !== true ||
    evidence.teamRatePosture !== "within_limits" ||
    evidence.bounceSpamHealth !== "healthy" ||
    evidence.accountSuspended !== false ||
    evidence.sameTeamDomainRotationAttested !== true
  ) {
    throw new EmailDeepVerificationError(
      "email_deep_verification_operator_evidence_unavailable",
      "Current healthy Resend operator evidence is required.",
    );
  }
}

export async function authorizeEmailDeepVerification({
  config: inputConfig,
  authorization,
  now = new Date(),
}) {
  const config = await validateDeploymentConfig(inputConfig);
  const configuration = emailConfiguration(config);
  const issuedAt = Date.parse(authorization?.issuedAt);
  const expiresAt = Date.parse(authorization?.expiresAt);
  if (
    authorization?.schemaVersion !== "shareslices.email-deep-verification-authorization/v1" ||
    authorization?.acknowledgement !== acknowledgement ||
    authorization?.installationId !== config.installationId ||
    authorization?.target !== config.target ||
    authorization?.adapter !== configuration.adapter ||
    authorization?.configurationDigest !== deepEmailConfigurationDigest(config) ||
    typeof authorization?.recipient !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorization.recipient) ||
    typeof authorization?.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(authorization.nonce) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now.getTime() ||
    expiresAt <= now.getTime() ||
    expiresAt - issuedAt > maximumAuthorizationLifetimeMs
  ) {
    throw new EmailDeepVerificationError(
      "email_deep_verification_authorization_invalid",
      "Deep email verification requires a current authorization bound to this configuration.",
    );
  }
  if (configuration.adapter === "resend") {
    assertCurrentResendEvidence(configuration, now);
  }
  return Object.freeze({
    config,
    execution: Object.freeze({
      adapter: configuration.adapter,
      recipient: authorization.recipient,
      nonce: authorization.nonce,
      providerNamespace: configuration.providerNamespace,
      senderIdentity: configuration.senderIdentity,
      transportRevision: configuration.transportRevision,
      recipientDigest: sha256Digest({
        installationId: config.installationId,
        recipient: authorization.recipient.toLowerCase(),
      }),
    }),
  });
}

export async function runEmailDeepVerification({
  config,
  authorization,
  receiptPath,
  send,
  now = new Date(),
}) {
  if (!receiptPath || typeof send !== "function") {
    throw new EmailDeepVerificationError(
      "email_deep_verification_input_invalid",
      "A one-shot receipt path and sender are required.",
    );
  }
  const authorized = await authorizeEmailDeepVerification({config, authorization, now});
  let receipt;
  try {
    receipt = await open(receiptPath, "wx", 0o600);
    await receipt.writeFile(JSON.stringify({
      schemaVersion: "shareslices.email-deep-verification-receipt/v1",
      state: "submitting",
      nonce: authorized.execution.nonce,
      adapter: authorized.execution.adapter,
      recipientDigest: authorized.execution.recipientDigest,
      startedAt: now.toISOString(),
    }));
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new EmailDeepVerificationError(
        "email_deep_verification_already_attempted",
        "This receipt path already contains an attempted deep verification.",
      );
    }
    throw error;
  } finally {
    await receipt?.close();
  }

  let result;
  try {
    result = await send(authorized.execution);
  } catch {
    result = {outcome: "indeterminate", providerMessageId: null};
  }
  const accepted = result?.outcome === "provider_accepted";
  const finalReceipt = Object.freeze({
    schemaVersion: "shareslices.email-deep-verification-receipt/v1",
    state: accepted ? "provider_accepted" : "indeterminate",
    nonce: authorized.execution.nonce,
    adapter: authorized.execution.adapter,
    recipientDigest: authorized.execution.recipientDigest,
    providerMessageId:
      typeof result?.providerMessageId === "string" ? result.providerMessageId : null,
    completedAt: new Date().toISOString(),
  });
  await writeFile(receiptPath, `${JSON.stringify(finalReceipt)}\n`, {mode: 0o600});
  return finalReceipt;
}

export async function readEmailDeepVerificationInput(configPath, authorizationPath) {
  const [config, authorization] = await Promise.all(
    [configPath, authorizationPath].map(async (path) =>
      JSON.parse(await readFile(path, "utf8"))),
  );
  return {config, authorization};
}
