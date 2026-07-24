import assert from "node:assert/strict";
import test from "node:test";

import {
  runViewerCacheDeepVerification,
  ViewerCacheDeepVerificationError,
} from "./viewer-cache-deep-verification.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const baseAuthorization = {
  schemaVersion: "shareslices.viewer-cache-deep-authorization/v1",
  level: "deep",
  isolated: true,
  deliveryMode: "kubernetes-direct",
  releaseId: digest("a"),
  operationId: "operation-1",
  fencingToken: 9,
  nonce: "one-time-nonce-1234",
  ownedResources: ["artifact/cache-probe-1", "publication/cache-probe-1"],
};

function adapters(calls) {
  return {
    probes: Object.fromEntries([
      "full-body-internal-hit",
      "range-206-bypass",
      "cached-unpublish",
      "cached-expiry",
      "cached-replacement",
      "cached-restriction",
    ].map((check, index) => [check, async (context) => {
      calls.push([check, context]);
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

test("runs the same cache and current-state contract through all delivery modes", async () => {
  for (const deliveryMode of [
    "kubernetes-direct",
    "kubernetes-external-cdn",
    "cloudflare-web-assets-only",
    "cloudflare-web-and-public-viewer-bytes",
  ]) {
    const calls = [];
    const result = await runViewerCacheDeepVerification({
      authorization: {...baseAuthorization, deliveryMode},
      ...adapters(calls),
    });
    assert.deepEqual(
      result.results.map(({check}) => check),
      [
        "full-body-internal-hit",
        "range-206-bypass",
        "cached-unpublish",
        "cached-expiry",
        "cached-replacement",
        "cached-restriction",
      ],
    );
    assert.equal(
      result.internalViewerCacheExpected,
      deliveryMode === "cloudflare-web-and-public-viewer-bytes",
    );
    assert.equal(calls.at(-1)[0], "cleanup");
    assert.equal(JSON.stringify(result).includes("artifact/cache-probe-1"), false);
  }
});

test("rejects non-deep, shared, unfenced, or unknown delivery modes", async () => {
  for (const mutate of [
    (candidate) => { candidate.level = "core"; },
    (candidate) => { candidate.isolated = false; },
    (candidate) => { candidate.fencingToken = 0; },
    (candidate) => { candidate.deliveryMode = "cloudflare"; },
  ]) {
    const candidate = structuredClone(baseAuthorization);
    mutate(candidate);
    const calls = [];
    await assert.rejects(
      runViewerCacheDeepVerification({
        authorization: candidate,
        ...adapters(calls),
      }),
      (error) =>
        error instanceof ViewerCacheDeepVerificationError &&
        error.code === "viewer_cache_deep_authorization_invalid",
    );
    assert.deepEqual(calls, []);
  }
});

test("cleans exact owned state after a failed cache transition", async () => {
  const calls = [];
  const inputs = adapters(calls);
  inputs.probes["cached-unpublish"] = async () => ({
    outcome: "failed",
    evidenceDigest: digest("f"),
  });
  await assert.rejects(
    runViewerCacheDeepVerification({
      authorization: baseAuthorization,
      ...inputs,
    }),
    (error) => error.code === "viewer_cache_deep_check_failed",
  );
  assert.equal(calls.at(-1)[0], "cleanup");
});

test("cleanup ambiguity overrides a passing or failed cache check", async () => {
  const inputs = adapters([]);
  inputs.cleanup = async () => {
    throw new Error("provider detail");
  };
  await assert.rejects(
    runViewerCacheDeepVerification({
      authorization: baseAuthorization,
      ...inputs,
    }),
    (error) => error.code === "viewer_cache_deep_cleanup_indeterminate",
  );
});
