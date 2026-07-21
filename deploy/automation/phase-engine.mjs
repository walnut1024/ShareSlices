import { deploymentPhases } from "./plan.mjs";

export class PhaseEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhaseEngineError";
    this.code = code;
  }
}

function executableActions(plan, phase) {
  return plan.actions.filter(({ phase: actionPhase, action }) =>
    actionPhase === phase && !["unchanged", "report_orphan", "retain"].includes(action));
}

export async function applyDeploymentPlan({
  plan,
  authorizedPlanDigest,
  control,
  observe,
  executePhase,
}) {
  if (plan.planDigest !== authorizedPlanDigest) {
    throw new PhaseEngineError(
      "authorized_plan_digest_mismatch",
      "Authorized plan digest does not match the supplied plan.",
    );
  }
  if (plan.outcome !== "ready") {
    throw new PhaseEngineError(
      "deployment_plan_refused",
      "A refused deployment plan cannot be applied.",
    );
  }

  let expectedObservedRevision = plan.observedStateRevision;
  const bootstrap = executableActions(plan, "control");
  if (bootstrap.length > 0) {
    if (
      bootstrap.length !== 1 ||
      bootstrap[0].action !== "bootstrap" ||
      !plan.firstInstallation
    ) {
      throw new PhaseEngineError(
        "deployment_control_bootstrap_unauthorized",
        "The plan does not authorize the requested control-schema transition.",
      );
    }
    const transition = await control.bootstrap(bootstrap[0]);
    expectedObservedRevision = transition.observedStateRevision;
  }

  const lease = await control.acquire({
    target: plan.target,
    releaseId: plan.releaseId,
    planDigest: plan.planDigest,
  });
  const observed = await observe();
  if (observed.revision !== expectedObservedRevision) {
    throw new PhaseEngineError(
      "deployment_plan_invalidated_by_drift",
      "Observed target state changed after the plan was authorized.",
    );
  }

  const completed = new Set(await control.completedPhases(lease));
  const outcomes = [];
  let externalHandoff = false;
  for (const phase of deploymentPhases.filter((name) => name !== "control")) {
    const actions = executableActions(plan, phase);
    if (actions.length === 0) continue;
    if (completed.has(phase)) {
      outcomes.push({ phase, outcome: "already_completed" });
      continue;
    }
    await control.assertLease(lease);
    await control.record(lease, { phase, state: "running" });
    try {
      const outcome = await executePhase({
        phase,
        actions,
        lease,
        assertLease: () => control.assertLease(lease),
      });
      if (outcome?.outcome === "external_reconciler_required") {
        const {continueHandoff, ...handoffOutcome} = outcome;
        await control.record(lease, {
          phase,
          state: "external_reconciler_required",
          digest: outcome.handoffDigest,
        });
        outcomes.push({ phase, ...handoffOutcome });
        externalHandoff = true;
        if (continueHandoff === true) continue;
        return Object.freeze({outcome: "external_reconciler_required", lease, phases: outcomes});
      }
      await control.assertLease(lease);
      await control.record(lease, {
        phase,
        state: "completed",
        digest: outcome?.checkpointDigest,
      });
      outcomes.push({
        phase,
        outcome: "completed",
        ...(outcome?.evidence === undefined ? {} : {evidence: outcome.evidence}),
      });
    } catch (error) {
      await control.record(lease, {
        phase,
        state: error instanceof PhaseEngineError ? "failed" : "indeterminate",
        reasonCode: error.code ?? "phase_execution_indeterminate",
      });
      throw error;
    }
  }
  return Object.freeze({
    outcome: externalHandoff ? "external_reconciler_required" : "succeeded",
    lease,
    phases: outcomes,
  });
}
