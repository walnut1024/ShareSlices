import {
  acquireOperationLease,
  completeOperationLease,
  mirrorReleaseRecords,
  recordPhaseCheckpoint,
} from "./control-store.mjs";
import {withPostgresControlClient} from "./control-observation.mjs";
import {sha256Digest} from "./canonical.mjs";

function operationIdentity(releaseId) {
  return `verify-${releaseId.slice("sha256:".length, "sha256:".length + 32)}`;
}

function databaseRecord(row) {
  if (!row) return null;
  return {
    target: row.target,
    releaseId: row.release_id,
    bundleDigest: row.bundle_digest,
    configurationDigest: row.configuration_digest,
    secretRevisions: row.secret_revisions,
    compatibility: row.compatibility,
    contractRevisions: row.contract_revisions,
  };
}

export function createProductionReleaseFinalizer({
  resolvers,
  owner,
  now = () => new Date(),
  leaseSeconds = 120,
  ClientClass,
  withControlClient = withPostgresControlClient,
} = {}) {
  if (typeof owner !== "string" || owner.length === 0) {
    throw new TypeError("A deployment principal is required for release finalization.");
  }
  return async ({config, release, bundleDigest, verification}) => {
    if (verification?.outcome !== "passed") {
      throw new TypeError("Only a passed verification can finalize a release.");
    }
    return withControlClient(config, resolvers, async (client) => {
      const current = now();
      const lease = {
        ...(await acquireOperationLease(client, {
          installationId: config.installationId,
          target: config.target,
          operationId: operationIdentity(release.releaseId),
          releaseId: release.releaseId,
          owner,
          now: current,
          leaseExpiresAt: new Date(current.getTime() + leaseSeconds * 1000),
        })),
        installationId: config.installationId,
        target: config.target,
        owner,
      };
      const existing = await client.query(
        `select slot, target, release_id, bundle_digest, configuration_digest, secret_revisions,
                compatibility, contract_revisions
           from shareslices_deployment_release_record
          where installation_id = $1`,
        [config.installationId],
      );
      const existingBySlot = new Map(existing.rows.map((row) => [row.slot, row]));
      const active = {
        target: config.target,
        releaseId: release.releaseId,
        bundleDigest,
        configurationDigest: release.configurationDigest,
        secretRevisions: release.secretRevisions,
        compatibility: release.compatibility,
        contractRevisions: release.contractRevisions,
      };
      const previous = existingBySlot.get("active")?.release_id === active.releaseId
        ? databaseRecord(existingBySlot.get("previous"))
        : databaseRecord(existingBySlot.get("active"));
      await recordPhaseCheckpoint(client, lease, {
        phase: "verification",
        state: "completed",
        digest: sha256Digest(verification),
        reasonCode: null,
      });
      const records = await mirrorReleaseRecords(client, lease, {
        active,
        previous,
      });
      await completeOperationLease(client, lease);
      return Object.freeze({lease, records});
    }, ClientClass);
  };
}
