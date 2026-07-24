import assert from "node:assert/strict";
import test from "node:test";

import {sha256Digest} from "../automation/canonical.mjs";
import {
  createCloudflareVerifierWorkerLifecycle,
} from "./verifier-worker-lifecycle.mjs";

const bindings = [
  {name: "APP_RELEASE_VERIFICATION", type: "service", service: "shareslices-app"},
  {name: "CONTENT_RELEASE_VERIFICATION", type: "service", service: "shareslices-content"},
  {name: "JOBS_RELEASE_VERIFICATION", type: "service", service: "shareslices-jobs"},
];
const input = {
  name: "shareslices-verify-aaaaaaaaaaaa-7",
  configPath: "/tmp/shareslices-verifier/wrangler.json",
  bindingsDigest: sha256Digest(bindings),
  releaseId: `sha256:${"a".repeat(64)}`,
  fence: 7,
};

function observed(exists = true) {
  return {
    name: input.name,
    exists,
    workersDevEnabled: false,
    previewUrlsEnabled: false,
    bindings,
    routes: [],
    customDomains: [],
    schedules: [],
    observedAt: "2026-07-24T00:00:00Z",
  };
}

test("deploys with pinned config and proves the Worker has no public trigger", async () => {
  const calls = [];
  const lifecycle = createCloudflareVerifierWorkerLifecycle({
    runCommand: (executable, arguments_) => {
      calls.push({executable, arguments_});
      return {status: 0, stdout: "deployed", stderr: ""};
    },
    observeWorker: async () => observed(),
  });
  assert.deepEqual(await lifecycle.deploy(input), {
    workerName: input.name,
    routeFree: true,
    workersDevEnabled: false,
    previewUrlsEnabled: false,
    bindingsDigest: input.bindingsDigest,
    observedAt: "2026-07-24T00:00:00Z",
  });
  assert.deepEqual(calls[0].arguments_.slice(0, 4), [
    "deploy",
    "--config",
    input.configPath,
    "--strict",
  ]);
  assert.equal(calls[0].arguments_.includes("--message"), true);
});

test("refuses a Worker with workers.dev, Preview, route, domain, Cron, or binding drift", async () => {
  for (const drift of [
    {workersDevEnabled: true},
    {previewUrlsEnabled: true},
    {routes: [{pattern: "example.test/*"}]},
    {customDomains: [{hostname: "example.test"}]},
    {schedules: [{cron: "* * * * *"}]},
    {bindings: bindings.slice(1)},
  ]) {
    const lifecycle = createCloudflareVerifierWorkerLifecycle({
      runCommand: () => ({status: 0, stdout: "", stderr: ""}),
      observeWorker: async () => ({...observed(), ...drift}),
    });
    await assert.rejects(lifecycle.deploy(input), /identity_unproven/);
  }
});

test("deletes only an exactly re-observed route-free Worker and confirms absence", async () => {
  const calls = [];
  let observations = 0;
  const lifecycle = createCloudflareVerifierWorkerLifecycle({
    runCommand: (_executable, arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "", stderr: ""};
    },
    observeWorker: async () => {
      observations += 1;
      return observations === 1 ? observed() : observed(false);
    },
  });
  const deployed = {
    workerName: input.name,
    routeFree: true,
    workersDevEnabled: false,
    previewUrlsEnabled: false,
    bindingsDigest: input.bindingsDigest,
  };
  assert.deepEqual(await lifecycle.delete(deployed), {
    workerName: input.name,
    exists: false,
    observedAt: "2026-07-24T00:00:00Z",
  });
  assert.deepEqual(calls, [["delete", input.name, "--force"]]);
});

test("never deletes after ownership drift or an ambiguous provider result", async () => {
  const calls = [];
  const lifecycle = createCloudflareVerifierWorkerLifecycle({
    runCommand: (...arguments_) => {
      calls.push(arguments_);
      return {status: 0, stdout: "", stderr: ""};
    },
    observeWorker: async () => ({...observed(), routes: [{pattern: "example.test/*"}]}),
  });
  await assert.rejects(
    lifecycle.delete({
      workerName: input.name,
      routeFree: true,
      workersDevEnabled: false,
      previewUrlsEnabled: false,
      bindingsDigest: input.bindingsDigest,
    }),
    /identity_unproven/,
  );
  assert.equal(calls.length, 0);
});
