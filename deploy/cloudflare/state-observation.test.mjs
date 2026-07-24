import assert from "node:assert/strict";
import test from "node:test";

import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
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

test("projects completed migration and exact active release verification from PostgreSQL", async () => {
  const release = {
    releaseId: `sha256:${"d".repeat(64)}`,
  };
  const migration = {
    logicalId: "deployment-control/migrations/0030.sql",
    phase: "migration",
    owner: "deployment-module",
    retention: "active",
    securitySensitive: true,
    desired: {schemaHead: "0030.sql"},
    digest: `sha256:${"a".repeat(64)}`,
  };
  const verification = {
    logicalId: `deployment-control/release-verification/${release.releaseId}`,
    phase: "verification",
    owner: "deployment-module",
    retention: "active",
    securitySensitive: true,
    desired: {},
    digest: `sha256:${"b".repeat(64)}`,
  };
  const bundle = {
    target: "cloudflare",
    releaseId: release.releaseId,
    configurationDigest: `sha256:${"c".repeat(64)}`,
    phases: [
      {id: "migration", resources: [migration]},
      {id: "verification", resources: [verification]},
    ],
  };
  const bundleDigest = serializeCanonicalTargetBundle(bundle).digest;
  const observer = createCloudflareStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-9"},
      databaseSchemaHead: "0030.sql",
      releaseRecords: {
        active: {
          target: "cloudflare",
          releaseId: release.releaseId,
          bundleDigest,
          configurationDigest: bundle.configurationDigest,
          operationId: "operation-1",
          fencingToken: 12,
        },
      },
    }),
    observeTerraform: async () => ({revision: "terraform-1", resources: []}),
    observeWrangler: async () => ({revision: "wrangler-1", resources: []}),
  });
  const result = await observer({config, release, bundle});
  assert.deepEqual(
    result.resources.map(({logicalId}) => logicalId),
    [migration.logicalId, verification.logicalId],
  );
  assert.equal(result.resources.every(({owner}) => owner === "deployment-module"), true);
  assert.deepEqual(result.resources[0].providerIdentity, {
    schemaHead: "0030.sql",
    source: "postgresql",
  });
  assert.deepEqual(result.resources[1].providerIdentity, {
    operationId: "operation-1",
    fencingToken: 12,
  });
});

test("does not project migration or verification from mismatched control evidence", async () => {
  const bundle = {
    target: "cloudflare",
    releaseId: "release-1",
    configurationDigest: "configuration-1",
    phases: [{
      id: "migration",
      resources: [{
        logicalId: "migration",
        phase: "migration",
        owner: "deployment-module",
        retention: "active",
        desired: {schemaHead: "expected"},
        digest: `sha256:${"a".repeat(64)}`,
      }],
    }],
  };
  const observer = createCloudflareStateObserver({
    observeControl: async () => ({
      controlSchema: {state: "present", revision: "control-10"},
      databaseSchemaHead: "other",
      releaseRecords: {},
    }),
    observeTerraform: async () => ({revision: "terraform-1", resources: []}),
    observeWrangler: async () => ({revision: "wrangler-1", resources: []}),
  });
  const result = await observer({config, release: {releaseId: "release-1"}, bundle});
  assert.deepEqual(result.resources, []);
});
