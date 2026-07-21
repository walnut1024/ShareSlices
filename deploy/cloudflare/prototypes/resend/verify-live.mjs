import { lstat, readFile } from "node:fs/promises";

import {
  buildSendRequest,
  classifyResponse,
  freezeTransport,
  redactEvidence
} from "./resend-contract.mjs";

const keyFile = process.env.RESEND_API_KEY_FILE;
if (!keyFile) {
  process.stdout.write(
    `${JSON.stringify({ status: "blocked", reason: "resend_api_key_file_required" })}\n`
  );
  process.exitCode = 2;
} else {
  const keyFileStat = await lstat(keyFile);
  if (!keyFileStat.isFile() || keyFileStat.isSymbolicLink() || (keyFileStat.mode & 0o077) !== 0) {
    throw new Error("resend_api_key_file_must_be_regular_and_mode_0600");
  }
  const apiKey = (await readFile(keyFile, "utf8")).trim();
  const payload = {
    from: "ShareSlices <onboarding@resend.dev>",
    to: ["delivered+shareslices-qualification@resend.dev"],
    subject: "ShareSlices Resend qualification",
    text: "This is a Resend test-mode qualification message.",
    html: "<p>This is a Resend test-mode qualification message.</p>"
  };
  const frozen = freezeTransport({
    logicalDeliveryId: `qualification-${new Date().toISOString().slice(0, 10)}`,
    payload,
    providerNamespace: process.env.RESEND_TEAM_NAMESPACE ?? "operator-declared-team",
    senderDomain: "resend.dev",
    transportRevision: process.env.RESEND_TRANSPORT_REVISION ?? "test-mode-v1",
    preSendAtMs: Date.now(),
    safetyMarginMs: 5 * 60 * 1000
  });
  const request = buildSendRequest({ apiKey, frozen, payload });

  const first = await classifyResponse(await fetch(request.url, request.init));
  let replay = { outcome: "not_run" };
  if (first.outcome === "provider_accepted") {
    replay = await classifyResponse(await fetch(request.url, request.init));
  }

  const evidence = redactEvidence({
    mode: "resend_dev_test_addresses",
    first,
    replay,
    sameProviderMessageId:
      first.providerMessageId && replay.providerMessageId
        ? first.providerMessageId === replay.providerMessageId
        : false,
    idempotencyKey: frozen.idempotencyKey,
    providerSafeReplayUntilMs: frozen.providerSafeReplayUntilMs,
    limitations: [
      "not_verified_custom_domain",
      "not_domain_scoped_sending_access_key",
      "not_external_inbox_delivery",
      "not_same_team_domain_key_rotation"
    ]
  });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);

  if (first.outcome !== "provider_accepted" || replay.outcome !== "provider_accepted") {
    process.exitCode = 1;
  }
}
