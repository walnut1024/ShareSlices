import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresReleaseVerificationProbeInitializer,
} from "./release-verification-probe.mjs";

const lease = {
  installationId: "shareslices",
  operationId: "operation-1",
  owner: "controller-1",
  target: "cloudflare",
  desiredReleaseId: "release-1",
  fencingToken: 7,
};
const message = {
  nonce: "nonce-1234567890123456",
  releaseId: "release-1",
  fence: 7,
  subFence: 3,
  expected: {
    containers: [
      {
        containerClass: "thumbnail",
        stableSlot: "thumbnail-b",
        buildIdentity: "thumbnail-build",
        contractRevision: "thumbnail-contract",
        imageReference: "thumbnail@sha256:2",
      },
      {
        containerClass: "trusted-processing",
        stableSlot: "processing-a",
        buildIdentity: "processing-build",
        contractRevision: "processing-contract",
        imageReference: "processing@sha256:1",
      },
      {
        containerClass: "thumbnail",
        stableSlot: "thumbnail-a",
        buildIdentity: "thumbnail-build",
        contractRevision: "thumbnail-contract",
        imageReference: "thumbnail@sha256:2",
      },
    ],
  },
};

function harness({inserted = true, replayed = false} = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({sql, parameters});
      if (sql.startsWith("insert into")) {
        return {rowCount: inserted ? 1 : 0, rows: inserted ? [{nonce: message.nonce}] : []};
      }
      if (sql.startsWith("select nonce")) {
        return {rowCount: replayed ? 1 : 0, rows: replayed ? [{nonce: message.nonce}] : []};
      }
      return {rowCount: 0, rows: []};
    },
  };
  const initialize = createPostgresReleaseVerificationProbeInitializer({
    config: {target: "cloudflare"},
    resolvers: {},
    withControlClient: async (_config, _resolvers, operation) => operation(client),
  });
  return {calls, initialize};
}

test("initializes a probe only through the exact live deployment fence", async () => {
  const runtime = harness();
  assert.deepEqual(await runtime.initialize({lease, message}), {
    nonce: message.nonce,
    releaseId: message.releaseId,
    fence: 7,
    subFence: 3,
    state: "active",
  });
  const insertion = runtime.calls.find(({sql}) => sql.startsWith("insert into"));
  assert.match(insertion.sql, /operation\.lease_expires_at > now\(\)/);
  assert.match(insertion.sql, /operation\.target = 'cloudflare'/);
  assert.deepEqual(JSON.parse(insertion.parameters[7]), {
    containers: {
      thumbnail: {
        buildIdentity: "thumbnail-build",
        contractRevision: "thumbnail-contract",
        imageReference: "thumbnail@sha256:2",
        releaseId: "release-1",
        stableSlots: ["thumbnail-a", "thumbnail-b"],
      },
      "trusted-processing": {
        buildIdentity: "processing-build",
        contractRevision: "processing-contract",
        imageReference: "processing@sha256:1",
        releaseId: "release-1",
        stableSlots: ["processing-a"],
      },
    },
  });
  assert.equal(runtime.calls.at(-1).sql, "commit");
});

test("accepts only an exact active replay and rejects a conflicting nonce", async () => {
  const replay = harness({inserted: false, replayed: true});
  assert.equal((await replay.initialize({lease, message})).state, "active");
  assert.match(replay.calls[2].sql, /expected_identity = \$5::jsonb/);

  const conflict = harness({inserted: false, replayed: false});
  await assert.rejects(
    conflict.initialize({lease, message}),
    {code: "cloudflare_release_verification_probe_conflict"},
  );
  assert.equal(conflict.calls.at(-1).sql, "rollback");
});

test("rejects stale deployment scope and inconsistent class identity before SQL", async () => {
  const runtime = harness();
  await assert.rejects(
    runtime.initialize({
      lease: {...lease, fencingToken: 8},
      message,
    }),
    {code: "cloudflare_release_verification_probe_scope_invalid"},
  );
  await assert.rejects(
    runtime.initialize({
      lease,
      message: {
        ...message,
        expected: {
          containers: [
            ...message.expected.containers,
            {
              ...message.expected.containers[0],
              stableSlot: "thumbnail-c",
              buildIdentity: "another-build",
            },
          ],
        },
      },
    }),
    {code: "cloudflare_release_verification_probe_identity_invalid"},
  );
  assert.equal(runtime.calls.length, 0);
});
