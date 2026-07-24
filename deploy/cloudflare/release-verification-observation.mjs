import {createHash} from "node:crypto";

import {canonicalize} from "../automation/canonical.mjs";
import {withPostgresControlClient} from "../automation/control-observation.mjs";
import {CloudflareReleaseVerificationError} from "./release-verification-executor.mjs";

const DEFAULT_ATTEMPTS = 120;
const DEFAULT_INTERVAL_MILLISECONDS = 1_000;

function fail(code, message) {
  throw new CloudflareReleaseVerificationError(code, message);
}

function canonicalContainers(containers) {
  if (!Array.isArray(containers)) return null;
  const projected = containers.map((container) => ({
    containerClass: container?.containerClass,
    stableSlot: container?.stableSlot,
    buildIdentity: container?.buildIdentity,
    contractRevision: container?.contractRevision,
    imageReference: container?.imageReference,
  }));
  return projected.sort((left, right) =>
    `${left?.containerClass}\0${left?.stableSlot}`.localeCompare(
      `${right?.containerClass}\0${right?.stableSlot}`,
    )
  );
}

function requireExpectedEvidence(evidence, message) {
  const actualContainers = canonicalContainers(evidence?.containers);
  const expectedContainers = canonicalContainers(message.expected?.containers);
  const actualProviderInstances = Array.isArray(evidence?.containers)
    ? evidence.containers.map(({providerInstance}) => providerInstance).sort()
    : null;
  const expectedProviderInstances = Array.isArray(message.providerInstances)
    ? [...message.providerInstances].sort()
    : null;
  if (
    !evidence ||
    evidence.version !== 1 ||
    evidence.containerConvergence !== "verified" ||
    evidence.scope?.nonce !== message.nonce ||
    evidence.scope?.releaseId !== message.releaseId ||
    evidence.scope?.fence !== message.fence ||
    evidence.scope?.subFence !== message.subFence ||
    evidence.jobsWorker?.versionId !== message.expected?.jobsWorker?.versionId ||
    evidence.jobsWorker?.releaseBundleIdentity !==
      message.expected?.jobsWorker?.releaseBundleIdentity ||
    evidence.jobsWorker?.configurationDigest !==
      message.expected?.jobsWorker?.configurationDigest ||
    evidence.jobsWorker?.exportsDigest !==
      message.expected?.jobsWorker?.exportsDigest ||
    JSON.stringify(evidence.entryWorkers) !== JSON.stringify({
      application: message.expected?.appWorker,
      content: message.expected?.contentWorker,
    }) ||
    evidence.migrationHead !== message.expected?.migrationHead ||
    evidence.configuredContainerImages?.trustedProcessing !==
      message.expected?.configuredContainerImages?.trustedProcessing ||
    evidence.configuredContainerImages?.thumbnail !==
      message.expected?.configuredContainerImages?.thumbnail ||
    !actualContainers ||
    !expectedContainers ||
    !actualProviderInstances ||
    !expectedProviderInstances ||
    actualProviderInstances.some((identity) =>
      typeof identity !== "string" || identity.length === 0
    ) ||
    new Set(actualProviderInstances).size !== actualProviderInstances.length ||
    JSON.stringify(actualProviderInstances) !==
      JSON.stringify(expectedProviderInstances) ||
    JSON.stringify(actualContainers) !== JSON.stringify(expectedContainers)
  ) {
    fail(
      "cloudflare_release_verification_terminal_identity_mismatch",
      "Release verification terminal evidence does not match the authorized identity.",
    );
  }
}

function requireDigest(snapshot) {
  const serialized = JSON.stringify(canonicalize(snapshot.terminalEvidence));
  const actualDigest =
    `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  if (
    !/^sha256:[a-f0-9]{64}$/.test(snapshot.evidenceDigest ?? "") ||
    actualDigest !== snapshot.evidenceDigest
  ) {
    fail(
      "cloudflare_release_verification_terminal_digest_mismatch",
      "Release verification terminal evidence does not match its durable digest.",
    );
  }
}

export function projectTerminalObservation(snapshot, message, observedAt) {
  if (!snapshot) return null;
  if (
    snapshot.nonce !== message.nonce ||
    snapshot.releaseId !== message.releaseId ||
    snapshot.fence !== message.fence
  ) {
    fail(
      "cloudflare_release_verification_terminal_scope_mismatch",
      "Release verification terminal state belongs to another operation.",
    );
  }
  if (snapshot.state !== "terminal") return null;
  if (snapshot.terminalInvocationId !== message.invocationId) {
    fail(
      "cloudflare_release_verification_terminal_invocation_mismatch",
      "Release verification terminal state belongs to another invocation.",
    );
  }
  if (snapshot.subFence !== message.subFence + 1) {
    fail(
      "cloudflare_release_verification_terminal_fence_mismatch",
      "Release verification terminal state has an unexpected sub-fence.",
    );
  }
  if (snapshot.tombstoneRetained !== true) {
    fail(
      "cloudflare_release_verification_tombstone_expired",
      "Release verification terminal tombstone expired before observation completed.",
    );
  }
  requireDigest(snapshot);
  requireExpectedEvidence(snapshot.terminalEvidence, message);
  return Object.freeze({
    terminal: true,
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: message.fence,
    subFence: message.subFence,
    outcome: "passed",
    observedAt,
  });
}

export function projectCleanupObservation(snapshot, message, observedAt) {
  const terminal = projectTerminalObservation(snapshot, message, observedAt);
  if (!terminal) return null;
  if (snapshot.cleanupState !== "complete") return null;
  if (
    snapshot.quiescenceReached !== true ||
    snapshot.tombstoneRetained !== true ||
    snapshot.activeInvocations !== 0 ||
    snapshot.containerEvidence !== 0 ||
    !Array.isArray(snapshot.resources) ||
    snapshot.resources.some(({state}) => state !== "deleted")
  ) {
    fail(
      "cloudflare_release_verification_cleanup_identity_mismatch",
      "Release verification cleanup has not removed every nonce-owned resource.",
    );
  }
  return Object.freeze({
    terminal: true,
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: message.fence,
    cleanupState: "complete",
    quiescenceReached: true,
    activeInvocations: 0,
    tombstoneRetained: true,
    observedAt,
  });
}

export function createPostgresReleaseVerificationReader({
  config,
  resolvers,
  ClientClass,
  withControlClient = withPostgresControlClient,
} = {}) {
  return async ({nonce, releaseId, fence}) => withControlClient(
    config,
    resolvers,
    async (client) => {
      await client.query("begin transaction isolation level repeatable read read only");
      try {
        const probe = await client.query(
          `select nonce, release_id, fence, sub_fence, state,
                  terminal_invocation_id,
                  evidence_digest, terminal_evidence, cleanup_state,
                  coalesce(quiescence_not_before <= now(), false)
                    as quiescence_reached,
                  coalesce(tombstone_until > now(), false)
                    as tombstone_retained
             from cloudflare_release_verification_probe
            where nonce = $1 and release_id = $2 and fence = $3`,
          [nonce, releaseId, fence],
        );
        if (probe.rowCount !== 1) {
          await client.query("commit");
          return null;
        }
        const invocations = await client.query(
          `select count(*)::text as count
             from cloudflare_release_verification_invocation
            where nonce = $1 and state = 'active'
              and lease_expires_at > now()`,
          [nonce],
        );
        const containers = await client.query(
          `select count(*)::text as count
             from cloudflare_release_verification_container_evidence
            where nonce = $1`,
          [nonce],
        );
        const resources = await client.query(
          `select resource_kind, resource_key, state
             from cloudflare_release_verification_resource
            where nonce = $1
            order by resource_kind, resource_key`,
          [nonce],
        );
        await client.query("commit");
        const row = probe.rows[0];
        return Object.freeze({
          nonce: row.nonce,
          releaseId: row.release_id,
          fence: Number(row.fence),
          subFence: Number(row.sub_fence),
          state: row.state,
          terminalInvocationId: row.terminal_invocation_id,
          evidenceDigest: row.evidence_digest,
          terminalEvidence: row.terminal_evidence,
          cleanupState: row.cleanup_state,
          quiescenceReached: row.quiescence_reached,
          tombstoneRetained: row.tombstone_retained,
          activeInvocations: Number(invocations.rows[0]?.count ?? "0"),
          containerEvidence: Number(containers.rows[0]?.count ?? "0"),
          resources: Object.freeze(resources.rows.map((resource) => Object.freeze({
            kind: resource.resource_kind,
            key: resource.resource_key,
            state: resource.state,
          }))),
        });
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    },
    ClientClass,
  );
}

export function createReleaseVerificationObservers({
  readSnapshot,
  attempts = DEFAULT_ATTEMPTS,
  intervalMilliseconds = DEFAULT_INTERVAL_MILLISECONDS,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => new Date(),
  assertLease = async () => undefined,
  readProviderInstances,
} = {}) {
  if (typeof readSnapshot !== "function") {
    throw new TypeError("Release verification observation requires a database reader.");
  }
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new TypeError("Release verification observation attempts must be positive.");
  }
  if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 0) {
    throw new TypeError("Release verification observation interval is invalid.");
  }
  if (typeof readProviderInstances !== "function") {
    throw new TypeError(
      "Release verification observation requires a Container instance reader.",
    );
  }
  const poll = async (message, project, timeoutCode) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await assertLease();
      const snapshot = await readSnapshot(message);
      const providerInstances = snapshot?.state === "terminal"
        ? await readProviderInstances({
          message,
          terminalEvidence: snapshot.terminalEvidence,
        })
        : [];
      const projected = project(
        snapshot,
        {...message, providerInstances},
        now().toISOString(),
      );
      if (projected) return projected;
      if (attempt < attempts) await sleep(intervalMilliseconds);
    }
    fail(timeoutCode, "Release verification observation did not converge in time.");
  };
  return Object.freeze({
    observeUntilTerminal: (message) => poll(
      message,
      projectTerminalObservation,
      "cloudflare_release_verification_terminal_timeout",
    ),
    observeUntilCleanup: (message) => poll(
      message,
      projectCleanupObservation,
      "cloudflare_release_verification_cleanup_timeout",
    ),
  });
}
