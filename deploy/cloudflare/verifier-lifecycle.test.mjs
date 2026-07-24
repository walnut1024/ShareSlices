import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveVerifierLifecycleBounds,
  pausedVerifierQueueEvidence,
} from "./verifier-lifecycle.mjs";

const at = "2026-07-24T00:00:00.000Z";
const observed = (seconds, evidenceClass = "provider-observed") => ({
  seconds,
  evidenceClass,
  observedAt: at,
});

test("derives tombstone and quiescence from observed maxima plus one margin", () => {
  const bounds = deriveVerifierLifecycleBounds({
    queueMessageRetention: observed(345_600),
    queueSendDelay: observed(43_200, "release-static"),
    queueRetryDelay: observed(30, "release-static"),
    queueRetrySchedule: observed(120, "release-static"),
    activeInvocationLease: observed(60, "release-static"),
    interruptedRecovery: observed(900, "release-static"),
    crossStorageSideEffect: observed(600, "release-static"),
    workerInvocation: observed(45, "release-static"),
    containerInvocation: observed(600, "release-static"),
    brokerInvocation: observed(300, "release-static"),
    databaseCommit: observed(30, "release-static"),
    objectWrite: observed(120, "release-static"),
    safetyMargin: observed(60, "operator-evidenced"),
  });

  assert.equal(bounds.tombstoneSeconds, 345_660);
  assert.deepEqual(bounds.tombstoneBase.dominant, [
    "queueMessageRetention",
  ]);
  assert.equal(bounds.quiescenceSeconds, 660);
  assert.deepEqual(bounds.quiescenceBase.dominant, [
    "containerInvocation",
  ]);
});

test("refuses missing evidence, zero margin, or tombstone shorter than quiescence", () => {
  const valid = {
    queueMessageRetention: observed(100),
    queueSendDelay: observed(1),
    queueRetryDelay: observed(1),
    queueRetrySchedule: observed(1),
    activeInvocationLease: observed(1),
    interruptedRecovery: observed(1),
    crossStorageSideEffect: observed(1),
    workerInvocation: observed(1),
    containerInvocation: observed(1),
    brokerInvocation: observed(1),
    databaseCommit: observed(1),
    objectWrite: observed(1),
    safetyMargin: observed(1),
  };
  assert.throws(
    () => deriveVerifierLifecycleBounds({
      ...valid,
      queueMessageRetention: {seconds: 100},
    }),
    /queue_message_retention_invalid/,
  );
  assert.throws(
    () => deriveVerifierLifecycleBounds({
      ...valid,
      safetyMargin: observed(0),
    }),
    /safety_margin_zero/,
  );
  assert.throws(
    () => deriveVerifierLifecycleBounds({
      ...valid,
      containerInvocation: observed(200),
    }),
    /tombstone_not_beyond_quiescence/,
  );
});

test("Queue pause evidence never claims already in-flight work drained", () => {
  assert.deepEqual(pausedVerifierQueueEvidence({
    deliveryPaused: true,
    observedAt: at,
    providerReportedInFlight: 0,
  }), {
    delivery: "paused",
    observedAt: at,
    inFlight: "unknown",
    drained: false,
    quiescenceRequired: true,
  });
});
