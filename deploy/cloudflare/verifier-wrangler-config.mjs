import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import Ajv from "ajv";

const baseline = JSON.parse(await readFile(
  new URL("./toolchain-baseline.json", import.meta.url),
  "utf8",
));
const wranglerSchema = JSON.parse(await readFile(
  new URL("../../node_modules/wrangler/config-schema.json", import.meta.url),
  "utf8",
));

function requireName(name, value) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)
  ) {
    throw new Error(`cloudflare_release_verifier_${name}_invalid`);
  }
  return value;
}

export function releaseVerifierResourceNames({
  installationId,
  releaseId,
  fence,
}) {
  const installation = requireName("installation_id", installationId);
  if (!/^sha256:[a-f0-9]{64}$/.test(releaseId)) {
    throw new Error("cloudflare_release_verifier_release_id_invalid");
  }
  if (!Number.isSafeInteger(fence) || fence <= 0) {
    throw new Error("cloudflare_release_verifier_fence_invalid");
  }
  const token = releaseId.slice("sha256:".length, "sha256:".length + 12);
  const suffix = `${token}-${fence}`;
  return Object.freeze({
    worker: requireName("worker_name", `${installation}-verify-${suffix}`),
    queue: requireName("queue_name", `${installation}-verify-${suffix}`),
    deadLetterQueue: requireName(
      "dead_letter_queue_name",
      `${installation}-verify-dlq-${suffix}`,
    ),
  });
}

export function generateReleaseVerifierWranglerConfig(input) {
  const names = releaseVerifierResourceNames(input);
  const accountId = input.accountId;
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error("cloudflare_release_verifier_account_invalid");
  }
  const main = input.main;
  if (typeof main !== "string" || main.length === 0) {
    throw new Error("cloudflare_release_verifier_main_invalid");
  }
  const appService = requireName("app_service", input.appService);
  const contentService = requireName("content_service", input.contentService);
  const jobsService = requireName("jobs_service", input.jobsService);
  if (new Set([appService, contentService, jobsService]).size !== 3) {
    throw new Error("cloudflare_release_verifier_service_aliasing");
  }
  const config = {
    name: names.worker,
    main,
    account_id: accountId,
    compatibility_date: baseline.workersRuntime.compatibilityDate,
    compatibility_flags: baseline.workersRuntime.compatibilityFlags,
    workers_dev: false,
    preview_urls: false,
    limits: {cpu_ms: 30_000},
    observability: {
      enabled: true,
      logs: {enabled: true, invocation_logs: true},
      traces: {enabled: true, head_sampling_rate: 1},
    },
    queues: {
      consumers: [{
        queue: names.queue,
        max_batch_size: 1,
        max_batch_timeout: 1,
        max_retries: 3,
        dead_letter_queue: names.deadLetterQueue,
        max_concurrency: 1,
        retry_delay: 30,
      }],
    },
    services: [
      {binding: "APP_RELEASE_VERIFICATION", service: appService},
      {binding: "CONTENT_RELEASE_VERIFICATION", service: contentService},
      {binding: "JOBS_RELEASE_VERIFICATION", service: jobsService},
    ],
    vars: {
      VERIFIER_QUEUE_NAME: names.queue,
      VERIFIER_RELEASE_ID: input.releaseId,
      VERIFIER_FENCE: String(input.fence),
    },
  };
  const validate = new Ajv({allErrors: true, strict: false}).compile(
    wranglerSchema,
  );
  if (!validate(config)) {
    throw new Error("cloudflare_release_verifier_wrangler_schema_invalid");
  }
  return Object.freeze({names, config});
}

async function main() {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(
    `${JSON.stringify(generateReleaseVerifierWranglerConfig(input), null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(
    `file://${process.argv[1]}`,
  ))
) {
  await main();
}
