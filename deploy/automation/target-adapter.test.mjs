import assert from "node:assert/strict";
import test from "node:test";
import {
  bindTargetAdapter,
  invokeTargetAdapter,
  lifecycleOperations,
} from "./target-adapter.mjs";

function completeAdapter(calls = []) {
  return Object.fromEntries(
    lifecycleOperations.map((operation) => [
      operation,
      async (request) => {
        calls.push({ operation, request });
        return { operation };
      },
    ]),
  );
}

test("binds exactly the shared lifecycle surface", async () => {
  const calls = [];
  const implementation = {
    ...completeAdapter(calls),
    cloudflareWorkerName: "must-not-leak",
    kubernetesNamespace: "must-not-leak",
  };
  const adapter = bindTargetAdapter(implementation);

  assert.deepEqual(Object.keys(adapter), lifecycleOperations);
  assert.equal(Object.isFrozen(adapter), true);
  assert.deepEqual(await adapter.plan({ release: "release-1" }), { operation: "plan" });
  assert.deepEqual(calls, [{ operation: "plan", request: { release: "release-1" } }]);
});

test("rejects an incomplete Adapter before invocation", () => {
  const incomplete = completeAdapter();
  delete incomplete.rollback;
  assert.throws(() => bindTargetAdapter(incomplete), /missing rollback/);
  assert.throws(() => bindTargetAdapter(null), /must be an object/);
});

test("dispatches only a declared lifecycle operation", async () => {
  const adapter = bindTargetAdapter(completeAdapter());
  assert.deepEqual(await invokeTargetAdapter(adapter, "verify", {}), {
    operation: "verify",
  });
  assert.throws(
    () => invokeTargetAdapter(adapter, "delete", {}),
    /Unsupported deployment lifecycle operation/,
  );
});
