const evidenceClasses = new Set([
  "provider-observed",
  "release-static",
  "operator-evidenced",
]);
const maximumQuiescenceSeconds = 11 * 60;

function observation(name, value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.seconds) ||
    value.seconds < 0 ||
    !evidenceClasses.has(value.evidenceClass) ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt))
  ) {
    throw new Error(`cloudflare_verifier_lifecycle_${name}_invalid`);
  }
  return Object.freeze({
    seconds: value.seconds,
    evidenceClass: value.evidenceClass,
    observedAt: value.observedAt,
  });
}

function maximum(named) {
  const maximumSeconds = Math.max(...named.map(([, value]) => value.seconds));
  return Object.freeze({
    seconds: maximumSeconds,
    dominant: Object.freeze(
      named
        .filter(([, value]) => value.seconds === maximumSeconds)
        .map(([name]) => name),
    ),
  });
}

export function deriveVerifierLifecycleBounds(input) {
  const safetyMargin = observation("safety_margin", input.safetyMargin);
  if (safetyMargin.seconds <= 0) {
    throw new Error("cloudflare_verifier_lifecycle_safety_margin_zero");
  }
  const tombstoneInputs = Object.freeze({
    queueMessageRetention: observation(
      "queue_message_retention",
      input.queueMessageRetention,
    ),
    queueSendDelay: observation("queue_send_delay", input.queueSendDelay),
    queueRetryDelay: observation("queue_retry_delay", input.queueRetryDelay),
    queueRetrySchedule: observation(
      "queue_retry_schedule",
      input.queueRetrySchedule,
    ),
    activeInvocationLease: observation(
      "active_invocation_lease",
      input.activeInvocationLease,
    ),
    interruptedRecovery: observation(
      "interrupted_recovery",
      input.interruptedRecovery,
    ),
    crossStorageSideEffect: observation(
      "cross_storage_side_effect",
      input.crossStorageSideEffect,
    ),
  });
  const quiescenceInputs = Object.freeze({
    workerInvocation: observation(
      "worker_invocation",
      input.workerInvocation,
    ),
    containerInvocation: observation(
      "container_invocation",
      input.containerInvocation,
    ),
    brokerInvocation: observation(
      "broker_invocation",
      input.brokerInvocation,
    ),
    databaseCommit: observation("database_commit", input.databaseCommit),
    objectWrite: observation("object_write", input.objectWrite),
  });
  const tombstoneBase = maximum(Object.entries(tombstoneInputs));
  const quiescenceBase = maximum(Object.entries(quiescenceInputs));
  const tombstoneSeconds = tombstoneBase.seconds + safetyMargin.seconds;
  const quiescenceSeconds = quiescenceBase.seconds + safetyMargin.seconds;
  if (quiescenceSeconds > maximumQuiescenceSeconds) {
    throw new Error(
      "cloudflare_verifier_lifecycle_quiescence_exceeds_invocation_window",
    );
  }
  if (quiescenceSeconds >= tombstoneSeconds) {
    throw new Error(
      "cloudflare_verifier_lifecycle_tombstone_not_beyond_quiescence",
    );
  }
  return Object.freeze({
    tombstoneSeconds,
    quiescenceSeconds,
    tombstoneBase,
    quiescenceBase,
    safetyMargin,
    observations: Object.freeze({
      tombstone: tombstoneInputs,
      quiescence: quiescenceInputs,
    }),
  });
}

export function pausedVerifierQueueEvidence(input) {
  if (
    !input ||
    input.deliveryPaused !== true ||
    typeof input.observedAt !== "string" ||
    !Number.isFinite(Date.parse(input.observedAt))
  ) {
    throw new Error("cloudflare_verifier_queue_pause_observation_invalid");
  }
  return Object.freeze({
    delivery: "paused",
    observedAt: input.observedAt,
    inFlight: "unknown",
    drained: false,
    quiescenceRequired: true,
  });
}
