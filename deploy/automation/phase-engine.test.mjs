import assert from "node:assert/strict";
import test from "node:test";

import { applyDeploymentPlan, PhaseEngineError } from "./phase-engine.mjs";

function plan(overrides = {}) {
  return {
    planDigest: `sha256:${"a".repeat(64)}`,
    outcome: "ready",
    target: "kubernetes",
    releaseId: `sha256:${"b".repeat(64)}`,
    observedStateRevision: "observed-1",
    firstInstallation: false,
    actions: [
      { logicalId: "migration/0030", phase: "migration", action: "create" },
      { logicalId: "runtime/api", phase: "public-runtime", action: "update" },
    ],
    ...overrides,
  };
}

function harness({ completed = [], observedRevision = "observed-1" } = {}) {
  const calls = [];
  const lease = { operationId: "operation-1", fencingToken: 7 };
  return {
    calls,
    lease,
    control: {
      bootstrap: async (action) => {
        calls.push(["bootstrap", action.logicalId]);
        return { observedStateRevision: "control-1" };
      },
      acquire: async () => {
        calls.push(["acquire"]);
        return lease;
      },
      completedPhases: async () => completed,
      assertLease: async () => calls.push(["assertLease"]),
      record: async (_lease, checkpoint) => calls.push(["record", checkpoint]),
      readPhaseSteps: async (_lease, phase) => {
        calls.push(["readPhaseSteps", phase]);
        return [{phase, step: "existing", state: "completed", evidence: {id: "one"}}];
      },
      recordPhaseStep: async (_lease, checkpoint) =>
        calls.push(["recordPhaseStep", checkpoint]),
    },
    observe: async () => ({ revision: observedRevision }),
    executePhase: async ({ phase }) => {
      calls.push(["execute", phase]);
      return { checkpointDigest: `sha256:${phase}` };
    },
  };
}

test("requires the exact authorized plan digest before any mutation", async () => {
  const runtime = harness();
  await assert.rejects(
    applyDeploymentPlan({
      plan: plan(),
      authorizedPlanDigest: `sha256:${"c".repeat(64)}`,
      ...runtime,
    }),
    (error) => error instanceof PhaseEngineError && error.code === "authorized_plan_digest_mismatch",
  );
  assert.deepEqual(runtime.calls, []);
});

test("accepts only the plan-authorized first-install bootstrap transition", async () => {
  const runtime = harness({ observedRevision: "control-1" });
  const result = await applyDeploymentPlan({
    plan: plan({
      firstInstallation: true,
      actions: [
        { logicalId: "deployment-control/schema", phase: "control", action: "bootstrap" },
        { logicalId: "runtime/api", phase: "public-runtime", action: "create" },
      ],
    }),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(runtime.calls.slice(0, 2), [
    ["bootstrap", "deployment-control/schema"],
    ["acquire"],
  ]);
});

test("re-observes after acquiring the lease and refuses invalidating drift", async () => {
  const runtime = harness({ observedRevision: "observed-2" });
  await assert.rejects(
    applyDeploymentPlan({
      plan: plan(),
      authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
      ...runtime,
    }),
    (error) => error.code === "deployment_plan_invalidated_by_drift",
  );
  assert.deepEqual(runtime.calls, [["acquire"]]);
});

test("resumes from checkpoints without repeating a completed migration", async () => {
  const runtime = harness({ completed: ["migration"] });
  const result = await applyDeploymentPlan({
    plan: plan(),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.deepEqual(result.phases, [
    { phase: "migration", outcome: "already_completed" },
    { phase: "public-runtime", outcome: "completed" },
  ]);
  assert.deepEqual(
    runtime.calls.filter(([operation]) => operation === "execute"),
    [["execute", "public-runtime"]],
  );
});

test("passes fenced phase-step recovery callbacks only for the executing phase", async () => {
  const runtime = harness({completed: ["migration"]});
  runtime.executePhase = async ({
    phase,
    readStepCheckpoints,
    recordStepCheckpoint,
  }) => {
    assert.equal(phase, "public-runtime");
    assert.deepEqual(await readStepCheckpoints(), [{
      phase: "public-runtime",
      step: "existing",
      state: "completed",
      evidence: {id: "one"},
    }]);
    await recordStepCheckpoint({
      step: "candidate-observed",
      state: "completed",
      evidence: {versionId: "version-1"},
    });
    return {checkpointDigest: `sha256:${phase}`};
  };
  await applyDeploymentPlan({
    plan: plan(),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.deepEqual(
    runtime.calls.find(([operation]) => operation === "recordPhaseStep"),
    ["recordPhaseStep", {
      phase: "public-runtime",
      step: "candidate-observed",
      state: "completed",
      evidence: {versionId: "version-1"},
    }],
  );
});

test("repeating a fully checkpointed apply is idempotent and executes no provider writes", async () => {
  const runtime = harness({completed: ["migration", "public-runtime"]});
  runtime.executePhase = async () => assert.fail("completed phases must not execute again");
  const result = await applyDeploymentPlan({
    plan: plan(),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.phases, [
    {phase: "migration", outcome: "already_completed"},
    {phase: "public-runtime", outcome: "already_completed"},
  ]);
  assert.equal(
    runtime.calls.some(([operation, checkpoint]) =>
      operation === "record" && checkpoint.state === "running"),
    false,
  );
});

test("returns an explicit external reconciler handoff without later phases", async () => {
  const runtime = harness();
  runtime.executePhase = async ({ phase }) => ({
    outcome: "external_reconciler_required",
    handoffDigest: `sha256:${phase}`,
  });
  const result = await applyDeploymentPlan({
    plan: plan(),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.equal(result.outcome, "external_reconciler_required");
  assert.equal(result.phases.length, 1);
  assert.equal(result.phases[0].phase, "migration");
});

test("can journal every ordered immutable GitOps handoff without claiming convergence", async () => {
  const runtime = harness();
  runtime.executePhase = async ({phase}) => ({
    outcome: "external_reconciler_required",
    handoffDigest: `sha256:${phase}`,
    continueHandoff: true,
  });
  const result = await applyDeploymentPlan({
    plan: plan(),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.equal(result.outcome, "external_reconciler_required");
  assert.deepEqual(result.phases.map(({phase}) => phase), ["migration", "public-runtime"]);
  assert.equal(
    runtime.calls.filter(([operation, checkpoint]) => (
      operation === "record" && checkpoint.state === "external_reconciler_required"
    )).length,
    2,
  );
});

test("does not execute resources retained for rollback", async () => {
  const runtime = harness();
  const result = await applyDeploymentPlan({
    plan: plan({
      actions: [
        {logicalId: "runtime/previous-api", phase: "retirement", action: "retain"},
        {logicalId: "runtime/old-api", phase: "retirement", action: "retire"},
      ],
    }),
    authorizedPlanDigest: `sha256:${"a".repeat(64)}`,
    ...runtime,
  });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(
    runtime.calls.filter(([operation]) => operation === "execute"),
    [["execute", "retirement"]],
  );
});
