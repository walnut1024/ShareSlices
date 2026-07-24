import assert from "node:assert/strict";

export function assertHyperdriveEvidence(evidence) {
  assert.deepEqual(evidence.paths, {
    authentication: "passed",
    authorization: "passed",
    viewer: "passed",
    gallery: "passed",
    jobState: "passed",
  });
  assert.equal(evidence.transactionRollback, "passed");
  assert.equal(evidence.cacheDisabledFreshness, "passed");
  assert.deepEqual(evidence.semantics, {
    namedPreparedStatement: "passed",
    transactionLocalState: "passed",
    statementTimeout: "passed",
    workerPoolMaxConnections: 1,
  });
  assert.deepEqual(evidence.connectionBudget, {
    maxConnections: 1,
    secondClientQueuedWhileFirstHeld: true,
  });
  assert.ok(
    ["rejected", "observed_succeeded_but_unsupported"].includes(
      evidence.advisoryLock,
    ),
  );
  return evidence;
}
