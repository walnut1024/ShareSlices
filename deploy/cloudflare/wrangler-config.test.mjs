import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  cloudflareWorkerFirstPatterns,
  generateStagedWorkerConfigs,
  writeStagedWorkerConfigs,
} from "./wrangler-config.mjs";
import { contentBindingContract } from "./content-authority.mjs";

const fixture = new URL(
  "../contract/fixtures/deployment.cloudflare.valid.json",
  import.meta.url,
);
const execute = promisify(execFile);

function prerequisites() {
  return {
    account_id: "0123456789abcdef0123456789abcdef",
    artifact_bucket_name: "shareslices-artifacts",
    deployment_state_bucket_name: "shareslices-deployment-state",
    jobs_queue_id: "queue-jobs-id",
    jobs_queue_name: "shareslices-jobs",
    dead_letter_queue_id: "queue-dlq-id",
    dead_letter_queue_name: "shareslices-jobs-dead-letter",
    hyperdrive_id: "hyperdrive-id",
    hyperdrive_name: "shareslices-postgresql",
    hyperdrive_caching_disabled: true,
    hyperdrive_origin_sslmode: "verify-full",
    hyperdrive_connection_limit: 20,
  };
}

function containerImages() {
  return {
    trustedProcessing: {
      reference:
        "registry.cloudflare.com/0123456789abcdef0123456789abcdef/shareslices-processing:release-aaaaaaaa",
      contentDigest: `sha256:${"a".repeat(64)}`,
      buildIdentity: "build-aaaaaaaaaaaaaaaa",
    },
    thumbnail: {
      reference:
        "registry.cloudflare.com/0123456789abcdef0123456789abcdef/shareslices-thumbnail:release-bbbbbbbb",
      contentDigest: `sha256:${"b".repeat(64)}`,
      buildIdentity: "build-bbbbbbbbbbbbbbbb",
    },
  };
}

async function generated() {
  const config = JSON.parse(await readFile(fixture, "utf8"));
  return generateStagedWorkerConfigs({
    config,
    privatePrerequisites: prerequisites(),
    containerImages: containerImages(),
    releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    jobsContractRevision: "gallery-job/v1",
    configDirectory: "/release/cloudflare",
    workerDirectory: "/release/workers",
    staticAssetsDirectory: "/release/static-assets",
  });
}

test("generates schema-valid staged App, Content, and immediate Jobs Wrangler inputs", async () => {
  const first = await generated();
  const second = await generated();
  assert.deepEqual(second, first);
  assert.match(first.contentDigest, /^sha256:[a-f0-9]{64}$/);
  for (const config of Object.values(first.configs)) {
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.hyperdrive, [
      { binding: "HYPERDRIVE", id: "hyperdrive-id" },
    ]);
    assert.equal("routes" in config, false);
    assert.equal("triggers" in config, false);
  }
  for (const config of [first.configs.app, first.configs.content]) {
    assert.deepEqual(config.r2_buckets, [
      { binding: "ARTIFACTS", bucket_name: "shareslices-artifacts" },
    ]);
  }
  assert.equal("r2_buckets" in first.configs.jobs, false);
  assert.deepEqual(first.configs.app.limits, {cpu_ms: 30_000});
  assert.deepEqual(first.configs.content.limits, {cpu_ms: 30_000});
  assert.deepEqual(first.configs.jobs.limits, {cpu_ms: 30_000});
  assert.deepEqual(
    first.configs.app.assets.run_worker_first,
    cloudflareWorkerFirstPatterns,
  );
  const routeProjection = JSON.parse(
    await readFile(
      new URL("../contract/route-projection.json", import.meta.url),
      "utf8",
    ),
  );
  const dynamicPrefixes = [
    ...new Set(
      routeProjection.rows
        .filter(({ id }) => id !== "web-static-assets")
        .map(({ pathPattern }) => `/${pathPattern.split("/")[1]}`),
    ),
  ].sort();
  const configuredPrefixes = [
    ...new Set(
      cloudflareWorkerFirstPatterns.map((pattern) =>
        pattern.replace(/\/\*$/, ""),
      ),
    ),
  ].sort();
  assert.deepEqual(
    configuredPrefixes,
    dynamicPrefixes,
  );
  assert.equal(first.configs.app.assets.binding, "ASSETS");
  assert.equal(
    first.configs.app.vars.BETTER_AUTH_URL,
    "https://app.example.test",
  );
  assert.equal(first.configs.content.assets, undefined);
  assert.deepEqual(first.secretBindings.content, []);
  assert.deepEqual(
    Object.keys(first.configs.content.vars).sort(),
    [
      "API_ORIGIN",
      "DEPLOYMENT_ENVIRONMENT",
      "GALLERY_ADMINISTRATOR_AUTHORITY_READY",
      "GALLERY_APPEAL_POLICY_REVISION",
      "GALLERY_APPEAL_READY",
      "GALLERY_CHALLENGE_VERIFIER_READY",
      "GALLERY_CONTENT_ORIGIN",
      "GALLERY_CONTENT_REGISTRABLE_SITE",
      "GALLERY_ENABLED",
      "GALLERY_GOVERNANCE_READY",
      "GALLERY_GRANT_REVISION",
      "GALLERY_ISOLATED_CONTENT_READY",
      "GALLERY_MANAGEMENT_COOKIE_DOMAIN",
      "GALLERY_NETWORK_POLICY",
      "GALLERY_NOTIFICATION_READY",
      "GALLERY_REPORTING_READY",
      "SERVICE_VERSION",
      "WEB_ORIGIN",
    ],
  );
  const generatedContentBindings = [
    ...first.configs.content.hyperdrive.map(({ binding: name }) => ({
      name,
      type: "hyperdrive",
    })),
    ...first.configs.content.r2_buckets.map(({ binding: name }) => ({
      name,
      type: "r2_bucket",
    })),
    ...Object.keys(first.configs.content.vars).map((name) => ({
      name,
      type: "plain_text",
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    generatedContentBindings,
    [...contentBindingContract].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  );
  assert.equal(first.secretBindings.app.includes("RESEND_API_KEY"), false);
  assert.deepEqual(first.secretBindings.jobs, [
    "AUTH_EMAIL_ENCRYPTION_KEY",
    "RESEND_API_KEY",
  ]);
  assert.equal("triggers" in first.configs.jobs, false);
  assert.deepEqual(first.configs.jobs.queues, {
    producers: [{binding: "JOB_WAKE_QUEUE", queue: "shareslices-jobs"}],
  });
  assert.deepEqual(
    first.configs.jobs.containers.map(({class_name, max_instances, ssh}) => ({
      class_name,
      max_instances,
      ssh,
    })),
    [
      {
        class_name: "TrustedProcessingContainer",
        max_instances: 2,
        ssh: {enabled: false},
      },
      {
        class_name: "ThumbnailContainer",
        max_instances: 1,
        ssh: {enabled: false},
      },
    ],
  );
  for (const container of first.configs.jobs.containers) {
    assert.equal("authorized_keys" in container, false);
    assert.equal("ports" in container, false);
    assert.deepEqual(Object.keys(container).sort(), [
      "class_name",
      "image",
      "instance_type",
      "max_instances",
      "name",
      "ssh",
    ]);
  }
  assert.deepEqual(first.configs.jobs.exports, {
    TrustedProcessingContainer: {type: "durable-object", storage: "sqlite"},
    ThumbnailContainer: {type: "durable-object", storage: "sqlite"},
  });
  assert.deepEqual(first.containerImages, containerImages());
  assert.equal("migrations" in first.configs.jobs, false);
  assert.equal(first.configs.jobs.vars.TRUSTED_PROCESSING_RUNNER_SLOTS, "2");
  assert.deepEqual(
    JSON.parse(first.configs.jobs.vars.TRUSTED_PROCESSING_STABLE_SLOTS),
    [
      "example-cloudflare-processing-slot-1",
      "example-cloudflare-processing-slot-2",
    ],
  );
  assert.equal(
    first.configs.jobs.vars.TRUSTED_PROCESSING_OPERATOR_SAFETY_CAP_INSTANCES,
    "2",
  );
  assert.equal(
    first.configs.jobs.vars.TRUSTED_PROCESSING_MAXIMUM_CLAIMS_PER_DRAIN,
    "8",
  );
  assert.equal(first.configs.jobs.vars.THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS, "300");
  assert.equal(first.configs.jobs.vars.TRUSTED_PROCESSING_SLEEP_AFTER_SECONDS, "660");
  assert.equal(first.configs.jobs.vars.THUMBNAIL_SLEEP_AFTER_SECONDS, "360");
  assert.equal(
    first.configs.jobs.vars.CONTAINER_RELEASE_ID,
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(first.configs.jobs.vars.CONTAINER_CONTRACT_REVISION, "gallery-job/v1");
  assert.equal(
    first.configs.app.vars.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
    "3",
  );
  assert.equal(
    first.configs.app.vars.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
    "5",
  );
  assert.equal(first.configs.app.vars.EDGE_CDN_MODE, "web-assets-only");
  assert.equal(
    first.configs.app.vars.VIEWER_BYTE_CACHE_MAX_ASSET_BYTES,
    5_242_880,
  );
});

test("rejects a Container idle timeout that can interrupt its bounded drain", async () => {
  const config = JSON.parse(await readFile(fixture, "utf8"));
  config.cloudflare.costControls.containers.trustedProcessing.sleepAfterSeconds =
    config.cloudflare.costControls.containers.trustedProcessing.maximumWallTimeSeconds;
  await assert.rejects(
    generateStagedWorkerConfigs({
      config,
      privatePrerequisites: prerequisites(),
      containerImages: containerImages(),
      releaseId:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      jobsContractRevision: "gallery-job/v1",
      configDirectory: "/release/cloudflare",
      workerDirectory: "/release/workers",
      staticAssetsDirectory: "/release/static-assets",
    }),
    /cloudflare_trustedProcessing_sleep_after_must_exceed_maximum_wall_time/,
  );
});

test("rejects drifted or unsafe Terraform prerequisite outputs", async () => {
  const config = JSON.parse(await readFile(fixture, "utf8"));
  await assert.rejects(
    generateStagedWorkerConfigs({
      config,
      privatePrerequisites: {
        ...prerequisites(),
        hyperdrive_caching_disabled: false,
      },
      containerImages: containerImages(),
      releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      jobsContractRevision: "gallery-job/v1",
      configDirectory: "/release/cloudflare",
      workerDirectory: "/release/workers",
      staticAssetsDirectory: "/release/static-assets",
    }),
    /cloudflare_private_prerequisites_mismatch/,
  );
});

test("writes complete staged configs outside the deployable Static Assets tree", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-wrangler-config-"));
  const workers = resolve(root, "workers");
  const assets = resolve(root, "static-assets");
  const output = resolve(root, "cloudflare");
  try {
    await Promise.all([mkdir(workers), mkdir(assets)]);
    const workerSource =
      "export default { fetch() { return new Response('ok'); } };\n";
    await Promise.all([
      writeFile(resolve(workers, "app-worker.js"), workerSource),
      writeFile(resolve(workers, "content-worker.js"), workerSource),
      writeFile(
        resolve(workers, "jobs-worker.js"),
        `${workerSource} export class TrustedProcessingContainer {} export class ThumbnailContainer {}\n`,
      ),
      writeFile(resolve(assets, "index.html"), "<!doctype html>\n"),
    ]);
    const config = JSON.parse(await readFile(fixture, "utf8"));
    const generated = await writeStagedWorkerConfigs({
      config,
      privatePrerequisites: prerequisites(),
      containerImages: containerImages(),
      releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      jobsContractRevision: "gallery-job/v1",
      configDirectory: output,
      workerDirectory: workers,
      staticAssetsDirectory: assets,
    });
    assert.deepEqual(
      JSON.parse(await readFile(resolve(output, "app.wrangler.json"), "utf8")),
      generated.configs.app,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(resolve(output, "content.wrangler.json"), "utf8"),
      ),
      generated.configs.content,
    );
    const manifest = JSON.parse(
      await readFile(resolve(output, "staged-workers-manifest.json"), "utf8"),
    );
    assert.equal(manifest.contentDigest, generated.contentDigest);
    assert.deepEqual(manifest.containerImages, containerImages());
    for (const name of ["app", "content", "jobs"]) {
      await execute(
        resolve("node_modules/.bin/wrangler"),
        [
          "deploy",
          "--dry-run",
          "--config",
          resolve(output, `${name}.wrangler.json`),
          "--outdir",
          resolve(root, `${name}-dry-run`),
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
    }
    await assert.rejects(
      writeStagedWorkerConfigs({
        config,
        privatePrerequisites: prerequisites(),
        containerImages: containerImages(),
        releaseId: generated.configs.app.vars.SERVICE_VERSION,
        jobsContractRevision: "gallery-job/v1",
        configDirectory: output,
        workerDirectory: workers,
        staticAssetsDirectory: assets,
      }),
      /cloudflare_wrangler_output_not_empty/,
    );
    await assert.rejects(
      writeStagedWorkerConfigs({
        config,
        privatePrerequisites: prerequisites(),
        containerImages: containerImages(),
        releaseId: generated.configs.app.vars.SERVICE_VERSION,
        jobsContractRevision: "gallery-job/v1",
        configDirectory: resolve(assets, "private-config"),
        workerDirectory: workers,
        staticAssetsDirectory: assets,
      }),
      /cloudflare_private_release_input_inside_static_assets/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
