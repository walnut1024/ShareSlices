import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
import {renderCloudflareBundle} from "./render.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));
const baseRelease = JSON.parse(await readFile(
  new URL("../contract/fixtures/release.valid.json", import.meta.url),
  "utf8",
));
const names = [
  ["app-worker-bundle", "worker-bundle"],
  ["content-worker-bundle", "worker-bundle"],
  ["jobs-worker-bundle", "worker-bundle"],
  ["static-assets", "static-assets"],
  ["trusted-processing-image", "oci-image"],
  ["thumbnail-image", "oci-image"],
];
const release = {
  ...baseRelease,
  artifacts: names.map(([name, artifactKind], index) => {
    const character = String(index + 1);
    const contentDigest = `sha256:${character.repeat(64)}`;
    return {
      name,
      artifactKind,
      ...(artifactKind === "oci-image" ? {platforms: ["linux/amd64"]} : {}),
      contentDigest,
      providerIdentity: {
        kind: "digest",
        value: contentDigest,
        qualified: true,
        mutable: false,
      },
    };
  }),
};

test("renders one deterministic Secret-free Cloudflare target bundle", async () => {
  const first = await renderCloudflareBundle({config, release});
  const second = await renderCloudflareBundle({config, release});
  assert.deepEqual(second, first);
  assert.equal(first.target, "cloudflare");
  assert.equal(first.releaseId, release.releaseId);
  assert.deepEqual(first.phases.map(({id}) => id), [
    "prerequisites",
    "migration",
    "private-runtime",
    "public-runtime",
    "verification",
  ]);
  assert.equal(first.phases.every(({resources}) => resources.length > 0), true);
  assert.equal(first.phases.flatMap(({resources}) => resources).every(
    ({digest}) => /^sha256:[a-f0-9]{64}$/.test(digest),
  ), true);
  assert.equal(serializeCanonicalTargetBundle(first).digest, serializeCanonicalTargetBundle(second).digest);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("secretValue"), false);
  assert.equal(serialized.includes(config.cloudflare.postgresqlOrigin.ref), true);
});

test("keeps provider IDs unresolved until authoritative observation", async () => {
  const bundle = await renderCloudflareBundle({config, release});
  const prerequisite = bundle.phases[0].resources.find(
    ({logicalId}) => logicalId === "cloudflare/terraform/private-prerequisites",
  );
  assert.equal(prerequisite.desired.activateIngress, false);
  assert.equal(prerequisite.desired.hyperdriveCachingDisabled, true);
  assert.equal(prerequisite.desired.hyperdriveOriginSslmode, "verify-full");
  assert.deepEqual(prerequisite.desired.costControls, config.cloudflare.costControls);
  assert.deepEqual(
    prerequisite.desired.releaseStoreReference,
    config.cloudflare.releaseStore,
  );
  assert.deepEqual(bundle.unresolvedProviderInputs, [
    "hyperdrive-id",
    "r2-bucket-observations",
    "queue-ids",
    "application-zone-id",
    "content-zone-id",
    "route-or-custom-domain-selection",
  ]);
  assert.equal(JSON.stringify(bundle).includes("hyperdrive_id"), false);
});

test("rejects incomplete Cloudflare release artifacts", async () => {
  await assert.rejects(
    renderCloudflareBundle({config, release: {...release, artifacts: release.artifacts.slice(0, 2)}}),
    /missing required artifacts/,
  );
});
