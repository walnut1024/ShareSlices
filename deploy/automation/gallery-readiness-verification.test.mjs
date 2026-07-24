import assert from "node:assert/strict";
import test from "node:test";

import {
  GalleryReadinessVerificationError,
  verifyGalleryReadiness,
} from "./gallery-readiness-verification.mjs";

const releaseId = `sha256:${"a".repeat(64)}`;
const evidenceDigest = `sha256:${"b".repeat(64)}`;
const observedAt = "2026-07-25T10:00:00.000Z";
const authorization = {
  schemaVersion: "shareslices.gallery-readiness-authorization/v1",
  level: "pre_traffic",
  target: "kubernetes",
  releaseId,
};

test("enables Gallery only when every independent live gate passes", async () => {
  const calls = [];
  const result = await verifyGalleryReadiness({
    authorization,
    now: new Date(observedAt),
    observer: async (context) => {
      calls.push(context);
      return {outcome: "passed", observedAt, evidenceDigest};
    },
  });
  assert.equal(result.state, "passed");
  assert.equal(result.enabled, true);
  assert.deepEqual(
    result.results.map(({dimension}) => dimension),
    ["registrable-site", "credentials", "governance", "content", "network"],
  );
  assert.equal(calls.every(({releaseId: observed}) => observed === releaseId), true);
});

test("keeps Gallery disabled independently of core health when one gate fails", async () => {
  const result = await verifyGalleryReadiness({
    authorization,
    now: new Date(observedAt),
    observer: async ({dimension}) => ({
      outcome: dimension === "governance" ? "failed" : "passed",
      observedAt,
      evidenceDigest,
    }),
  });
  assert.equal(result.state, "failed");
  assert.equal(result.enabled, false);
  assert.equal(
    result.results.find(({dimension}) => dimension === "governance").reasonCode,
    "gallery_governance_unavailable",
  );
  assert.equal(Object.hasOwn(result, "core"), false);
});

test("fails closed on stale, malformed, or unavailable live evidence", async () => {
  for (const observer of [
    async () => ({outcome: "passed", observedAt: "2026-07-25T09:58:59.999Z", evidenceDigest}),
    async () => ({outcome: "passed", observedAt, evidenceDigest: "provider-detail"}),
    async () => {
      throw new Error("provider secret");
    },
  ]) {
    const result = await verifyGalleryReadiness({
      authorization,
      now: new Date(observedAt),
      observer,
    });
    assert.equal(result.state, "indeterminate");
    assert.equal(result.enabled, false);
    assert.equal(JSON.stringify(result).includes("provider secret"), false);
  }
});

test("rejects core or unbound authorization before observing a target", async () => {
  for (const candidate of [
    {...authorization, level: "core"},
    {...authorization, releaseId: "mutable"},
    {...authorization, target: "compose"},
  ]) {
    let called = false;
    await assert.rejects(
      verifyGalleryReadiness({
        authorization: candidate,
        observer: async () => {
          called = true;
        },
      }),
      (error) =>
        error instanceof GalleryReadinessVerificationError &&
        error.code === "gallery_readiness_authorization_invalid",
    );
    assert.equal(called, false);
  }
});
