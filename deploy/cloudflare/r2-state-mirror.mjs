import {canonicalBytes, sha256Digest} from "../automation/canonical.mjs";

export class CloudflareStateMirrorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CloudflareStateMirrorError";
    this.code = code;
  }
}

function mirrorBody({installationId, lease, records, controlRevision}) {
  if (
    typeof installationId !== "string" ||
    installationId.length === 0 ||
    !Number.isSafeInteger(lease?.fencingToken) ||
    lease.fencingToken <= 0 ||
    typeof lease.operationId !== "string" ||
    !Number.isSafeInteger(controlRevision) ||
    controlRevision < 0 ||
    !records ||
    typeof records !== "object" ||
    Array.isArray(records)
  ) {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_input_invalid",
      "The R2 deployment-state mirror input is incomplete.",
    );
  }
  const body = {
    schemaVersion: "shareslices.cloudflare-deployment-state/v1",
    installationId,
    fencingToken: lease.fencingToken,
    operationId: lease.operationId,
    controlRevision,
    records,
  };
  const serialized = canonicalBytes(body);
  const text = serialized.toString("utf8");
  if (/secret:\/\/|password|api[_-]?key|authorization/i.test(text)) {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_sensitive",
      "The R2 deployment-state mirror must remain Secret-free.",
    );
  }
  return {body, text, digest: sha256Digest(serialized)};
}

async function readCurrent(bucket, key, installationId) {
  const object = await bucket.get(key);
  if (!object) return null;
  let body;
  try {
    body = JSON.parse(await object.text());
  } catch {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_malformed",
      "The existing R2 deployment-state mirror is malformed.",
    );
  }
  if (
    body?.schemaVersion !== "shareslices.cloudflare-deployment-state/v1" ||
    body.installationId !== installationId ||
    !Number.isSafeInteger(body.fencingToken) ||
    typeof object.etag !== "string" ||
    object.etag.length === 0
  ) {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_untrusted",
      "The existing R2 deployment-state mirror identity is untrusted.",
    );
  }
  return {body, etag: object.etag, digest: sha256Digest(canonicalBytes(body))};
}

export async function mirrorCloudflareDeploymentState(input) {
  const key = `deployments/${input.installationId}/state.json`;
  await input.assertLease(input.lease);
  const desired = mirrorBody(input);
  const current = await readCurrent(input.bucket, key, input.installationId);
  if (current?.body.fencingToken > input.lease.fencingToken) {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_stale_fence",
      "A newer fencing token already owns the R2 deployment-state mirror.",
    );
  }
  if (
    current?.body.fencingToken === input.lease.fencingToken &&
    current.digest === desired.digest
  ) {
    return Object.freeze({
      outcome: "unchanged",
      key,
      fencingToken: input.lease.fencingToken,
      digest: desired.digest,
      etag: current.etag,
    });
  }
  await input.assertLease(input.lease);
  let written;
  try {
    written = await input.bucket.put(key, desired.text, {
      onlyIf: current
        ? {etagMatches: current.etag}
        : {etagDoesNotMatch: "*"},
      httpMetadata: {contentType: "application/json", cacheControl: "no-store"},
      customMetadata: {
        installation: input.installationId,
        fence: String(input.lease.fencingToken),
        digest: desired.digest,
      },
    });
  } catch {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_write_indeterminate",
      "The R2 conditional write outcome is indeterminate; reconcile from PostgreSQL and R2.",
    );
  }
  if (!written) {
    throw new CloudflareStateMirrorError(
      "cloudflare_state_mirror_precondition_failed",
      "The R2 deployment-state mirror changed concurrently; reconcile before another fenced operation.",
    );
  }
  await input.assertLease(input.lease);
  return Object.freeze({
    outcome: "updated",
    key,
    fencingToken: input.lease.fencingToken,
    digest: desired.digest,
    etag: written.etag,
  });
}
