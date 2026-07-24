import {sha256Digest} from "../automation/canonical.mjs";

export class CloudflareReleaseVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CloudflareReleaseVerificationError";
    this.code = code;
  }
}

const orderedSteps = Object.freeze([
  "worker-deployed",
  "queue-provisioned",
  "probe-initialized",
  "message-published",
  "terminal-observed",
  "triggers-isolated",
  "cleanup-observed",
  "queues-deleted",
  "worker-deleted",
]);

function fail(code, message) {
  throw new CloudflareReleaseVerificationError(code, message);
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`Cloudflare release verification requires ${name}.`);
  }
  return value;
}

function checkpointMap(checkpoints) {
  const result = new Map();
  for (const checkpoint of checkpoints) {
    if (
      !orderedSteps.includes(checkpoint?.step) ||
      result.has(checkpoint.step) ||
      !["running", "completed", "isolated_orphan", "indeterminate"]
        .includes(checkpoint.state)
    ) {
      fail(
        "cloudflare_release_verification_checkpoint_invalid",
        "Cloudflare release verification checkpoint history is invalid.",
      );
    }
    result.set(checkpoint.step, checkpoint);
  }
  return result;
}

function completedEvidence(checkpoints, step) {
  const checkpoint = checkpoints.get(step);
  return checkpoint?.state === "completed" ? checkpoint.evidence : null;
}

function ensurePredecessors(checkpoints) {
  let gap = false;
  for (const step of orderedSteps) {
    const checkpoint = checkpoints.get(step);
    if (!checkpoint) {
      gap = true;
      continue;
    }
    if (gap && checkpoint.state === "completed") {
      fail(
        "cloudflare_release_verification_checkpoint_order_invalid",
        "Cloudflare release verification checkpoints are out of order.",
      );
    }
  }
}

function requireTerminalObservation(value, expected) {
  if (
    !value ||
    value.terminal !== true ||
    value.nonce !== expected.nonce ||
    value.releaseId !== expected.releaseId ||
    value.fence !== expected.fence ||
    value.subFence !== expected.subFence ||
    value.outcome !== "passed" ||
    typeof value.observedAt !== "string"
  ) {
    fail(
      "cloudflare_release_verification_terminal_unproven",
      "The exact release verification terminal result was not proven.",
    );
  }
  return Object.freeze({
    nonce: value.nonce,
    releaseId: value.releaseId,
    fence: value.fence,
    subFence: value.subFence,
    outcome: value.outcome,
    observedAt: value.observedAt,
  });
}

function requireCleanupObservation(value, expected) {
  if (
    !value ||
    value.nonce !== expected.nonce ||
    value.releaseId !== expected.releaseId ||
    value.fence !== expected.fence ||
    value.terminal !== true ||
    value.cleanupState !== "complete" ||
    value.quiescenceReached !== true ||
    value.activeInvocations !== 0 ||
    value.tombstoneRetained !== true ||
    typeof value.observedAt !== "string"
  ) {
    fail(
      "cloudflare_release_verification_cleanup_unproven",
      "Release verification cleanup and quiescence were not proven.",
    );
  }
  return Object.freeze({
    nonce: value.nonce,
    releaseId: value.releaseId,
    fence: value.fence,
    cleanupState: value.cleanupState,
    quiescenceReached: true,
    activeInvocations: 0,
    tombstoneRetained: true,
    observedAt: value.observedAt,
  });
}

function requireWorkerEvidence(value, expectedName) {
  if (
    !value ||
    value.workerName !== expectedName ||
    value.routeFree !== true ||
    value.workersDevEnabled !== false ||
    value.previewUrlsEnabled !== false ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bindingsDigest ?? "")
  ) {
    fail(
      "cloudflare_release_verifier_worker_unproven",
      "The route-free release verifier Worker identity was not proven.",
    );
  }
  return Object.freeze(structuredClone(value));
}

function requireWorkerDeletion(value, expectedName) {
  if (
    !value ||
    value.workerName !== expectedName ||
    value.exists !== false ||
    typeof value.observedAt !== "string"
  ) {
    fail(
      "cloudflare_release_verifier_worker_deletion_unproven",
      "Release verifier Worker deletion was not proven.",
    );
  }
  return Object.freeze(structuredClone(value));
}

export function createCloudflareReleaseVerificationExecutor({
  workerLifecycle,
  queueLifecycle,
  initializeProbe,
  observeUntilTerminal,
  observeUntilCleanup,
} = {}) {
  const deployWorker = requireFunction(workerLifecycle?.deploy, "worker deploy");
  const deleteWorker = requireFunction(workerLifecycle?.delete, "worker delete");
  const provisionQueue = requireFunction(queueLifecycle?.provision, "Queue provision");
  const publishAndResume = requireFunction(
    queueLifecycle?.publishAndResume,
    "Queue publish and resume",
  );
  const pauseAndDetach = requireFunction(
    queueLifecycle?.pauseAndDetach,
    "Queue pause and detach",
  );
  const deleteQueues = requireFunction(
    queueLifecycle?.deleteAfterQuiescence,
    "Queue deletion",
  );
  requireFunction(initializeProbe, "probe initialization");
  requireFunction(observeUntilTerminal, "terminal observation");
  requireFunction(observeUntilCleanup, "cleanup observation");

  return async function execute({
    lifecycleInput,
    message,
    workerConfig,
    readStepCheckpoints,
    recordStepCheckpoint,
    assertLease,
  }) {
    requireFunction(readStepCheckpoints, "checkpoint reader");
    requireFunction(recordStepCheckpoint, "checkpoint writer");
    requireFunction(assertLease, "lease assertion");
    const checkpoints = checkpointMap(await readStepCheckpoints());
    ensurePredecessors(checkpoints);
    for (const checkpoint of checkpoints.values()) {
      if (["isolated_orphan", "indeterminate"].includes(checkpoint.state)) {
        fail(
          "cloudflare_release_verification_reconciliation_required",
          "Release verification has an unresolved isolated or indeterminate step.",
        );
      }
    }

    const mutate = async (step, runningEvidence, operation) => {
      const existing = checkpoints.get(step);
      if (existing?.state === "completed") return existing.evidence;
      if (existing?.state === "running") {
        fail(
          "cloudflare_release_verification_reconciliation_required",
          `Release verification step ${step} has an ambiguous prior mutation.`,
        );
      }
      await assertLease();
      await recordStepCheckpoint({
        step,
        state: "running",
        evidence: runningEvidence,
      });
      checkpoints.set(step, {step, state: "running", evidence: runningEvidence});
      const evidence = await operation();
      await assertLease();
      await recordStepCheckpoint({step, state: "completed", evidence});
      checkpoints.set(step, {step, state: "completed", evidence});
      return evidence;
    };
    const observe = async (step, pendingEvidence, operation) => {
      const existing = checkpoints.get(step);
      if (existing?.state === "completed") return existing.evidence;
      await assertLease();
      if (existing?.state !== "running") {
        await recordStepCheckpoint({
          step,
          state: "running",
          evidence: pendingEvidence,
        });
      }
      const evidence = await operation();
      await assertLease();
      await recordStepCheckpoint({step, state: "completed", evidence});
      checkpoints.set(step, {step, state: "completed", evidence});
      return evidence;
    };
    const mutateIdempotently = async (step, runningEvidence, operation) => {
      const existing = checkpoints.get(step);
      if (existing?.state === "completed") return existing.evidence;
      await assertLease();
      if (existing?.state !== "running") {
        await recordStepCheckpoint({
          step,
          state: "running",
          evidence: runningEvidence,
        });
      }
      const evidence = await operation();
      await assertLease();
      await recordStepCheckpoint({step, state: "completed", evidence});
      checkpoints.set(step, {step, state: "completed", evidence});
      return evidence;
    };

    let worker = completedEvidence(checkpoints, "worker-deployed");
    let queue = completedEvidence(checkpoints, "queue-provisioned");
    try {
      worker = await mutate(
        "worker-deployed",
        {workerName: workerConfig.name, routeFree: true},
        async () => requireWorkerEvidence(
          await deployWorker(workerConfig),
          workerConfig.name,
        ),
      );
      queue = await mutate(
        "queue-provisioned",
        {
          workerName: worker.workerName,
          queueName: lifecycleInput.queueName,
          deadLetterQueueName: lifecycleInput.deadLetterQueueName,
          deliveryPaused: true,
        },
        () => provisionQueue(lifecycleInput),
      );
      await mutateIdempotently(
        "probe-initialized",
        {
          nonce: message.nonce,
          releaseId: message.releaseId,
          fence: message.fence,
          subFence: message.subFence,
        },
        () => initializeProbe({lease: lifecycleInput.lease, message}),
      );
      await mutate(
        "message-published",
        {
          nonce: message.nonce,
          invocationId: message.invocationId,
          queueId: queue.queue.id,
        },
        () => publishAndResume({...lifecycleInput, handle: queue, message}),
      );
      const terminal = await observe(
        "terminal-observed",
        {nonce: message.nonce, observation: "pending"},
        async () => requireTerminalObservation(
          await observeUntilTerminal(message),
          message,
        ),
      );
      const isolated = await mutate(
        "triggers-isolated",
        {
          queueId: queue.queue.id,
          consumerId: queue.consumer?.id ?? null,
          delivery: "pause-requested",
        },
        () => pauseAndDetach({...lifecycleInput, handle: queue}),
      );
      queue = isolated.handle;
      const cleanup = await observe(
        "cleanup-observed",
        {nonce: terminal.nonce, observation: "pending"},
        async () => requireCleanupObservation(
          await observeUntilCleanup(message),
          message,
        ),
      );
      await mutate(
        "queues-deleted",
        {
          queueId: queue.queue.id,
          deadLetterQueueId: queue.deadLetterQueue.id,
        },
        () => deleteQueues({
          ...lifecycleInput,
          handle: queue,
          cleanupState: cleanup.cleanupState,
          quiescenceState: cleanup.quiescenceReached ? "complete" : "pending",
          tombstoneState: cleanup.tombstoneRetained ? "retained" : "missing",
        }),
      );
      await mutate(
        "worker-deleted",
        {workerName: worker.workerName},
        async () => requireWorkerDeletion(
          await deleteWorker(worker),
          worker.workerName,
        ),
      );
      return Object.freeze({
        checkpointDigest: sha256Digest(
          orderedSteps.map((step) => checkpoints.get(step)?.evidence),
        ),
        evidence: Object.freeze({
          nonce: message.nonce,
          terminal: terminal.outcome,
          cleanup: cleanup.cleanupState,
          resourcesDeleted: true,
        }),
      });
    } catch (error) {
      const published = checkpoints.get("message-published");
      const isolated = checkpoints.get("triggers-isolated");
      if (
        queue?.consumer &&
        published &&
        isolated?.state !== "completed"
      ) {
        try {
          await assertLease();
          const evidence = await pauseAndDetach({...lifecycleInput, handle: queue});
          await recordStepCheckpoint({
            step: "triggers-isolated",
            state: "isolated_orphan",
            evidence,
          });
        } catch {
          await recordStepCheckpoint({
            step: "triggers-isolated",
            state: "indeterminate",
            evidence: {
              queueId: queue.queue.id,
              isolation: "unconfirmed",
            },
          }).catch(() => undefined);
        }
      }
      throw error;
    }
  };
}
