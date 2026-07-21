import assert from "node:assert/strict";
import test from "node:test";
import { executeInvocation, exitCodes, main, parseInvocation } from "./cli.mjs";

const lifecycleCommands = [
  "doctor",
  "render",
  "plan",
  "apply",
  "status",
  "verify",
  "rollback",
];

test("accepts exactly the seven production lifecycle commands", () => {
  for (const command of lifecycleCommands) {
    assert.deepEqual(parseInvocation([command, "--config", "deployment.json"]), {
      command,
      options: { config: "deployment.json" },
    });
  }
  assert.equal(parseInvocation(["compose"]).exitCode, exitCodes.invalidInput);
  assert.equal(parseInvocation(["deploy"]).exitCode, exitCodes.invalidInput);
  assert.equal(parseInvocation(["deploy"]).result.command, null);
});

test("rejects malformed, duplicate, and unknown options", () => {
  for (const argv of [
    ["doctor", "deployment.json"],
    ["doctor", "--config"],
    ["doctor", "--unknown", "value"],
    ["doctor", "--config", "one", "--config", "two"],
  ]) {
    const parsed = parseInvocation(argv);
    assert.equal(parsed.exitCode, exitCodes.invalidInput);
    assert.equal(parsed.result.reason.code, "invalid_deployment_arguments");
  }
});

test("emits one stable JSON result and exposes stable exit categories", async () => {
  let output = "";
  const exitCode = await main(
    [
      "plan",
      "--config",
      "deploy/contract/fixtures/deployment.kubernetes.valid.json",
      "--release",
      "release-1",
    ],
    { write: (value) => { output += value; } },
  );
  assert.equal(exitCode, exitCodes.failed);
  assert.deepEqual(JSON.parse(output), {
    schemaVersion: "shareslices.deployment-result/v1",
    command: "plan",
    target: "kubernetes",
    requestedRelease: "release-1",
    outcome: "failed",
    reason: {
      code: "deployment_command_not_implemented",
      message: "The target Adapter for this deployment command is not implemented yet.",
    },
  });
  assert.deepEqual(exitCodes, {
    succeeded: 0,
    invalidInput: 2,
    prerequisiteUnavailable: 3,
    refused: 4,
    failed: 5,
    indeterminate: 6,
    externalReconcilerRequired: 20,
  });
});

test("rejects a missing configuration before target access", async () => {
  let output = "";
  const exitCode = await main(["doctor"], { write: (value) => { output += value; } });
  assert.equal(exitCode, exitCodes.invalidInput);
  assert.equal(JSON.parse(output).reason.code, "deployment_config_required");
});

test("allows a target Adapter to supply a successful structured result", async () => {
  const execution = await executeInvocation(
    parseInvocation(["status", "--config", "deployment.json"]),
    async ({ command }) => ({
      exitCode: exitCodes.succeeded,
      result: {
        schemaVersion: "shareslices.deployment-result/v1",
        command,
        target: "kubernetes",
        requestedRelease: null,
        outcome: "succeeded",
        reason: null,
      },
    }),
  );
  assert.equal(execution.exitCode, 0);
  assert.equal(execution.result.target, "kubernetes");
});
