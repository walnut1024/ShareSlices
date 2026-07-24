import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {createCloudflareProviderObserver} from "./provider-observation.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));

function response(result, {ok = true, success = true} = {}) {
  return {ok, json: async () => ({success, result})};
}

test("observes exact active zones, queues, private buckets, and Workers Paid subscription", async () => {
  const seen = [];
  const observer = createCloudflareProviderObserver({
    resolvers: {secret: async () => "provider-token"},
    now: () => new Date("2026-07-24T00:00:00Z"),
    fetchImplementation: async (url, options) => {
      seen.push({url, authorization: options.headers.Authorization});
      if (url.includes("/zones?")) {
        return response([
          {name: "example.test", status: "active", account: {id: config.cloudflare.accountId}},
          {name: "example-content.test", status: "active", account: {id: config.cloudflare.accountId}},
        ]);
      }
      if (url.includes("/queues?")) {
        return response(Object.values(config.cloudflare.queues).map(
          (queue_name) => ({queue_name}),
        ));
      }
      if (url.includes("/r2/buckets")) {
        if (url.endsWith("/domains/managed")) {
          return response({domain: "example.r2.dev", enabled: false});
        }
        if (url.endsWith("/domains/custom")) return response({domains: []});
        return response({buckets: Object.values(config.cloudflare.r2).map((name) => ({name}))});
      }
      return response([{
        state: "Paid",
        rate_plan: {public_name: "Workers Paid", scope: "workers", sets: ["workers"]},
      }]);
    },
  });
  const observed = await observer({
    config,
    account: {id: config.cloudflare.accountId},
  });
  assert.deepEqual(
    {
      workersPaid: observed.workersPaid,
      zonesReady: observed.zonesReady,
      distinctSites: observed.distinctSites,
      queuesReady: observed.queuesReady,
      privateR2: observed.privateR2,
    },
    {
      workersPaid: true,
      zonesReady: true,
      distinctSites: true,
      queuesReady: true,
      privateR2: true,
    },
  );
  assert.equal(seen.length, 8);
  assert.equal(seen.every(({authorization}) => authorization === "Bearer provider-token"), true);
});

test("fails closed for ambiguous subscription identity and provider errors", async () => {
  const observer = createCloudflareProviderObserver({
    resolvers: {secret: async () => "provider-token"},
    fetchImplementation: async (url) => {
      if (url.includes("/subscriptions?")) {
        return response([{state: "Paid", rate_plan: {public_name: "R2 Paid", scope: "r2"}}]);
      }
      if (url.includes("/zones?")) return response([]);
      if (url.includes("/queues?")) return response([]);
      return response({buckets: []});
    },
  });
  const observed = await observer({config, account: {id: config.cloudflare.accountId}});
  assert.equal(observed.workersPaid, false);
  assert.equal(observed.zonesReady, false);
  assert.equal(observed.queuesReady, false);
  assert.equal(observed.privateR2, false);

  const failed = createCloudflareProviderObserver({
    resolvers: {secret: async () => "provider-token"},
    fetchImplementation: async () => response(null, {ok: false, success: false}),
  });
  await assert.rejects(
    failed({config, account: {id: config.cloudflare.accountId}}),
    (error) => error.code === "secret_operation_failed" &&
      error.message.includes("Cloudflare provider state") &&
      !error.message.includes("provider-token"),
  );
});
