import assert from "node:assert/strict";
import test from "node:test";

import {
  ProcessingFailureDrillError,
  runProcessingFailureDrill,
} from "./processing-failure-drill.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const authorization = {
  schemaVersion: "shareslices.processing-failure-drill-authorization/v1",
  level: "pre_traffic",
  isolated: true,
  releaseId: digest("a"),
  operationId: "operation-1",
  fencingToken: 7,
  nonce: "one-time-nonce-1234",
  ownedResources: ["job/probe-1", "object/probe-1"],
};

function adapters(calls) {
  return {
    probes: Object.fromEntries([
      "duplicateWake",
      "lostWake",
      "containerTermination",
      "staleFence",
      "followOnWork",
    ].map((name, index) => [name, async (context) => {
      calls.push([name, context]);
      return {outcome: "passed", evidenceDigest: digest(String(index + 1))};
    }])),
    cleanup: async (context) => {
      calls.push(["cleanup", context]);
      return {outcome: "cleaned", cleanedResources: [...context.ownedResources]};
    },
  };
}

test("runs every processing failure check under one fenced isolated authorization", async () => {
  const calls = [];
  const result = await runProcessingFailureDrill({
    authorization,
    ...adapters(calls),
  });
  assert.deepEqual(result.results.map(({id}) => id), [
    "duplicateWake",
    "lostWake",
    "containerTermination",
    "staleFence",
    "followOnWork",
  ]);
  assert.equal(result.cleanup.resourceCount, 2);
  assert.equal(calls.at(-1)[0], "cleanup");
  assert.equal(JSON.stringify(result).includes("job/probe-1"), false);
});

test("refuses core, unfenced, or non-isolated invocation before any probe", async () => {
  for (const mutate of [
    (value) => { value.level = "core"; },
    (value) => { value.isolated = false; },
    (value) => { value.fencingToken = 0; },
  ]) {
    const candidate = structuredClone(authorization);
    mutate(candidate);
    const calls = [];
    await assert.rejects(
      runProcessingFailureDrill({authorization: candidate, ...adapters(calls)}),
      (error) =>
        error instanceof ProcessingFailureDrillError &&
        error.code === "processing_failure_drill_authorization_invalid",
    );
    assert.deepEqual(calls, []);
  }
});

test("always cleans authorized resources and preserves the primary failed check", async () => {
  const calls = [];
  const inputs = adapters(calls);
  inputs.probes.containerTermination = async () => ({
    outcome: "failed",
    evidenceDigest: digest("f"),
  });
  await assert.rejects(
    runProcessingFailureDrill({authorization, ...inputs}),
    (error) => error.code === "processing_failure_drill_check_failed",
  );
  assert.equal(calls.at(-1)[0], "cleanup");
});

test("cleanup ambiguity overrides a passing or failed drill", async () => {
  const calls = [];
  const inputs = adapters(calls);
  inputs.cleanup = async () => {
    throw new Error("provider detail");
  };
  await assert.rejects(
    runProcessingFailureDrill({authorization, ...inputs}),
    (error) => error.code === "processing_failure_drill_cleanup_indeterminate",
  );
});

