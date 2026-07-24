import assert from "node:assert/strict";
import test from "node:test";

import {createHash} from "node:crypto";

import {canonicalize} from "../automation/canonical.mjs";
import {
  createPostgresReleaseVerificationReader,
  createReleaseVerificationObservers,
  projectCleanupObservation,
  projectTerminalObservation,
} from "./release-verification-observation.mjs";

const message = Object.freeze({
  nonce: "nonce-1234567890123456",
  releaseId: "release-1",
  fence: 7,
  subFence: 9,
  expected: {
    jobsWorker: {
      versionId: "jobs-version",
      releaseBundleIdentity: "release-bundle",
      configurationDigest: "configuration",
      exportsDigest: "exports",
    },
    migrationHead: "0042_cloudflare_release_verification_terminal_invocation.sql",
    configuredContainerImages: {
      trustedProcessing: "registry.example/trusted@sha256:1",
      thumbnail: "registry.example/thumbnail@sha256:2",
    },
    containers: [
      {
        containerClass: "thumbnail",
        stableSlot: "thumbnail-a",
        providerInstance: "provider-thumbnail",
        buildIdentity: "thumbnail-build",
        contractRevision: "thumbnail-contract",
        imageReference: "registry.example/thumbnail@sha256:2",
      },
      {
        containerClass: "trusted-processing",
        stableSlot: "processing-a",
        providerInstance: "provider-processing",
        buildIdentity: "processing-build",
        contractRevision: "processing-contract",
        imageReference: "registry.example/trusted@sha256:1",
      },
    ],
  },
});

const terminalEvidence = Object.freeze({
  version: 1,
  scope: {
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: message.fence,
    subFence: message.subFence,
  },
  jobsWorker: message.expected.jobsWorker,
  migrationHead: message.expected.migrationHead,
  configuredContainerImages: message.expected.configuredContainerImages,
  containerConvergence: "verified",
  containers: [...message.expected.containers].reverse(),
});

function snapshot(overrides = {}) {
  const serialized = JSON.stringify(canonicalize(terminalEvidence));
  return {
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: message.fence,
    subFence: message.subFence + 1,
    state: "terminal",
    terminalInvocationId: message.invocationId,
    evidenceDigest:
      `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`,
    terminalEvidence,
    cleanupState: "quiescing",
    quiescenceReached: false,
    tombstoneRetained: true,
    activeInvocations: 0,
    containerEvidence: 2,
    resources: [],
    ...overrides,
  };
}

test("projects only exact digest-verified terminal evidence", () => {
  assert.deepEqual(
    projectTerminalObservation(snapshot(), message, "2026-07-24T00:00:00.000Z"),
    {
      terminal: true,
      nonce: message.nonce,
      releaseId: message.releaseId,
      fence: message.fence,
      subFence: message.subFence,
      outcome: "passed",
      observedAt: "2026-07-24T00:00:00.000Z",
    },
  );
  assert.throws(
    () => projectTerminalObservation(
      snapshot({evidenceDigest: `sha256:${"0".repeat(64)}`}),
      message,
      "2026-07-24T00:00:00.000Z",
    ),
    {code: "cloudflare_release_verification_terminal_digest_mismatch"},
  );
  assert.throws(
    () => projectTerminalObservation(
      snapshot({subFence: message.subFence + 2}),
      message,
      "2026-07-24T00:00:00.000Z",
    ),
    {code: "cloudflare_release_verification_terminal_fence_mismatch"},
  );
  assert.throws(
    () => projectTerminalObservation(
      snapshot({terminalInvocationId: "another-invocation"}),
      message,
      "2026-07-24T00:00:00.000Z",
    ),
    {code: "cloudflare_release_verification_terminal_invocation_mismatch"},
  );
  assert.throws(
    () => projectTerminalObservation(
      snapshot({tombstoneRetained: false}),
      message,
      "2026-07-24T00:00:00.000Z",
    ),
    {code: "cloudflare_release_verification_tombstone_expired"},
  );
});

test("requires complete quiescent cleanup with no nonce-owned residue", () => {
  const complete = snapshot({
    cleanupState: "complete",
    quiescenceReached: true,
    containerEvidence: 0,
    resources: [
      {kind: "database", key: `release-verification/${message.nonce}/db`, state: "deleted"},
      {kind: "r2", key: `release-verification/${message.nonce}/object`, state: "deleted"},
    ],
  });
  assert.equal(
    projectCleanupObservation(
      complete,
      message,
      "2026-07-24T00:00:00.000Z",
    )?.cleanupState,
    "complete",
  );
  assert.throws(
    () => projectCleanupObservation(
      {...complete, resources: [{kind: "r2", key: "owned", state: "committed"}]},
      message,
      "2026-07-24T00:00:00.000Z",
    ),
    {code: "cloudflare_release_verification_cleanup_identity_mismatch"},
  );
});

test("polling is bounded, lease-checked, and retries read-only pending state", async () => {
  let reads = 0;
  let leases = 0;
  const observers = createReleaseVerificationObservers({
    readSnapshot: async () => {
      reads += 1;
      return reads === 1
        ? snapshot({state: "active", terminalInvocationId: null})
        : snapshot();
    },
    attempts: 2,
    intervalMilliseconds: 0,
    sleep: async () => undefined,
    assertLease: async () => {
      leases += 1;
    },
    now: () => new Date("2026-07-24T00:00:00.000Z"),
  });
  assert.equal((await observers.observeUntilTerminal(message)).outcome, "passed");
  assert.equal(reads, 2);
  assert.equal(leases, 2);

  const timedOut = createReleaseVerificationObservers({
    readSnapshot: async () => null,
    attempts: 1,
    intervalMilliseconds: 0,
  });
  await assert.rejects(
    timedOut.observeUntilTerminal(message),
    {code: "cloudflare_release_verification_terminal_timeout"},
  );
});

test("PostgreSQL reader uses one repeatable read snapshot and projects counts", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("select nonce")) {
        return {rowCount: 1, rows: [{
          nonce: message.nonce,
          release_id: message.releaseId,
          fence: "7",
          sub_fence: "10",
          state: "terminal",
          terminal_invocation_id: message.invocationId,
          evidence_digest: snapshot().evidenceDigest,
          terminal_evidence: terminalEvidence,
          cleanup_state: "complete",
          quiescence_reached: true,
          tombstone_retained: true,
        }]};
      }
      if (sql.includes("release_verification_invocation")) {
        return {rows: [{count: "0"}]};
      }
      if (sql.includes("container_evidence")) {
        return {rows: [{count: "0"}]};
      }
      if (sql.startsWith("select resource_kind")) {
        return {rows: [{resource_kind: "r2", resource_key: "key", state: "deleted"}]};
      }
      return {rows: []};
    },
  };
  const read = createPostgresReleaseVerificationReader({
    config: {target: "cloudflare"},
    resolvers: {},
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  const result = await read(message);
  assert.equal(result.cleanupState, "complete");
  assert.equal(result.resources[0].state, "deleted");
  assert.match(calls[0], /repeatable read read only/);
  assert.equal(calls.at(-1), "commit");
});
