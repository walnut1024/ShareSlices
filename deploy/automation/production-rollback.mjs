import {sha256Digest} from "./canonical.mjs";
import {
  acquireOperationLease,
  completeOperationLease,
  heartbeatOperationLease,
  mirrorReleaseRecords,
  recordPhaseCheckpoint,
} from "./control-store.mjs";
import {withPostgresControlClient} from "./control-observation.mjs";
import {evaluateRollback} from "./rollback.mjs";

function operationIdentity(releaseId) {
  return `rollback-${releaseId.slice("sha256:".length, "sha256:".length + 32)}`;
}

function databaseRecord(row) {
  if (!row) return null;
  return Object.freeze({
    target: row.target,
    releaseId: row.release_id,
    bundleDigest: row.bundle_digest,
    configurationDigest: row.configuration_digest,
    secretRevisions: row.secret_revisions,
    compatibility: row.compatibility,
    contractRevisions: row.contract_revisions,
  });
}

async function readReleaseRecords(client, installationId) {
  const result = await client.query(
    `select slot, target, release_id, bundle_digest, configuration_digest,
            secret_revisions, compatibility, contract_revisions
       from shareslices_deployment_release_record
      where installation_id = $1 and slot in ('active', 'previous')`,
    [installationId],
  );
  return Object.freeze(Object.fromEntries(result.rows.map((row) => [row.slot, databaseRecord(row)])));
}

function recordMatchesCandidate(record, release, bundleDigest) {
  const secretRevisions = [...release.secretRevisions]
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  return Boolean(record) && sha256Digest(record) === sha256Digest({
    target: release.target,
    releaseId: release.releaseId,
    bundleDigest,
    configurationDigest: release.configurationDigest,
    secretRevisions,
    compatibility: release.compatibility,
    contractRevisions: release.contractRevisions,
  });
}

function structuralRefusal(records, release, bundleDigest) {
  const reasons = [];
  if (!records.active || !records.previous || records.previous.releaseId !== release.releaseId) {
    reasons.push("rollback_candidate_not_recorded");
  } else if (!recordMatchesCandidate(records.previous, release, bundleDigest)) {
    reasons.push("rollback_candidate_record_mismatch");
  }
  return reasons;
}

export function createProductionRollbackExecutor({
  resolvers,
  owner,
  now = () => new Date(),
  leaseSeconds = 120,
  ClientClass,
  withControlClient = withPostgresControlClient,
} = {}) {
  if (typeof owner !== "string" || owner.length === 0) {
    throw new TypeError("A deployment principal is required for production rollback.");
  }
  return async ({
    config,
    release,
    bundleDigest,
    plan,
    authorizedPlanDigest,
    observe,
    preflight,
    executePhase,
  }) => (
    withControlClient(config, resolvers, async (client) => {
      const {planDigest, ...planBody} = plan ?? {};
      if (
        plan?.operation !== "rollback" ||
        plan.outcome !== "ready" ||
        plan.actions?.some(({phase}) => phase === "migration") ||
        planDigest !== authorizedPlanDigest ||
        sha256Digest(planBody) !== planDigest ||
        plan.target !== config.target ||
        plan.releaseId !== release.releaseId ||
        plan.bundleDigest !== bundleDigest
      ) {
        return Object.freeze({
          outcome: "refused",
          refusalReasons: ["rollback_plan_unauthorized"],
          actions: [],
        });
      }
      let records = await readReleaseRecords(client, config.installationId);
      if (recordMatchesCandidate(records.active, release, bundleDigest)) {
        return Object.freeze({
          outcome: "succeeded",
          releaseId: release.releaseId,
          phases: Object.freeze([]),
          records,
          alreadyConverged: true,
        });
      }
      const initialObservation = await observe();
      if (initialObservation?.revision !== plan.observedStateRevision) {
        return Object.freeze({outcome: "refused", refusalReasons: ["rollback_plan_stale"], actions: []});
      }
      const initialRefusal = structuralRefusal(records, release, bundleDigest);
      if (initialRefusal.length > 0) {
        return Object.freeze({outcome: "refused", refusalReasons: initialRefusal, actions: []});
      }

      const leaseInput = () => {
        const current = now();
        return {
          now: current,
          leaseExpiresAt: new Date(current.getTime() + leaseSeconds * 1000),
        };
      };
      const lease = Object.freeze({
        ...(await acquireOperationLease(client, {
          installationId: config.installationId,
          target: config.target,
          operationId: operationIdentity(release.releaseId),
          releaseId: release.releaseId,
          owner,
          ...leaseInput(),
        })),
        installationId: config.installationId,
        target: config.target,
        owner,
      });

      records = await readReleaseRecords(client, config.installationId);
      const fencedObservation = await observe();
      const fencedRefusal = structuralRefusal(records, release, bundleDigest);
      if (fencedObservation?.revision !== plan.observedStateRevision) {
        fencedRefusal.push("rollback_plan_stale");
      }
      if (fencedRefusal.length > 0) {
        await recordPhaseCheckpoint(client, lease, {
          phase: "preflight",
          state: "failed",
          digest: sha256Digest(fencedRefusal),
          reasonCode: fencedRefusal[0],
        });
        await completeOperationLease(client, lease);
        return Object.freeze({outcome: "refused", refusalReasons: fencedRefusal, actions: []});
      }

      const runPhase = async (phase, operation) => {
        await heartbeatOperationLease(client, lease, leaseInput());
        await recordPhaseCheckpoint(client, lease, {phase, state: "running"});
        let evidence;
        try {
          evidence = await operation();
        } catch (error) {
          await recordPhaseCheckpoint(client, lease, {
            phase,
            state: "failed",
            digest: sha256Digest({phase, reasonCode: error?.code ?? "deployment_rollback_phase_failed"}),
            reasonCode: error?.code ?? "deployment_rollback_phase_failed",
          });
          throw error;
        }
        await heartbeatOperationLease(client, lease, leaseInput());
        await recordPhaseCheckpoint(client, lease, {
          phase,
          state: "completed",
          digest: sha256Digest(evidence ?? {phase}),
          reasonCode: null,
        });
        return evidence;
      };

      const availability = await runPhase("preflight", () => preflight({
        lease,
        assertLease: () => heartbeatOperationLease(client, lease, leaseInput()),
      }));
      const decision = evaluateRollback({
        activeRelease: {
          ...records.active,
          previousReleaseId: records.previous.releaseId,
        },
        candidateRelease: release,
        availableProviderIdentities: availability.availableProviderIdentities,
        availableSecretRevisions: availability.availableSecretRevisions,
      });
      if (decision.outcome === "refused") {
        await recordPhaseCheckpoint(client, lease, {
          phase: "preflight",
          state: "failed",
          digest: sha256Digest(decision),
          reasonCode: decision.refusalReasons[0],
        });
        await completeOperationLease(client, lease);
        return decision;
      }

      const phaseEvidence = [];
      for (const action of decision.actions) {
        phaseEvidence.push(Object.freeze({
          phase: action.phase,
          evidence: await runPhase(action.phase, () => executePhase({lease, phase: action.phase})),
        }));
      }
      const mirrored = await mirrorReleaseRecords(client, lease, {
        active: records.previous,
        previous: records.active,
      });
      await completeOperationLease(client, lease);
      return Object.freeze({
        outcome: "succeeded",
        releaseId: release.releaseId,
        phases: Object.freeze(phaseEvidence),
        records: mirrored,
      });
    }, ClientClass)
  );
}
