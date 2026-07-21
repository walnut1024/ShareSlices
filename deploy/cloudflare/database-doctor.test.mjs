import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseCloudflareDatabase } from "./database-doctor.mjs";

const probe = (evidenceId) => ({ passed: true, evidenceId });
const qualified = (overrides = {}) => ({
  reachable: true,
  tlsMode: "verify-full",
  caCertificateId: "ca-region-1",
  positiveRuntimeProbe: probe("positive-1"),
  negativeIdentityProbe: probe("wrong-host-1"),
  ...overrides,
});

function observation(overrides = {}) {
  return {
    hyperdrive: qualified({ queryCacheDisabled: true }),
    requiredDirectRoles: ["migration"],
    directConnections: [qualified({ role: "migration" })],
    ...overrides,
  };
}

test("accepts cache-disabled Hyperdrive and every required direct path only with runtime identity evidence", () => {
  assert.deepEqual(diagnoseCloudflareDatabase(observation()), [
    { id: "cloudflare-hyperdrive-reachable", state: "available" },
    { id: "cloudflare-hyperdrive-cache-disabled", state: "available" },
    { id: "cloudflare-hyperdrive-origin-identity", state: "available" },
    { id: "cloudflare-direct-postgresql:migration", state: "available" },
  ]);
});

test("rejects require, encryption-only, and control-plane-only Hyperdrive evidence", () => {
  for (const hyperdrive of [
    qualified({ queryCacheDisabled: true, tlsMode: "require" }),
    qualified({ queryCacheDisabled: true, positiveRuntimeProbe: undefined }),
    qualified({ queryCacheDisabled: true, negativeIdentityProbe: undefined }),
    qualified({ queryCacheDisabled: true, caCertificateId: undefined }),
  ]) {
    const check = diagnoseCloudflareDatabase(observation({ hyperdrive }))
      .find(({ id }) => id === "cloudflare-hyperdrive-origin-identity");
    assert.deepEqual(check, {
      id: "cloudflare-hyperdrive-origin-identity",
      state: "unavailable",
      reasonCode: "cloudflare_hyperdrive_origin_identity_unqualified",
    });
  }
});

test("rejects enabled or unknown Hyperdrive cache behavior", () => {
  for (const queryCacheDisabled of [false, undefined]) {
    const checks = diagnoseCloudflareDatabase(observation({
      hyperdrive: qualified({ queryCacheDisabled }),
    }));
    assert.equal(
      checks.some(({ reasonCode }) => reasonCode === "cloudflare_hyperdrive_cache_not_proven_disabled"),
      true,
    );
  }
});

test("fails closed for absent, omitted, or partially qualified direct connection evidence", () => {
  assert.equal(
    diagnoseCloudflareDatabase(observation({ requiredDirectRoles: [] }))[3].reasonCode,
    "cloudflare_direct_postgresql_evidence_missing",
  );
  const omitted = diagnoseCloudflareDatabase(observation({
    requiredDirectRoles: ["migration", "trusted-processing"],
  }));
  assert.deepEqual(omitted[4], {
    id: "cloudflare-direct-postgresql:trusted-processing",
    state: "unavailable",
    reasonCode: "cloudflare_direct_postgresql_unqualified",
  });
  const checks = diagnoseCloudflareDatabase(observation({
    requiredDirectRoles: ["processing"],
    directConnections: [qualified({ role: "processing", negativeIdentityProbe: undefined })],
  }));
  assert.deepEqual(checks[3], {
    id: "cloudflare-direct-postgresql:processing",
    state: "unavailable",
    reasonCode: "cloudflare_direct_postgresql_unqualified",
  });
});

test("accepts only a named, currently evidenced qualified equivalent", () => {
  const equivalent = qualified({
    tlsMode: "qualified-equivalent",
    caCertificateId: undefined,
    qualificationId: "workers-vpc-verify-full-contract-v1",
  });
  const checks = diagnoseCloudflareDatabase(observation({
    hyperdrive: { ...equivalent, queryCacheDisabled: true },
    requiredDirectRoles: ["processing"],
    directConnections: [{ ...equivalent, role: "processing" }],
  }));
  assert.equal(checks.every(({ state }) => state === "available"), true);
});
