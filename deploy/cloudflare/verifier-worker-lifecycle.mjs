import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {sha256Digest} from "../automation/canonical.mjs";

const wranglerPath = fileURLToPath(
  new URL("../../node_modules/.bin/wrangler", import.meta.url),
);

function fail(reason) {
  throw new Error(`cloudflare_verifier_worker_${reason}`);
}

function defaultCommand(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

function requireConfig(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.name ?? "") ||
    typeof input.configPath !== "string" ||
    !path.isAbsolute(input.configPath) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.bindingsDigest ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(input.releaseId ?? "") ||
    !Number.isSafeInteger(input.fence) ||
    input.fence <= 0
  ) {
    fail("config_invalid");
  }
  return Object.freeze({
    name: input.name,
    configPath: path.normalize(input.configPath),
    bindingsDigest: input.bindingsDigest,
    releaseId: input.releaseId,
    fence: input.fence,
  });
}

function requireObservedWorker(observed, expected) {
  if (
    !observed ||
    observed.name !== expected.name ||
    observed.exists !== true ||
    observed.workersDevEnabled !== false ||
    observed.previewUrlsEnabled !== false ||
    !Array.isArray(observed.bindings) ||
    !Array.isArray(observed.routes) ||
    observed.routes.length !== 0 ||
    !Array.isArray(observed.customDomains) ||
    observed.customDomains.length !== 0 ||
    !Array.isArray(observed.schedules) ||
    observed.schedules.length !== 0 ||
    sha256Digest(observed.bindings) !== expected.bindingsDigest ||
    typeof observed.observedAt !== "string"
  ) {
    fail("identity_unproven");
  }
  return Object.freeze({
    workerName: observed.name,
    routeFree: true,
    workersDevEnabled: false,
    previewUrlsEnabled: false,
    bindingsDigest: expected.bindingsDigest,
    observedAt: observed.observedAt,
  });
}

export function createCloudflareVerifierWorkerLifecycle({
  runCommand = defaultCommand,
  executable = wranglerPath,
  observeWorker,
} = {}) {
  if (typeof observeWorker !== "function") fail("observer_missing");
  return Object.freeze({
    async deploy(input) {
      const expected = requireConfig(input);
      const result = runCommand(executable, [
        "deploy",
        "--config",
        expected.configPath,
        "--strict",
        "--message",
        `shareslices release verifier ${expected.releaseId} fence ${expected.fence}`,
      ]);
      if (result.status !== 0) fail("deploy_failed");
      return requireObservedWorker(await observeWorker(expected.name), expected);
    },

    async delete(input) {
      if (
        !input ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.workerName ?? "") ||
        input.routeFree !== true ||
        input.workersDevEnabled !== false ||
        input.previewUrlsEnabled !== false ||
        !/^sha256:[a-f0-9]{64}$/.test(input.bindingsDigest ?? "")
      ) {
        fail("deletion_ownership_unproven");
      }
      const before = await observeWorker(input.workerName);
      if (!before?.exists) fail("deletion_ownership_unproven");
      const observed = requireObservedWorker(before, {
        name: input.workerName,
        bindingsDigest: input.bindingsDigest,
      });
      if (observed.workerName !== input.workerName) {
        fail("deletion_ownership_unproven");
      }
      const result = runCommand(executable, [
        "delete",
        input.workerName,
        "--force",
      ]);
      if (result.status !== 0) fail("delete_failed");
      const after = await observeWorker(input.workerName);
      if (
        !after ||
        after.name !== input.workerName ||
        after.exists !== false ||
        typeof after.observedAt !== "string"
      ) {
        fail("delete_unconfirmed");
      }
      return Object.freeze({
        workerName: input.workerName,
        exists: false,
        observedAt: after.observedAt,
      });
    },
  });
}
