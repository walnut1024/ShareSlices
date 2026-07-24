import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareStateMirrorError,
  mirrorCloudflareDeploymentState,
} from "./r2-state-mirror.mjs";

const lease = Object.freeze({operationId: "apply-release-a", fencingToken: 7});

function input(overrides = {}) {
  return {
    installationId: "example-cloudflare",
    lease,
    records: {active: {releaseId: `sha256:${"a".repeat(64)}`}, previous: null},
    controlRevision: 3,
    assertLease: async () => undefined,
    bucket: {
      get: async () => null,
      put: async () => ({etag: "etag-new"}),
    },
    ...overrides,
  };
}

test("first create uses wildcard exclusion and returns only Secret-free evidence", async () => {
  const writes = [];
  const result = await mirrorCloudflareDeploymentState(input({
    bucket: {
      get: async () => null,
      put: async (...args) => {
        writes.push(args);
        return {etag: "etag-created"};
      },
    },
  }));
  assert.equal(result.outcome, "updated");
  assert.deepEqual(writes[0][2].onlyIf, {etagDoesNotMatch: "*"});
  assert.equal(writes[0][2].httpMetadata.cacheControl, "no-store");
  assert.equal(writes[0][1].includes("secret://"), false);
});

test("existing state advances only through its exact ETag and fencing order", async () => {
  const existing = {
    schemaVersion: "shareslices.cloudflare-deployment-state/v1",
    installationId: "example-cloudflare",
    fencingToken: 6,
    operationId: "apply-release-previous",
    controlRevision: 2,
    records: {active: null, previous: null},
  };
  const writes = [];
  const result = await mirrorCloudflareDeploymentState(input({
    bucket: {
      get: async () => ({etag: "etag-old", text: async () => JSON.stringify(existing)}),
      put: async (...args) => {
        writes.push(args);
        return {etag: "etag-next"};
      },
    },
  }));
  assert.equal(result.outcome, "updated");
  assert.deepEqual(writes[0][2].onlyIf, {etagMatches: "etag-old"});
});

test("lease loss between read and write prevents the conditional mutation", async () => {
  let checks = 0;
  let writes = 0;
  await assert.rejects(
    mirrorCloudflareDeploymentState(input({
      assertLease: async () => {
        checks += 1;
        if (checks === 2) throw new Error("lease_lost");
      },
      bucket: {
        get: async () => null,
        put: async () => {
          writes += 1;
          return {etag: "must-not-write"};
        },
      },
    })),
    /lease_lost/,
  );
  assert.equal(writes, 0);
});

test("concurrent first create and ambiguous writes require reconciliation without retry", async () => {
  let attempts = 0;
  await assert.rejects(
    mirrorCloudflareDeploymentState(input({
      bucket: {
        get: async () => null,
        put: async () => {
          attempts += 1;
          return null;
        },
      },
    })),
    (error) => error instanceof CloudflareStateMirrorError &&
      error.code === "cloudflare_state_mirror_precondition_failed",
  );
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(
    mirrorCloudflareDeploymentState(input({
      bucket: {
        get: async () => null,
        put: async () => {
          attempts += 1;
          throw new Error("response_lost");
        },
      },
    })),
    (error) => error instanceof CloudflareStateMirrorError &&
      error.code === "cloudflare_state_mirror_write_indeterminate",
  );
  assert.equal(attempts, 1);
});

test("a newer mirror fence refuses an old operation before writing", async () => {
  const newer = {
    schemaVersion: "shareslices.cloudflare-deployment-state/v1",
    installationId: "example-cloudflare",
    fencingToken: 8,
    operationId: "new-owner",
    controlRevision: 4,
    records: {},
  };
  await assert.rejects(
    mirrorCloudflareDeploymentState(input({
      bucket: {
        get: async () => ({etag: "etag-newer", text: async () => JSON.stringify(newer)}),
        put: async () => {
          throw new Error("must not write");
        },
      },
    })),
    (error) => error instanceof CloudflareStateMirrorError &&
      error.code === "cloudflare_state_mirror_stale_fence",
  );
});
