import {
  acquireOperationLease,
  bootstrapControlSchema,
  heartbeatOperationLease,
  recordPhaseCheckpoint,
} from "./control-store.mjs";
import {withPostgresControlClient} from "./control-observation.mjs";
import {applyDeploymentPlan} from "./phase-engine.mjs";

function operationIdentity(plan) {
  return `apply-${plan.planDigest.slice("sha256:".length, "sha256:".length + 32)}`;
}

export function createProductionPlanApplier({
  resolvers,
  owner,
  now = () => new Date(),
  leaseSeconds = 120,
  ClientClass,
  withControlClient = withPostgresControlClient,
} = {}) {
  if (typeof owner !== "string" || owner.length === 0) {
    throw new TypeError("A deployment principal is required for production apply.");
  }
  return async ({config, plan, authorizedPlanDigest, observe, executePhase}) => (
    withControlClient(config, resolvers, async (client) => {
      const leaseInput = () => {
        const current = now();
        return {
          now: current,
          leaseExpiresAt: new Date(current.getTime() + leaseSeconds * 1000),
        };
      };
      const control = {
        bootstrap: async (action) => {
          await bootstrapControlSchema(client, action.desiredDigest);
          const observation = await observe();
          return {observedStateRevision: observation.revision};
        },
        acquire: async () => {
          const acquired = await acquireOperationLease(client, {
            installationId: config.installationId,
            target: plan.target,
            operationId: operationIdentity(plan),
            releaseId: plan.releaseId,
            owner,
            ...leaseInput(),
          });
          return Object.freeze({
            ...acquired,
            installationId: config.installationId,
            target: plan.target,
            owner,
          });
        },
        completedPhases: async (lease) => {
          const result = await client.query(
            `select phase from shareslices_deployment_phase_journal
             where installation_id = $1 and operation_id = $2 and fencing_token = $3
               and state = 'completed'`,
            [lease.installationId, lease.operationId, lease.fencingToken],
          );
          return result.rows.map(({phase}) => phase);
        },
        assertLease: async (lease) => {
          await heartbeatOperationLease(client, lease, leaseInput());
        },
        record: (lease, checkpoint) => recordPhaseCheckpoint(client, lease, checkpoint),
      };
      return applyDeploymentPlan({
        plan,
        authorizedPlanDigest,
        control,
        observe,
        executePhase,
      });
    }, ClientClass)
  );
}
