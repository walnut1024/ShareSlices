import assert from "node:assert/strict";
import test from "node:test";

import {assertHyperdriveEvidence} from "./assert-hyperdrive-evidence.mjs";

const valid = {
  paths: {
    authentication: "passed",
    authorization: "passed",
    viewer: "passed",
    gallery: "passed",
    jobState: "passed",
  },
  transactionRollback: "passed",
  cacheDisabledFreshness: "passed",
  semantics: {
    namedPreparedStatement: "passed",
    transactionLocalState: "passed",
    statementTimeout: "passed",
    workerPoolMaxConnections: 1,
  },
  connectionBudget: {
    maxConnections: 1,
    secondClientQueuedWhileFirstHeld: true,
  },
  advisoryLock: "rejected",
};

test("accepts the complete cache-disabled Hyperdrive compatibility evidence", () => {
  assert.equal(assertHyperdriveEvidence(valid), valid);
});

test("rejects incomplete or weakened Hyperdrive evidence", () => {
  for (const evidence of [
    {...valid, cacheDisabledFreshness: "failed"},
    {
      ...valid,
      semantics: {...valid.semantics, statementTimeout: "failed"},
    },
    {
      ...valid,
      connectionBudget: {
        ...valid.connectionBudget,
        secondClientQueuedWhileFirstHeld: false,
      },
    },
    {...valid, advisoryLock: "passed"},
  ]) {
    assert.throws(() => assertHyperdriveEvidence(evidence));
  }
});
