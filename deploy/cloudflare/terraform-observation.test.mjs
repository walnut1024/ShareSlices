import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {renderCloudflareBundle} from "./render.mjs";
import {createCloudflareTerraformObserver} from "./terraform-observation.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));
const releaseFixture = JSON.parse(await readFile(
  new URL("../contract/fixtures/release.valid.json", import.meta.url),
  "utf8",
));
const release = {
  ...releaseFixture,
  artifacts: [
    ["app-worker-bundle", "worker-bundle"],
    ["content-worker-bundle", "worker-bundle"],
    ["jobs-worker-bundle", "worker-bundle"],
    ["static-assets", "static-assets"],
    ["trusted-processing-image", "oci-image"],
    ["thumbnail-image", "oci-image"],
  ].map(([name, artifactKind], index) => {
    const contentDigest = `sha256:${String(index + 1).repeat(64)}`;
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
const bundle = await renderCloudflareBundle({config, release});

function outputs(overrides = {}) {
  return {
    private_prerequisites: {
      sensitive: false,
      value: {
        account_id: config.cloudflare.accountId,
        artifact_bucket_name: config.cloudflare.r2.artifactBucket,
        deployment_state_bucket_name: config.cloudflare.r2.deploymentStateBucket,
        jobs_queue_id: "jobs-id",
        jobs_queue_name: config.cloudflare.queues.jobs,
        dead_letter_queue_id: "dead-letter-id",
        dead_letter_queue_name: config.cloudflare.queues.deadLetter,
        hyperdrive_id: "hyperdrive-id",
        hyperdrive_name: `${config.installationId}-application`,
        hyperdrive_caching_disabled: true,
        hyperdrive_origin_sslmode: "verify-full",
        hyperdrive_connection_limit: 20,
        ...overrides,
      },
    },
    activation: {
      sensitive: false,
      value: {enabled: false, custom_domains: {}, worker_routes: {}},
    },
  };
}

test("projects only bundle-matching structured Terraform state", async () => {
  const observer = createCloudflareTerraformObserver({
    readState: async () => ({
      lineage: "lineage-1",
      serial: 7,
      outputs: outputs(),
    }),
  });
  const result = await observer({config, release, bundle});
  assert.equal(result.revision, "lineage-1:7");
  assert.deepEqual(result.activation, {
    enabled: false,
    customDomainCount: 0,
    workerRouteCount: 0,
  });
  assert.equal(result.resources.length, 1);
  assert.equal(
    result.resources[0].logicalId,
    "cloudflare/terraform/private-prerequisites",
  );
  assert.equal(result.resources[0].digest, bundle.phases[0].resources[0].digest);
  assert.deepEqual(result.resources[0].providerIdentity, {
    lineage: "lineage-1",
    serial: 7,
    queueIds: ["jobs-id", "dead-letter-id"],
    hyperdriveId: "hyperdrive-id",
  });
});

test("rejects sensitive output, stale inputs, malformed activation, and missing state identity", async () => {
  for (const [state, code] of [
    [
      {lineage: "", serial: 1, outputs: outputs()},
      "cloudflare_terraform_state_invalid",
    ],
    [
      {
        lineage: "lineage",
        serial: 1,
        outputs: {
          ...outputs(),
          private_prerequisites: {
            ...outputs().private_prerequisites,
            sensitive: true,
          },
        },
      },
      "cloudflare_terraform_output_invalid",
    ],
    [
      {
        lineage: "lineage",
        serial: 1,
        outputs: outputs({artifact_bucket_name: "wrong"}),
      },
      "cloudflare_terraform_prerequisite_drift",
    ],
    [
      {
        lineage: "lineage",
        serial: 1,
        outputs: {
          ...outputs(),
          activation: {sensitive: false, value: {enabled: false}},
        },
      },
      "cloudflare_terraform_activation_invalid",
    ],
  ]) {
    const observer = createCloudflareTerraformObserver({
      readState: async () => state,
    });
    await assert.rejects(
      observer({config, release, bundle}),
      (error) => error.code === code,
    );
  }
});
