import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareReleaseVerificationError,
  createCloudflareReleaseVerificationExecutor,
} from "./release-verification-executor.mjs";

const releaseId = `sha256:${"a".repeat(64)}`;
const lifecycleInput = {
  installationId: "shareslices",
  releaseId,
  fence: 7,
  queueName: "shareslices-verify-aaaaaaaaaaaa-7",
  deadLetterQueueName: "shareslices-verify-dlq-aaaaaaaaaaaa-7",
};
const message = {
  nonce: "nonce_123456789012",
  invocationId: "invocation_1234567890",
  releaseId,
  fence: 7,
  subFence: 3,
};
const worker = {
  workerName: "shareslices-verify-aaaaaaaaaaaa-7",
  routeFree: true,
  workersDevEnabled: false,
  previewUrlsEnabled: false,
  bindingsDigest: `sha256:${"b".repeat(64)}`,
};
const queue = {
  queue: {id: "queue-1", name: lifecycleInput.queueName},
  deadLetterQueue: {id: "dlq-1", name: lifecycleInput.deadLetterQueueName},
  consumer: {id: "consumer-1", scriptName: worker.workerName},
};

function harness({existing = [], failPublish = false} = {}) {
  const calls = [];
  const checkpoints = new Map(existing.map((entry) => [entry.step, entry]));
  const executor = createCloudflareReleaseVerificationExecutor({
    workerLifecycle: {
      deploy: async () => {
        calls.push("worker.deploy");
        return worker;
      },
      delete: async () => {
        calls.push("worker.delete");
        return {
          workerName: worker.workerName,
          exists: false,
          observedAt: "2026-07-24T00:11:01Z",
        };
      },
    },
    queueLifecycle: {
      provision: async () => {
        calls.push("queue.provision");
        return queue;
      },
      publishAndResume: async () => {
        calls.push("queue.publish");
        if (failPublish) throw new Error("provider response lost");
        return {state: "delivery-resumed", nonce: message.nonce};
      },
      pauseAndDetach: async () => {
        calls.push("queue.isolate");
        return {
          state: "paused-consumer-detached",
          handle: {...queue, consumer: null},
        };
      },
      deleteAfterQuiescence: async () => {
        calls.push("queue.delete");
        return {state: "queues-deleted"};
      },
    },
    observeUntilTerminal: async () => ({
      ...message,
      terminal: true,
      outcome: "passed",
      observedAt: "2026-07-24T00:00:00Z",
    }),
    observeUntilCleanup: async () => ({
      nonce: message.nonce,
      releaseId,
      fence: 7,
      terminal: true,
      cleanupState: "complete",
      quiescenceReached: true,
      activeInvocations: 0,
      tombstoneRetained: true,
      observedAt: "2026-07-24T00:11:00Z",
    }),
  });
  return {
    calls,
    checkpoints,
    execute: () => executor({
      lifecycleInput,
      message,
      workerConfig: {name: worker.workerName},
      assertLease: async () => calls.push("lease"),
      readStepCheckpoints: async () => [...checkpoints.values()],
      recordStepCheckpoint: async (checkpoint) => {
        calls.push(`checkpoint:${checkpoint.step}:${checkpoint.state}`);
        checkpoints.set(checkpoint.step, checkpoint);
      },
    }),
  };
}

test("runs the route-free verifier lifecycle in cleanup-safe order", async () => {
  const runtime = harness();
  const result = await runtime.execute();
  assert.match(result.checkpointDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    runtime.calls.filter((call) => !call.startsWith("checkpoint") && call !== "lease"),
    [
      "worker.deploy",
      "queue.provision",
      "queue.publish",
      "queue.isolate",
      "queue.delete",
      "worker.delete",
    ],
  );
  assert.deepEqual(result.evidence, {
    nonce: message.nonce,
    terminal: "passed",
    cleanup: "complete",
    resourcesDeleted: true,
  });
});

test("resumes completed provider mutations without repeating them", async () => {
  const first = harness();
  await first.execute();
  const second = harness({existing: [...first.checkpoints.values()]});
  await second.execute();
  assert.deepEqual(
    second.calls.filter((call) => call.includes(".")),
    [],
  );
});

test("isolates a Queue when message publication has an ambiguous response", async () => {
  const runtime = harness({failPublish: true});
  await assert.rejects(runtime.execute(), /provider response lost/);
  assert.equal(runtime.calls.includes("queue.isolate"), true);
  assert.equal(runtime.checkpoints.get("triggers-isolated").state, "isolated_orphan");
  assert.equal(runtime.calls.includes("queue.delete"), false);
  assert.equal(runtime.calls.includes("worker.delete"), false);
});

test("refuses to replay an interrupted external mutation", async () => {
  const runtime = harness({existing: [{
    step: "worker-deployed",
    state: "running",
    evidence: {workerName: worker.workerName, routeFree: true},
  }]});
  await assert.rejects(
    runtime.execute(),
    (error) => (
      error instanceof CloudflareReleaseVerificationError &&
      error.code === "cloudflare_release_verification_reconciliation_required"
    ),
  );
  assert.equal(runtime.calls.includes("worker.deploy"), false);
});

test("retries an interrupted read-only terminal observation", async () => {
  const completed = [
    {step: "worker-deployed", state: "completed", evidence: worker},
    {step: "queue-provisioned", state: "completed", evidence: queue},
    {
      step: "message-published",
      state: "completed",
      evidence: {state: "delivery-resumed", nonce: message.nonce},
    },
    {
      step: "terminal-observed",
      state: "running",
      evidence: {nonce: message.nonce, observation: "pending"},
    },
  ];
  const runtime = harness({existing: completed});
  await runtime.execute();
  assert.equal(runtime.calls.includes("worker.deploy"), false);
  assert.equal(runtime.calls.includes("queue.publish"), false);
  assert.equal(runtime.checkpoints.get("terminal-observed").state, "completed");
});

test("fails closed on wrong terminal identity or incomplete cleanup", async () => {
  const executor = createCloudflareReleaseVerificationExecutor({
    workerLifecycle: {
      deploy: async () => worker,
      delete: async () => ({
        workerName: worker.workerName,
        exists: false,
        observedAt: "2026-07-24T00:11:01Z",
      }),
    },
    queueLifecycle: {
      provision: async () => queue,
      publishAndResume: async () => ({state: "delivery-resumed"}),
      pauseAndDetach: async () => ({handle: {...queue, consumer: null}}),
      deleteAfterQuiescence: async () => ({state: "queues-deleted"}),
    },
    observeUntilTerminal: async () => ({
      ...message,
      nonce: "wrong_nonce_123456",
      terminal: true,
      outcome: "passed",
      observedAt: "2026-07-24T00:00:00Z",
    }),
    observeUntilCleanup: async () => assert.fail("cleanup must not run"),
  });
  const checkpoints = new Map();
  await assert.rejects(
    executor({
      lifecycleInput,
      message,
      workerConfig: {name: worker.workerName},
      assertLease: async () => {},
      readStepCheckpoints: async () => [],
      recordStepCheckpoint: async (entry) => checkpoints.set(entry.step, entry),
    }),
    (error) => error.code === "cloudflare_release_verification_terminal_unproven",
  );
  assert.equal(checkpoints.get("triggers-isolated").state, "isolated_orphan");
});
