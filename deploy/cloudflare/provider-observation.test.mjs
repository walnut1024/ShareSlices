import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {createCloudflareProviderObserver} from "./provider-observation.mjs";

const config = JSON.parse(await readFile(
  new URL("../contract/fixtures/deployment.cloudflare.valid.json", import.meta.url),
  "utf8",
));

function response(result, {ok = true, success = true} = {}) {
  return {ok, status: ok ? 200 : 500, json: async () => ({success, result})};
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
          (queue_name, index) => ({
            queue_id: `queue-${index + 1}`,
            queue_name,
            settings: {delivery_paused: index === 0},
            consumers: index === 0 ? [{
              script_name: config.cloudflare.workers.jobs,
              dead_letter_queue: config.cloudflare.queues.deadLetter,
              settings: {max_retries: 3},
            }] : [],
          }),
        ));
      }
      if (url.endsWith("/metrics")) {
        return response({
          backlog_count: url.includes("queue-2") ? 2 : 7,
          backlog_bytes: url.includes("queue-2") ? 256 : 1024,
          oldest_message_timestamp_ms: url.includes("queue-2")
            ? Date.parse("2026-07-23T23:55:00Z")
            : Date.parse("2026-07-23T23:59:00Z"),
        });
      }
      if (url.includes("/r2/buckets")) {
        if (url.endsWith("/domains/managed")) {
          return response({domain: "example.r2.dev", enabled: false});
        }
        if (url.endsWith("/domains/custom")) return response({domains: []});
        return response({buckets: Object.values(config.cloudflare.r2).map((name) => ({name}))});
      }
      if (url.endsWith("/settings")) {
        return response({
          bindings: [{name: "ARTIFACTS", type: "r2_bucket", bucket_name: "shareslices-artifacts"}],
          limits: {cpu_ms: 30_000},
        });
      }
      if (url.endsWith("/subdomain")) {
        return response({enabled: false, previews_enabled: false});
      }
      if (url.endsWith("/schedules")) {
        return response({schedules: url.includes("shareslices-jobs")
          ? [{cron: config.cloudflare.costControls.schedule.cron}]
          : []});
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
  assert.equal(seen.length, 19);
  assert.equal(seen.every(({authorization}) => authorization === "Bearer provider-token"), true);
  assert.equal(observed.workers.jobs.workersDevEnabled, false);
  assert.equal(observed.workers.jobs.previewUrlsEnabled, false);
  assert.deepEqual(observed.workers.jobs.schedules, ["*/5 * * * *"]);
  assert.deepEqual(observed.workers.application.bindings, [{
    name: "ARTIFACTS",
    type: "r2_bucket",
    bucketName: "shareslices-artifacts",
  }]);
  assert.deepEqual(observed.queues[config.cloudflare.queues.deadLetter].metrics, {
    approximate: true,
    backlogCount: 2,
    backlogBytes: 256,
    oldestMessageTimestamp: "2026-07-23T23:55:00.000Z",
  });
  assert.equal(
    observed.queues[config.cloudflare.queues.jobs].consumers[0].deadLetterQueue,
    config.cloudflare.queues.deadLetter,
  );
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
      if (
        url.endsWith("/settings") ||
        url.endsWith("/subdomain") ||
        url.endsWith("/schedules")
      ) {
        return {
          ok: false,
          status: 404,
          json: async () => ({success: false, result: null}),
        };
      }
      return response({buckets: []});
    },
  });
  const observed = await observer({config, account: {id: config.cloudflare.accountId}});
  assert.equal(observed.workersPaid, false);
  assert.equal(observed.zonesReady, false);
  assert.equal(observed.queuesReady, false);
  assert.equal(observed.privateR2, false);
  assert.equal(observed.workers.application.exists, false);

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
