import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {renderCloudflareBundle} from "./render.mjs";
import {
  cloudflareDeploymentMarker,
  createCloudflareWranglerObserver,
} from "./wrangler-observation.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));
const releaseFixture = JSON.parse(await readFile(
  new URL("../contract/fixtures/release.valid.json", import.meta.url),
  "utf8",
));
const release = {
  ...releaseFixture,
  artifacts: [
    ["app-worker-bundle", "worker-bundle"],
    ["content-worker-bundle", "worker-bundle"],
    ["jobs-worker-bundle", "worker-bundle"],
    ["static-assets", "static-assets"],
    ["trusted-processing-image", "oci-image"],
    ["thumbnail-image", "oci-image"],
  ].map(([name, artifactKind], index) => {
    const contentDigest = `sha256:${String(index + 1).repeat(64)}`;
    return {
      name,
      artifactKind,
      ...(artifactKind === "oci-image" ? {platforms: ["linux/amd64"]} : {}),
      contentDigest,
      providerIdentity: {
        kind: "digest",
        value: contentDigest,
        qualified: true,
        mutable: false,
      },
    };
  }),
};
const bundle = await renderCloudflareBundle({config, release});

function desired(name) {
  return bundle.phases
    .flatMap(({resources}) => resources)
    .find(({logicalId}) => logicalId === `cloudflare/worker/${name}`);
}

function deployment(role, name) {
  const resource = desired(name);
  return {
    id: `deployment-${role}`,
    created_on: "2026-07-24T00:00:00Z",
    annotations: {
      "workers/message": cloudflareDeploymentMarker(
        config.installationId,
        release.releaseId,
        resource.digest,
      ),
    },
    versions: [{version_id: `version-${role}`, percentage: 100}],
  };
}

test("observes only fully promoted deployments carrying the exact release marker", async () => {
  const calls = [];
  const observer = createCloudflareWranglerObserver({
    readDeployments: async ({role, name}) => {
      calls.push({role, name});
      return [deployment(role, name)];
    },
  });
  const result = await observer({config, release, bundle});
  assert.match(result.revision, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(calls, [
    {role: "application", name: "shareslices-app"},
    {role: "content", name: "shareslices-content"},
    {role: "jobs", name: "shareslices-jobs"},
  ]);
  assert.equal(result.resources.length, 3);
  assert.deepEqual(
    result.resources.map(({providerIdentity}) => providerIdentity.versionId),
    ["version-application", "version-content", "version-jobs"],
  );
  assert.equal(result.resources.every(({owner}) => owner === "wrangler"), true);
});

test("does not claim staged, foreign-marked, or absent deployments", async () => {
  const observer = createCloudflareWranglerObserver({
    readDeployments: async ({role, name}) => {
      if (role === "application") return [];
      const observed = deployment(role, name);
      if (role === "content") {
        return [{
          ...observed,
          versions: [
            {version_id: "current", percentage: 90},
            {version_id: "candidate", percentage: 10},
          ],
        }];
      }
      return [{
        ...observed,
        annotations: {"workers/message": "foreign"},
      }];
    },
  });
  const result = await observer({config, release, bundle});
  assert.deepEqual(result.resources, []);
});

test("rejects malformed deployment JSON and incomplete bundles", async () => {
  const malformed = createCloudflareWranglerObserver({
    readDeployments: async () => [{id: "deployment", versions: []}],
  });
  await assert.rejects(
    malformed({config, release, bundle}),
    (error) => error.code === "cloudflare_wrangler_deployment_observation_invalid",
  );

  const observer = createCloudflareWranglerObserver({
    readDeployments: async () => [],
  });
  await assert.rejects(
    observer({
      config,
      release,
      bundle: {...bundle, phases: bundle.phases.map((phase) => ({...phase, resources: []}))},
    }),
    (error) => error.code === "cloudflare_wrangler_bundle_invalid",
  );
});
