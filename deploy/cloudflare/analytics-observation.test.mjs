import assert from "node:assert/strict";
import test from "node:test";

import {createCloudflareAnalyticsObserver} from "./analytics-observation.mjs";

const config = {
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
  let request;
  const observe = createCloudflareAnalyticsObserver({
    resolvers: {secret: async () => "provider-token"},
    now: () => now,
    fetchImplementation: async (url, init) => {
      request = {url, init};
      return Response.json({
        data: {viewer: {accounts: [{
          artifactOperations: [{sum: {requests: 7}}],
          stateOperations: [{sum: {requests: 3}}],
          artifactStorage: [{max: {payloadSize: 1000, metadataSize: 100}}],
          stateStorage: [{max: {payloadSize: 200, metadataSize: 20}}],
        }]}},
      });
    },
  });
  const result = await observe({config});
  assert.equal(result.r2.requests, 10);
  assert.equal(result.r2.bytes, 1320);
  assert.equal(request.url, "https://api.cloudflare.com/client/v4/graphql");
  const input = JSON.parse(request.init.body);
  assert.equal(input.variables.artifactBucket, "artifacts");
  assert.equal(input.variables.stateBucket, "state");
  assert.equal(request.init.headers.Authorization, "Bearer provider-token");
});

test("returns stable unknown without leaking GraphQL or transport errors", async () => {
  for (const fetchImplementation of [
    async () => { throw new Error("secret provider detail"); },
    async () => Response.json({errors: [{message: "secret provider detail"}]}),
  ]) {
    const result = await createCloudflareAnalyticsObserver({
      resolvers: {secret: async () => "provider-token"},
      now: () => now,
      fetchImplementation,
    })({config});
    assert.equal(result.r2.state, "unknown");
    assert.equal(JSON.stringify(result).includes("secret provider detail"), false);
  }
});
