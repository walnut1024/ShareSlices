import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import test from "node:test";

import {
  generateReleaseVerifierWranglerConfig,
  releaseVerifierResourceNames,
} from "./verifier-wrangler-config.mjs";

const execute = promisify(execFile);
const input = {
  installationId: "example",
  releaseId: `sha256:${"a".repeat(64)}`,
  fence: 7,
  accountId: "0123456789abcdef0123456789abcdef",
  main: "./release-verifier-worker.js",
  appService: "example-app",
  contentService: "example-content",
  jobsService: "example-jobs",
};

test("generates one route-free, trigger-isolated verifier with explicit bindings", async () => {
  const generated = generateReleaseVerifierWranglerConfig(input);
  assert.deepEqual(generated.names, {
    worker: "example-verify-aaaaaaaaaaaa-7",
    queue: "example-verify-aaaaaaaaaaaa-7",
    deadLetterQueue: "example-verify-dlq-aaaaaaaaaaaa-7",
  });
  assert.equal(generated.config.workers_dev, false);
  assert.equal(generated.config.preview_urls, false);
  assert.equal("routes" in generated.config, false);
  assert.equal("triggers" in generated.config, false);
  assert.equal(generated.config.queues, undefined);
  assert.deepEqual(generated.config.services, [
    {binding: "APP_RELEASE_VERIFICATION", service: "example-app"},
    {binding: "CONTENT_RELEASE_VERIFICATION", service: "example-content"},
    {binding: "JOBS_RELEASE_VERIFICATION", service: "example-jobs"},
  ]);

  const root = await mkdtemp(resolve(tmpdir(), "shareslices-verifier-config-"));
  try {
    await writeFile(
      resolve(root, "release-verifier-worker.js"),
      "export default { queue() {} };\n",
    );
    await writeFile(
      resolve(root, "wrangler.json"),
      `${JSON.stringify({
        ...generated.config,
        main: "./release-verifier-worker.js",
      })}\n`,
    );
    await execute(
      resolve("node_modules/.bin/wrangler"),
      [
        "deploy",
        "--dry-run",
        "--config",
        resolve(root, "wrangler.json"),
        "--outdir",
        resolve(root, "dry-run"),
      ],
      {maxBuffer: 16 * 1024 * 1024},
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("derives release/fence-owned names and rejects aliasing or unsafe identity", () => {
  assert.deepEqual(
    releaseVerifierResourceNames({
      installationId: "install",
      releaseId: `sha256:${"b".repeat(64)}`,
      fence: 11,
    }),
    {
      worker: "install-verify-bbbbbbbbbbbb-11",
      queue: "install-verify-bbbbbbbbbbbb-11",
      deadLetterQueue: "install-verify-dlq-bbbbbbbbbbbb-11",
    },
  );
  assert.throws(
    () => generateReleaseVerifierWranglerConfig({
      ...input,
      jobsService: input.appService,
    }),
    /cloudflare_release_verifier_service_aliasing/,
  );
  assert.throws(
    () => generateReleaseVerifierWranglerConfig({...input, fence: 0}),
    /cloudflare_release_verifier_fence_invalid/,
  );
});
