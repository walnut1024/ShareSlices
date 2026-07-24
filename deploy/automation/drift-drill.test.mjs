import assert from "node:assert/strict";
import test from "node:test";

import {DriftDrillError, runDriftDrill} from "./drift-drill.mjs";

const digest = `sha256:${"a".repeat(64)}`;
function authorization(target) {
  const dimensions = target === "kubernetes"
    ? ["resources", "configuration-digests", "deployment-records"]
    : ["versions", "routes", "bindings", "configuration-digests", "deployment-records"];
  return {
    schemaVersion: "shareslices.drift-drill-authorization/v1",
    level: "deep",
    isolated: true,
    target,
    releaseId: digest,
    operationId: "operation-1",
    fencingToken: 7,
    nonce: "one-time-nonce-1234",
    ownedResources: Object.fromEntries(
      dimensions.map((dimension) => [dimension, [`probe/${dimension}`]]),
    ),
  };
}

function adapter(calls) {
  let drift = [];
  return {
    observe: async (context) => {
      calls.push(["observe", context.phase, context.dimension ?? null]);
      return {outcome: "observed", drift};
    },
    inject: async ({dimension, resources}) => {
      calls.push(["inject", dimension, resources]);
      drift = [{dimension, reasonCode: `${dimension.replaceAll("-", "_")}_drift`}];
      return {outcome: "injected"};
    },
    restore: async ({dimension, resources}) => {
      calls.push(["restore", dimension, resources]);
      drift = [];
      return {outcome: "restored"};
    },
  };
}

for (const target of ["kubernetes", "cloudflare"]) {
  test(`detects and restores every ${target} drift dimension`, async () => {
    const calls = [];
    const result = await runDriftDrill({
      authorization: authorization(target),
      adapter: adapter(calls),
    });
    assert.deepEqual(
      result.results.map(({dimension}) => dimension),
      Object.keys(authorization(target).ownedResources),
    );
    assert.equal(
      calls.filter(([operation]) => operation === "restore").length,
      result.results.length,
    );
    assert.equal(JSON.stringify(result).includes("probe/"), false);
  });
}

test("refuses core, non-isolated, unfenced, or incomplete ownership before observation", async () => {
  for (const mutate of [
    (value) => { value.level = "core"; },
    (value) => { value.isolated = false; },
    (value) => { value.fencingToken = 0; },
    (value) => { delete value.ownedResources.bindings; },
  ]) {
    const candidate = authorization("cloudflare");
    mutate(candidate);
    const calls = [];
    await assert.rejects(
      runDriftDrill({authorization: candidate, adapter: adapter(calls)}),
      (error) =>
        error instanceof DriftDrillError &&
        error.code === "drift_drill_authorization_invalid",
    );
    assert.deepEqual(calls, []);
  }
});

test("restores an injected dimension when detection fails", async () => {
  const calls = [];
  const implementation = adapter(calls);
  implementation.observe = async (context) => {
    calls.push(["observe", context.phase, context.dimension ?? null]);
    return {outcome: "observed", drift: []};
  };
  await assert.rejects(
    runDriftDrill({
      authorization: authorization("kubernetes"),
      adapter: implementation,
    }),
    (error) => error.code === "drift_drill_not_detected",
  );
  assert.equal(calls.some(([operation]) => operation === "restore"), true);
});

test("restore ambiguity overrides the primary detection result", async () => {
  const calls = [];
  const implementation = adapter(calls);
  implementation.restore = async () => {
    throw new Error("provider detail");
  };
  await assert.rejects(
    runDriftDrill({
      authorization: authorization("kubernetes"),
      adapter: implementation,
    }),
    (error) => error.code === "drift_drill_restore_indeterminate",
  );
});
