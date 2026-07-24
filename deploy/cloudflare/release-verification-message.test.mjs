import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloudflareReleaseVerificationMessage,
} from "./release-verification-message.mjs";

const releaseId = `sha256:${"a".repeat(64)}`;
const input = {
  lease: {
    installationId: "shareslices",
    operationId: "operation-1",
    target: "cloudflare",
    desiredReleaseId: releaseId,
    fencingToken: 7,
  },
  lifecycle: {
    tombstoneSeconds: 345_660,
    quiescenceSeconds: 660,
  },
  appWorker: {name: "shareslices-app", versionId: "app-version"},
  contentWorker: {
    name: "shareslices-content",
    versionId: "content-version",
  },
  jobsWorker: {
    versionId: "jobs-version",
    releaseBundleIdentity: `sha256:${"b".repeat(64)}`,
    configurationDigest: `sha256:${"c".repeat(64)}`,
    exportsDigest: `sha256:${"d".repeat(64)}`,
  },
  migrationHead: "0042_cloudflare_release_verification_terminal_invocation.sql",
  containerClasses: {
    "trusted-processing": {
      releaseId,
      buildIdentity: "processing-build",
      contractRevision: "processing-contract",
      imageReference: "registry.example/processing@sha256:1",
      stableSlots: ["processing-b", "processing-a"],
    },
    thumbnail: {
      releaseId,
      buildIdentity: "thumbnail-build",
      contractRevision: "thumbnail-contract",
      imageReference: "registry.example/thumbnail@sha256:2",
      stableSlots: ["thumbnail-a"],
    },
  },
};

test("builds one deterministic exact verification message from release checkpoints", () => {
  const first = buildCloudflareReleaseVerificationMessage(input);
  const second = buildCloudflareReleaseVerificationMessage(structuredClone(input));
  assert.deepEqual(first, second);
  assert.match(first.nonce, /^nonce_[a-f0-9]{64}$/);
  assert.match(first.invocationId, /^invocation_[a-f0-9]{64}$/);
  assert.equal(first.releaseId, releaseId);
  assert.equal(first.fence, 7);
  assert.equal(first.subFence, 1);
  assert.deepEqual(first.expected.containers.map(
    ({containerClass, stableSlot}) => `${containerClass}:${stableSlot}`,
  ), [
    "thumbnail:thumbnail-a",
    "trusted-processing:processing-a",
    "trusted-processing:processing-b",
  ]);
  assert.deepEqual(first.expected.configuredContainerImages, {
    trustedProcessing: "registry.example/processing@sha256:1",
    thumbnail: "registry.example/thumbnail@sha256:2",
  });
  assert.equal(JSON.stringify(first).includes("providerInstance"), false);
  assert.equal(Object.isFrozen(first.expected.containers), true);
  assert.equal(Object.isFrozen(first.expected.containers[0]), true);
});

test("changes deterministic scope identity when the operation fence changes", () => {
  const first = buildCloudflareReleaseVerificationMessage(input);
  const second = buildCloudflareReleaseVerificationMessage({
    ...input,
    lease: {...input.lease, fencingToken: 8},
  });
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.invocationId, second.invocationId);
});

test("rejects invalid lifecycle, aliased Workers, and inconsistent Containers", () => {
  for (const [override, code] of [
    [
      {lifecycle: {...input.lifecycle, quiescenceSeconds: 700}},
      "cloudflare_release_verification_message_lifecycle_invalid",
    ],
    [
      {contentWorker: {...input.contentWorker, name: input.appWorker.name}},
      "cloudflare_release_verification_message_invalid",
    ],
    [
      {
        containerClasses: {
          ...input.containerClasses,
          thumbnail: {
            ...input.containerClasses.thumbnail,
            releaseId: "another-release",
          },
        },
      },
      "cloudflare_release_verification_message_invalid",
    ],
  ]) {
    assert.throws(
      () => buildCloudflareReleaseVerificationMessage({...input, ...override}),
      {code},
    );
  }
});
