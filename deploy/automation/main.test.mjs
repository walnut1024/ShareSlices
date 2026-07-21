import assert from "node:assert/strict";
import test from "node:test";

import {exitCodes} from "./cli.mjs";
import {createProductionExecutor, main} from "./main.mjs";
import {lifecycleOperations} from "./target-adapter.mjs";

function adapter(overrides = {}) {
  return Object.fromEntries(lifecycleOperations.map((operation) => [
    operation,
    overrides[operation] ?? (async () => ({})),
  ]));
}

test("production entrypoint registers Kubernetes and emits one machine-readable result", async () => {
  const output = [];
  const execute = createProductionExecutor({
    kubernetesAdapter: adapter({
      doctor: async () => ({checks: [{id: "cluster", state: "available"}]}),
    }),
  });
  const exitCode = await main(
    ["doctor", "--config", "deploy/contract/fixtures/deployment.kubernetes.valid.json"],
    {write: (value) => output.push(value)},
    execute,
  );
  assert.equal(exitCode, exitCodes.succeeded);
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]);
  assert.equal(result.command, "doctor");
  assert.equal(result.target, "kubernetes");
  assert.equal(result.outcome, "succeeded");
});

test("production entrypoint fails closed for a target whose Adapter is not registered", async () => {
  const output = [];
  const exitCode = await main(
    ["doctor", "--config", "deploy/contract/fixtures/deployment.cloudflare.valid.json"],
    {write: (value) => output.push(value)},
    createProductionExecutor({kubernetesAdapter: adapter()}),
  );
  assert.equal(exitCode, exitCodes.prerequisiteUnavailable);
  const result = JSON.parse(output[0]);
  assert.equal(result.reason.code, "deployment_target_adapter_unavailable");
  assert.equal(result.target, "cloudflare");
});
