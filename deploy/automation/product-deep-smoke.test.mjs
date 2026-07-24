import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductDeepSmokeError,
  runProductDeepSmoke,
} from "./product-deep-smoke.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const authorization = {
  schemaVersion: "shareslices.product-deep-smoke-authorization/v1",
  level: "deep",
  isolated: true,
  target: "kubernetes",
  releaseId: digest("a"),
  operationId: "operation-1",
  fencingToken: 8,
  nonce: "one-time-nonce-1234",
  galleryExpectation: "fail_closed",
  ownedResources: ["artifact/probe-1", "publication/probe-1"],
};

function adapters(calls) {
  return {
    probes: Object.fromEntries([
      "upload",
      "processing",
      "preview",
      "publish",
      "viewer",
      "unpublish",
      "gallery",
    ].map((step, index) => [step, async (context) => {
      calls.push([step, context]);
      return {outcome: "passed", evidenceDigest: digest(String(index + 1))};
    }])),
    cleanup: async (context) => {
      calls.push(["cleanup", context]);
      return {
        outcome: "cleaned",
        cleanedResources: [...context.ownedResources],
      };
    },
  };
}

test("runs the complete product lifecycle in a stable order and cleans it", async () => {
  const calls = [];
  const result = await runProductDeepSmoke({
    authorization,
    ...adapters(calls),
  });
  assert.deepEqual(
    result.results.map(({step}) => step),
    ["upload", "processing", "preview", "publish", "viewer", "unpublish", "gallery"],
  );
  assert.equal(result.galleryExpectation, "fail_closed");
  assert.equal(result.cleanup.resourceCount, 2);
  assert.equal(calls.at(-1)[0], "cleanup");
  assert.equal(JSON.stringify(result).includes("artifact/probe-1"), false);
});

test("accepts either an eligible or fail-closed Gallery expectation", async () => {
  for (const galleryExpectation of ["eligible", "fail_closed"]) {
    const result = await runProductDeepSmoke({
      authorization: {...authorization, galleryExpectation},
      ...adapters([]),
    });
    assert.equal(result.galleryExpectation, galleryExpectation);
  }
});

test("rejects core, shared, unfenced, or duplicate resource authorization", async () => {
  for (const mutate of [
    (candidate) => { candidate.level = "core"; },
    (candidate) => { candidate.isolated = false; },
    (candidate) => { candidate.fencingToken = 0; },
    (candidate) => { candidate.ownedResources.push(candidate.ownedResources[0]); },
  ]) {
    const candidate = structuredClone(authorization);
    mutate(candidate);
    const calls = [];
    await assert.rejects(
      runProductDeepSmoke({
        authorization: candidate,
        ...adapters(calls),
      }),
      (error) =>
        error instanceof ProductDeepSmokeError &&
        error.code === "product_deep_smoke_authorization_invalid",
    );
    assert.deepEqual(calls, []);
  }
});

test("cleans authorized resources after a failed lifecycle probe", async () => {
  const calls = [];
  const inputs = adapters(calls);
  inputs.probes.viewer = async () => ({
    outcome: "failed",
    evidenceDigest: digest("f"),
  });
  await assert.rejects(
    runProductDeepSmoke({authorization, ...inputs}),
    (error) => error.code === "product_deep_smoke_probe_failed",
  );
  assert.equal(calls.at(-1)[0], "cleanup");
});

test("cleanup ambiguity overrides a successful or failed lifecycle", async () => {
  const inputs = adapters([]);
  inputs.cleanup = async () => {
    throw new Error("provider detail");
  };
  await assert.rejects(
    runProductDeepSmoke({authorization, ...inputs}),
    (error) => error.code === "product_deep_smoke_cleanup_indeterminate",
  );
});
