import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { getDomain } from "tldts";

import { sha256Digest } from "../automation/canonical.mjs";
import { sharedRuntimeVariables } from "../automation/runtime-vars.mjs";

const baselinePath = new URL("./toolchain-baseline.json", import.meta.url);
const ownershipPath = new URL("./ownership.json", import.meta.url);
const wranglerSchemaPath = fileURLToPath(
  new URL("../../node_modules/wrangler/config-schema.json", import.meta.url),
);

const appSecretBindings = Object.freeze([
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "AUTH_EMAIL_ENCRYPTION_KEY",
  "CONTENT_FINGERPRINT_KEY_CURRENT",
  "CONTENT_FINGERPRINT_KEY_PREVIOUS",
  "IDEMPOTENCY_ENCRYPTION_KEY_CURRENT",
  "IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS",
  "GALLERY_TURNSTILE_SECRET",
]);

const workerFirstPrefixes = Object.freeze([
  "/a",
  "/api",
  "/gallery",
  "/gallery-content",
  "/health",
  "/internal",
  "/ready",
  "/runtime-config.json",
]);

function slashPath(from, to) {
  const value = relative(from, to).split(sep).join("/");
  return value.startsWith(".") ? value : `./${value}`;
}

function isWithin(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function requirePrivatePrerequisites(config, prerequisites) {
  const required = [
    "account_id",
    "artifact_bucket_name",
    "deployment_state_bucket_name",
    "jobs_queue_id",
    "jobs_queue_name",
    "dead_letter_queue_id",
    "dead_letter_queue_name",
    "hyperdrive_id",
    "hyperdrive_name",
    "hyperdrive_caching_disabled",
    "hyperdrive_origin_sslmode",
    "hyperdrive_connection_limit",
  ];
  if (
    !prerequisites ||
    Object.keys(prerequisites).sort().join("\n") !== required.sort().join("\n")
  ) {
    throw new Error("cloudflare_private_prerequisites_invalid");
  }
  if (
    prerequisites.account_id !== config.cloudflare.accountId ||
    prerequisites.artifact_bucket_name !== config.cloudflare.r2.artifactBucket ||
    prerequisites.jobs_queue_name !== config.cloudflare.queues.jobs ||
    prerequisites.dead_letter_queue_name !== config.cloudflare.queues.deadLetter ||
    prerequisites.hyperdrive_caching_disabled !== true ||
    prerequisites.hyperdrive_origin_sslmode !== "verify-full" ||
    !Number.isSafeInteger(prerequisites.hyperdrive_connection_limit) ||
    prerequisites.hyperdrive_connection_limit <= 0
  ) {
    throw new Error("cloudflare_private_prerequisites_mismatch");
  }
}

function requireWranglerOwnership(ownership) {
  const required = new Set([
    "worker.workers-dev",
    "worker.preview-urls",
    "worker.ordinary-bindings",
    "worker.secret-bindings",
  ]);
  for (const field of ownership.fields) {
    if (
      required.has(field.id) &&
      field.owner === "wrangler" &&
      field.status === "selected" &&
      field.activationBlocked === false
    ) {
      required.delete(field.id);
    }
  }
  if (required.size > 0) throw new Error("cloudflare_wrangler_ownership_unqualified");
}

function galleryVars(config, { includeSiteKey = false } = {}) {
  const gallery = config.shared.gallery;
  const contentOrigin = config.shared.publicOrigins.content;
  return {
    GALLERY_ENABLED: gallery.enabled,
    GALLERY_CONTENT_ORIGIN: contentOrigin,
    GALLERY_CONTENT_REGISTRABLE_SITE: getDomain(
      new URL(contentOrigin).hostname,
    ),
    GALLERY_MANAGEMENT_COOKIE_DOMAIN: gallery.managementCookieDomain,
    GALLERY_NETWORK_POLICY: "deny_external",
    GALLERY_GRANT_REVISION: gallery.grantRevision,
    GALLERY_APPEAL_POLICY_REVISION: gallery.appealPolicyRevision,
    GALLERY_CHALLENGE_VERIFIER_READY: gallery.challengeVerifierReady,
    GALLERY_ADMINISTRATOR_AUTHORITY_READY:
      gallery.administratorAuthorityReady,
    GALLERY_REPORTING_READY: gallery.reportingReady,
    GALLERY_NOTIFICATION_READY: gallery.notificationReady,
    GALLERY_APPEAL_READY: gallery.appealReady,
    GALLERY_GOVERNANCE_READY: gallery.governanceReady,
    GALLERY_ISOLATED_CONTENT_READY: gallery.isolatedContentReady,
    ...(includeSiteKey && gallery.turnstileSiteKey
      ? { GALLERY_TURNSTILE_SITE_KEY: gallery.turnstileSiteKey }
      : {}),
  };
}

function commonConfig(config, baseline, name, main, cpuMilliseconds) {
  return {
    name,
    main,
    account_id: config.cloudflare.accountId,
    compatibility_date: baseline.workersRuntime.compatibilityDate,
    compatibility_flags: baseline.workersRuntime.compatibilityFlags,
    workers_dev: false,
    preview_urls: false,
    limits: {
      cpu_ms: cpuMilliseconds,
    },
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: true },
      traces: { enabled: true, head_sampling_rate: 0.01 },
    },
  };
}

function workerFirstPatterns() {
  return workerFirstPrefixes.flatMap((prefix) => [prefix, `${prefix}/*`]);
}

export async function generateStagedWorkerConfigs(input) {
  if (input.config.target !== "cloudflare") {
    throw new Error("cloudflare_target_required");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.releaseId)) {
    throw new Error("cloudflare_release_id_invalid");
  }
  const [baseline, ownership, wranglerSchema] = await Promise.all([
    readFile(baselinePath, "utf8").then(JSON.parse),
    readFile(ownershipPath, "utf8").then(JSON.parse),
    readFile(wranglerSchemaPath, "utf8").then(JSON.parse),
  ]);
  requirePrivatePrerequisites(input.config, input.privatePrerequisites);
  requireWranglerOwnership(ownership);
  const configDirectory = resolve(input.configDirectory);
  const commonVars = {
    WEB_ORIGIN: input.config.shared.publicOrigins.application,
    API_ORIGIN: input.config.shared.publicOrigins.application,
    BETTER_AUTH_URL: input.config.shared.publicOrigins.application,
    VIEWER_ORIGIN: input.config.shared.publicOrigins.application,
    SERVICE_VERSION: input.releaseId,
    DEPLOYMENT_ENVIRONMENT: input.config.installationId,
    ...galleryVars(input.config, { includeSiteKey: true }),
  };
  const revisions = input.config.shared.roleSecrets;
  const runtimeVariables = sharedRuntimeVariables(input.config);
  const app = {
    ...commonConfig(
      input.config,
      baseline,
      input.config.cloudflare.workers.application,
      slashPath(configDirectory, resolve(input.workerDirectory, "app-worker.js")),
      input.config.cloudflare.costControls.workerCpuMilliseconds.application,
    ),
    assets: {
      directory: slashPath(configDirectory, resolve(input.staticAssetsDirectory)),
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: workerFirstPatterns(),
    },
    hyperdrive: [{ binding: "HYPERDRIVE", id: input.privatePrerequisites.hyperdrive_id }],
    r2_buckets: [
      {
        binding: "ARTIFACTS",
        bucket_name: input.privatePrerequisites.artifact_bucket_name,
      },
    ],
    vars: {
      ...commonVars,
      MINIMUM_CLI_VERSION: runtimeVariables.MINIMUM_CLI_VERSION,
      WORKER_JOB_MAX_ATTEMPTS: runtimeVariables.WORKER_JOB_MAX_ATTEMPTS,
      REQUIRE_EMAIL_VERIFICATION:
        runtimeVariables.REQUIRE_EMAIL_VERIFICATION,
      AUTH_EMAIL_RESEND_SECONDS: runtimeVariables.AUTH_EMAIL_RESEND_SECONDS,
      AUTH_EMAIL_PER_EMAIL_HOUR: runtimeVariables.AUTH_EMAIL_PER_EMAIL_HOUR,
      AUTH_EMAIL_PER_EMAIL_DAY: runtimeVariables.AUTH_EMAIL_PER_EMAIL_DAY,
      AUTH_EMAIL_PER_IP_HOUR: runtimeVariables.AUTH_EMAIL_PER_IP_HOUR,
      AUTH_EMAIL_PER_IP_DAY: runtimeVariables.AUTH_EMAIL_PER_IP_DAY,
      AUTH_EMAIL_GLOBAL_HOUR: runtimeVariables.AUTH_EMAIL_GLOBAL_HOUR,
      AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS:
        runtimeVariables.AUTH_EMAIL_CIRCUIT_BREAKER_SECONDS,
      CONTENT_FINGERPRINT_KEY_CURRENT_REVISION:
        runtimeVariables.CONTENT_FINGERPRINT_KEY_CURRENT_REVISION,
      CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION:
        runtimeVariables.CONTENT_FINGERPRINT_KEY_PREVIOUS_REVISION,
      IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION:
        runtimeVariables.IDEMPOTENCY_ENCRYPTION_KEY_CURRENT_REVISION,
      IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION:
        runtimeVariables.IDEMPOTENCY_ENCRYPTION_KEY_PREVIOUS_REVISION,
      CONTENT_IDENTITY_REVISION: runtimeVariables.CONTENT_IDENTITY_REVISION,
      ARTIFACT_PROCESSING_REVISION:
        runtimeVariables.ARTIFACT_PROCESSING_REVISION,
      ARTIFACT_RENDERER_REVISION:
        runtimeVariables.ARTIFACT_RENDERER_REVISION,
      EDGE_CDN_MODE: input.config.cloudflare.edgeCdn.mode,
      VIEWER_BYTE_CACHE_MAX_ASSET_BYTES:
        input.config.cloudflare.edgeCdn.maximumViewerAssetBytes,
    },
  };
  const content = {
    ...commonConfig(
      input.config,
      baseline,
      input.config.cloudflare.workers.content,
      slashPath(configDirectory, resolve(input.workerDirectory, "content-worker.js")),
      input.config.cloudflare.costControls.workerCpuMilliseconds.content,
    ),
    hyperdrive: [{ binding: "HYPERDRIVE", id: input.privatePrerequisites.hyperdrive_id }],
    r2_buckets: [
      {
        binding: "ARTIFACTS",
        bucket_name: input.privatePrerequisites.artifact_bucket_name,
      },
    ],
    vars: {
      WEB_ORIGIN: input.config.shared.publicOrigins.application,
      API_ORIGIN: input.config.shared.publicOrigins.application,
      SERVICE_VERSION: input.releaseId,
      DEPLOYMENT_ENVIRONMENT: input.config.installationId,
      ...galleryVars(input.config),
    },
  };
  const validate = new Ajv({ allErrors: true, strict: false }).compile(
    wranglerSchema,
  );
  for (const generated of [app, content]) {
    if (!validate(generated)) {
      throw new Error("cloudflare_generated_wrangler_config_invalid");
    }
  }
  const result = {
    schemaVersion: "shareslices.cloudflare-staged-workers/v1",
    configs: { app, content },
    secretBindings: {
      app: appSecretBindings.filter((name) =>
        name.includes("PREVIOUS")
          ? Boolean(
              name.startsWith("CONTENT_")
                ? revisions.contentFingerprint.previous
                : revisions.idempotencyEncryption.previous,
            )
          : name !== "GALLERY_TURNSTILE_SECRET" ||
            Boolean(input.config.shared.roleSecrets.galleryTurnstile),
      ),
      content: [],
    },
    ownershipDigest: sha256Digest(ownership),
    configurationSchemaSha256: baseline.wrangler.configurationSchemaSha256,
  };
  return { ...result, contentDigest: sha256Digest(result) };
}

export const cloudflareWorkerFirstPatterns = workerFirstPatterns();

export async function writeStagedWorkerConfigs(input) {
  const configDirectory = resolve(input.configDirectory);
  if (
    isWithin(input.staticAssetsDirectory, configDirectory) ||
    isWithin(input.staticAssetsDirectory, input.workerDirectory)
  ) {
    throw new Error("cloudflare_private_release_input_inside_static_assets");
  }
  await mkdir(configDirectory, { recursive: true });
  if ((await readdir(configDirectory)).length > 0) {
    throw new Error("cloudflare_wrangler_output_not_empty");
  }
  await Promise.all([
    access(resolve(input.workerDirectory, "app-worker.js")),
    access(resolve(input.workerDirectory, "content-worker.js")),
    access(resolve(input.staticAssetsDirectory)),
  ]);
  const generated = await generateStagedWorkerConfigs(input);
  await Promise.all([
    writeFile(
      resolve(configDirectory, "app.wrangler.json"),
      `${JSON.stringify(generated.configs.app, null, 2)}\n`,
      { flag: "wx" },
    ),
    writeFile(
      resolve(configDirectory, "content.wrangler.json"),
      `${JSON.stringify(generated.configs.content, null, 2)}\n`,
      { flag: "wx" },
    ),
    writeFile(
      resolve(configDirectory, "staged-workers-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: generated.schemaVersion,
          secretBindings: generated.secretBindings,
          ownershipDigest: generated.ownershipDigest,
          configurationSchemaSha256: generated.configurationSchemaSha256,
          contentDigest: generated.contentDigest,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    ),
  ]);
  return generated;
}
