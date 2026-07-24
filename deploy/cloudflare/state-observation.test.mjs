import assert from "node:assert/strict";
import test from "node:test";

import {createCloudflareStateObserver} from "./state-observation.mjs";

const config = {
  installationId: "installation-1",
  target: "cloudflare",
  cloudflare: {},
};

function resource(logicalId, owner, character) {
  return {
    logicalId,
    digest: `sha256:${character.repeat(64)}`,
    owner,
    retention: "active",
    providerIdentity: `${owner}-${character}`,
    ownershipMarkers: {
      installation: config.installationId,
      owner,
      release: "release-1",
    },
  };
}

test("combines independently revised PostgreSQL, Terraform, and Wrangler observations", async () => {
  const observer = createCloudflareStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-4"},
      releaseRecords: {active: {releaseId: "release-1"}},
      operation: {fence: 9},
    }),
    observeTerraform: async () => ({
      revision: "terraform-7",
      resources: [resource("cloudflare/r2/artifacts", "terraform", "a")],
    }),
    observeWrangler: async () => ({
      revision: "wrangler-12",
      resources: [resource("cloudflare/worker/application", "wrangler", "b")],
    }),
  });

  const first = await observer({config, release: {}, bundle: {}});
  const second = await observer({config, release: {}, bundle: {}});
  assert.deepEqual(second, first);
  assert.match(first.revision, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(first.sourceRevisions, {
    control: "control-4",
    terraform: "terraform-7",
    wrangler: "wrangler-12",
  });
  assert.deepEqual(first.resources.map(({logicalId}) => logicalId), [
    "cloudflare/r2/artifacts",
    "cloudflare/worker/application",
  ]);
  assert.equal(first.releaseRecords.active.releaseId, "release-1");
});

test("rejects incomplete source observations before returning partial state", async () => {
  const observer = createCloudflareStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-4"},
    }),
    observeTerraform: async () => ({revision: "terraform-7", resources: []}),
    observeWrangler: async () => null,
  });
  await assert.rejects(
    observer({config}),
    (error) => error.code === "cloudflare_wrangler_observation_invalid",
  );
});

test("rejects ownership conflicts, missing markers, and invalid desired-state digests", async () => {
  const control = async () => ({
    controlSchema: {state: "present", revision: "control-4"},
  });
  const duplicated = resource("cloudflare/worker/application", "terraform", "a");
  const conflicting = createCloudflareStateObserver({
    observeControl: control,
    observeTerraform: async () => ({revision: "terraform-7", resources: [duplicated]}),
    observeWrangler: async () => ({
      revision: "wrangler-12",
      resources: [{
        ...duplicated,
        owner: "wrangler",
        ownershipMarkers: {...duplicated.ownershipMarkers, owner: "wrangler"},
      }],
    }),
  });
  await assert.rejects(
    conflicting({config}),
    (error) => error.code === "cloudflare_resource_ownership_conflict",
  );

  const invalid = createCloudflareStateObserver({
    observeControl: control,
    observeTerraform: async () => ({
      revision: "terraform-7",
      resources: [{
        ...resource("cloudflare/r2/artifacts", "terraform", "a"),
        ownershipMarkers: {installation: "another-installation", owner: "terraform"},
      }],
    }),
    observeWrangler: async () => ({revision: "wrangler-12", resources: []}),
  });
  await assert.rejects(
    invalid({config}),
    (error) => error.code === "cloudflare_resource_ownership_unproven",
  );

  const invalidDigest = createCloudflareStateObserver({
    observeControl: control,
    observeTerraform: async () => ({
      revision: "terraform-7",
      resources: [{
        ...resource("cloudflare/r2/artifacts", "terraform", "a"),
        digest: "mutable",
      }],
    }),
    observeWrangler: async () => ({revision: "wrangler-12", resources: []}),
  });
  await assert.rejects(
    invalidDigest({config}),
    (error) => error.code === "cloudflare_terraform_resource_invalid",
  );
});
