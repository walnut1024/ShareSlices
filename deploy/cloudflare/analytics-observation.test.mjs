import assert from "node:assert/strict";
import test from "node:test";

import {createCloudflareAnalyticsObserver} from "./analytics-observation.mjs";

const config = {
  installationId: "demo",
  cloudflare: {
    accountId: "account-1",
    providerReadToken: {ref: "secret://cloudflare/provider", revision: "1"},
    r2: {
      artifactBucket: "artifacts",
      deploymentStateBucket: "state",
    },
  },
};
const now = new Date("2026-07-25T12:00:00.000Z");

test("queries official R2 GraphQL datasets and returns aggregate usage", async () => {
  const requests = [];
  const observe = createCloudflareAnalyticsObserver({
    resolvers: {secret: async () => "provider-token"},
    readContainerApplications: async ({names}) => {
      assert.deepEqual(names, ["demo-processing", "demo-thumbnail"]);
      return {
        "demo-processing": "processing-application",
        "demo-thumbnail": "thumbnail-application",
      };
    },
    now: () => now,
    fetchImplementation: async (url, init) => {
      requests.push({url, init});
      const input = JSON.parse(init.body);
      if (input.query.includes("ShareSlicesR2Telemetry")) {
        return Response.json({
          data: {viewer: {accounts: [{
          artifactOperations: [{sum: {requests: 7}}],
          stateOperations: [{sum: {requests: 3}}],
          artifactStorage: [{max: {payloadSize: 1000, metadataSize: 100}}],
          stateStorage: [{max: {payloadSize: 200, metadataSize: 20}}],
          }]}},
        });
      }
      return Response.json({
        data: {viewer: {accounts: [{
          processingMetrics: [{max: {containerUptime: 12}}],
          thumbnailMetrics: [{max: {containerUptime: 7}}],
          processingUsage: [{
            sum: {
              cpuTimeSec: 3,
              allocatedMemory: 100,
              allocatedDisk: 200,
              txBytes: 300,
            },
          }],
          thumbnailUsage: [{
            sum: {
              cpuTimeSec: 2,
              allocatedMemory: 10,
              allocatedDisk: 20,
              txBytes: 30,
            },
          }],
        }]}},
      });
    },
  });
  const result = await observe({config});
  assert.equal(result.r2.requests, 10);
  assert.equal(result.r2.bytes, 1320);
  assert.equal(result.container.startupMilliseconds, null);
  assert.equal(result.container.runtimeMilliseconds, 12_000);
  assert.deepEqual(result.container.usage, {
    cpuTimeSeconds: 5,
    allocatedMemoryByteSeconds: 110,
    allocatedDiskByteSeconds: 220,
    transmittedBytes: 330,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.cloudflare.com/client/v4/graphql");
  const inputs = requests.map(({init}) => JSON.parse(init.body));
  assert.equal(inputs[0].variables.artifactBucket, "artifacts");
  assert.equal(inputs[0].variables.stateBucket, "state");
  assert.equal(
    inputs[1].variables.processingApplicationId,
    "processing-application",
  );
  assert.equal(
    inputs[1].variables.thumbnailApplicationId,
    "thumbnail-application",
  );
  assert.equal(requests[0].init.headers.Authorization, "Bearer provider-token");
});

test("returns stable unknown without leaking GraphQL or transport errors", async () => {
  for (const fetchImplementation of [
    async () => { throw new Error("secret provider detail"); },
    async () => Response.json({errors: [{message: "secret provider detail"}]}),
  ]) {
    const result = await createCloudflareAnalyticsObserver({
      resolvers: {secret: async () => "provider-token"},
      readContainerApplications: async () => ({
        "demo-processing": "processing-application",
        "demo-thumbnail": "thumbnail-application",
      }),
      now: () => now,
      fetchImplementation,
    })({config});
    assert.equal(result.r2.state, "unknown");
    assert.equal(result.container.state, "unknown");
    assert.equal(JSON.stringify(result).includes("secret provider detail"), false);
  }
});

test("queries R2 but not account-wide Container analytics without exact identities", async () => {
  let fetchCount = 0;
  const result = await createCloudflareAnalyticsObserver({
    resolvers: {secret: async () => "provider-token"},
    now: () => now,
    readContainerApplications: async () => {
      throw new Error("not available");
    },
    fetchImplementation: async (_url, init) => {
      fetchCount += 1;
      assert.equal(JSON.parse(init.body).query.includes("ContainerTelemetry"), false);
      return Response.json({
        data: {viewer: {accounts: [{
          artifactOperations: [],
          stateOperations: [],
          artifactStorage: [],
          stateStorage: [],
        }]}},
      });
    },
  })({config});
  assert.equal(fetchCount, 1);
  assert.equal(result.container.state, "unknown");
  assert.equal(
    result.container.reasonCode,
    "cloudflare_container_application_identity_unavailable",
  );
  assert.equal(result.r2.state, "observed");
});
