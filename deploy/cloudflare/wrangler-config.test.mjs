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

async function generated() {
  const config = JSON.parse(await readFile(fixture, "utf8"));
  return generateStagedWorkerConfigs({
    config,
    privatePrerequisites: prerequisites(),
    releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    configDirectory: "/release/cloudflare",
    workerDirectory: "/release/workers",
    staticAssetsDirectory: "/release/static-assets",
  });
}

test("generates schema-valid staged App and Content Wrangler inputs", async () => {
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
    assert.deepEqual(config.r2_buckets, [
      { binding: "ARTIFACTS", bucket_name: "shareslices-artifacts" },
    ]);
    assert.equal("routes" in config, false);
    assert.equal("triggers" in config, false);
  }
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
  assert.equal(
    first.configs.app.vars.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
    "3",
  );
  assert.equal(
    first.configs.app.vars.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
    "5",
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
      releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
      writeFile(resolve(assets, "index.html"), "<!doctype html>\n"),
    ]);
    const config = JSON.parse(await readFile(fixture, "utf8"));
    const generated = await writeStagedWorkerConfigs({
      config,
      privatePrerequisites: prerequisites(),
      releaseId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    for (const name of ["app", "content"]) {
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
        releaseId: generated.configs.app.vars.SERVICE_VERSION,
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
        releaseId: generated.configs.app.vars.SERVICE_VERSION,
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
