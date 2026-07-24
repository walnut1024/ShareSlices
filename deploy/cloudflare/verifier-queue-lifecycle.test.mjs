import assert from "node:assert/strict";
import test from "node:test";

import {
  createCloudflareVerifierQueueLifecycle,
} from "./verifier-queue-lifecycle.mjs";

const accountId = "a".repeat(32);
const releaseId = `sha256:${"b".repeat(64)}`;
const base = {
  accountId,
  installationId: "shareslices",
  releaseId,
  fence: 17,
  retentionSeconds: 60,
};
const names = {
  worker: "shareslices-verify-bbbbbbbbbbbb-17",
  queue: "shareslices-verify-bbbbbbbbbbbb-17",
  deadLetterQueue: "shareslices-verify-dlq-bbbbbbbbbbbb-17",
};

function json(result, status = 200) {
  const body = JSON.stringify({
    success: status >= 200 && status < 300,
    result,
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({"content-length": String(body.length)}),
    text: async () => body,
  };
}

function queue({
  id,
  name,
  paused = false,
  retention = 345_600,
  consumers = [],
}) {
  return {
    queue_id: id,
    queue_name: name,
    settings: {
      delivery_delay: 0,
      delivery_paused: paused,
      message_retention_period: retention,
    },
    consumers,
    consumers_total_count: consumers.length,
  };
}

function consumer() {
  return {
    consumer_id: "consumer-1",
    queue_name: names.queue,
    script_name: names.worker,
    dead_letter_queue: names.deadLetterQueue,
    type: "worker",
    settings: {
      batch_size: 1,
      max_concurrency: 1,
      max_retries: 3,
      max_wait_time_ms: 1_000,
      retry_delay: 30,
    },
  };
}

function createProvider() {
  const requests = [];
  const queues = new Map();
  return {
    requests,
    fetchImplementation: async (url, options) => {
      const pathname = new URL(url).pathname;
      const path = pathname.slice(
        `/client/v4/accounts/${accountId}`.length,
      );
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({
        path,
        method: options.method,
        body,
        authorization: options.headers.Authorization,
      });
      if (options.method === "POST" && path === "/queues") {
        const id = body.queue_name === names.queue ? "queue-1" : "dlq-1";
        const created = queue({id, name: body.queue_name});
        queues.set(id, created);
        return json(created);
      }
      const match = path.match(/^\/queues\/([^/]+)(.*)$/);
      const id = match?.[1];
      const suffix = match?.[2];
      const current = queues.get(id);
      if (options.method === "GET" && suffix === "") {
        return current ? json(current) : json(null, 404);
      }
      if (options.method === "PATCH" && suffix === "") {
        const patched = {
          ...current,
          settings: {...current.settings, ...body.settings},
        };
        queues.set(id, patched);
        return json(patched);
      }
      if (options.method === "POST" && suffix === "/consumers") {
        const created = consumer();
        queues.set(id, {...current, consumers: [created], consumers_total_count: 1});
        return json(created);
      }
      if (
        options.method === "DELETE" &&
        suffix === "/consumers/consumer-1"
      ) {
        queues.set(id, {...current, consumers: [], consumers_total_count: 0});
        return json({});
      }
      if (options.method === "POST" && suffix === "/messages") {
        return json({metadata: {metrics: {
          backlog_count: 1,
          backlog_bytes: 128,
          oldest_message_timestamp_ms: Date.parse("2026-07-24T00:00:00Z"),
        }}});
      }
      if (options.method === "DELETE" && suffix === "") {
        queues.delete(id);
        return json({});
      }
      throw new Error(`unexpected request: ${options.method} ${path}`);
    },
  };
}

function verificationMessage() {
  return {
    version: 1,
    invocationId: "invocation_1234567890",
    nonce: "nonce_123456789012",
    releaseId,
    fence: 17,
    subFence: 3,
    lifecycle: {tombstoneSeconds: 120, quiescenceSeconds: 60},
    expected: {
      appWorker: {
        name: "shareslices-app",
        versionId: "app-version",
      },
      contentWorker: {
        name: "shareslices-content",
        versionId: "content-version",
      },
      jobsWorker: {
        versionId: "jobs-version",
        releaseBundleIdentity: "bundle",
        configurationDigest: "config",
        exportsDigest: "exports",
      },
      migrationHead: "0034",
      configuredContainerImages: {
        trustedProcessing: "trusted@sha256:1",
        thumbnail: "thumbnail@sha256:2",
      },
      containers: [
        {
          containerClass: "trusted-processing",
          stableSlot: "processing-a",
          buildIdentity: "processing-build",
          contractRevision: "processing-contract",
          imageReference: "trusted@sha256:1",
        },
        {
          containerClass: "thumbnail",
          stableSlot: "thumbnail-a",
          buildIdentity: "thumbnail-build",
          contractRevision: "thumbnail-contract",
          imageReference: "thumbnail@sha256:2",
        },
      ],
    },
  };
}

test("provisions paused release-owned queues and one exact consumer", async () => {
  const provider = createProvider();
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: provider.fetchImplementation,
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  const handle = await lifecycle.provision(base);
  assert.deepEqual(handle, {
    accountId,
    releaseId,
    fence: 17,
    worker: names.worker,
    queue: {id: "queue-1", name: names.queue},
    deadLetterQueue: {id: "dlq-1", name: names.deadLetterQueue},
    consumer: {id: "consumer-1", scriptName: names.worker},
  });
  assert.equal(
    provider.requests.every(
      ({authorization}) => authorization === "Bearer secret-provider-token",
    ),
    true,
  );
  assert.deepEqual(
    provider.requests.filter(({method}) => method === "PATCH")
      .map(({body}) => body),
    [
      {settings: {
        delivery_paused: true,
        delivery_delay: 0,
        message_retention_period: 60,
      }},
      {settings: {
        delivery_paused: true,
        delivery_delay: 0,
        message_retention_period: 60,
      }},
    ],
  );
});

test("publishes one nonce-bound JSON message while paused before resuming", async () => {
  const provider = createProvider();
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: provider.fetchImplementation,
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  const handle = await lifecycle.provision(base);
  provider.requests.length = 0;
  const message = verificationMessage();
  const result = await lifecycle.publishAndResume({...base, handle, message});
  assert.equal(result.state, "delivery-resumed");
  assert.deepEqual(result.message, {
    nonce: message.nonce,
    invocationId: message.invocationId,
    releaseId,
    fence: 17,
    subFence: 3,
  });
  const pushIndex = provider.requests.findIndex(
    ({path}) => path.endsWith("/messages"),
  );
  const resumeIndex = provider.requests.findIndex(
    ({method, body}) =>
      method === "PATCH" && body.settings.delivery_paused === false,
  );
  assert.equal(pushIndex > -1 && resumeIndex > pushIndex, true);
  assert.deepEqual(provider.requests[pushIndex].body, {
    body: message,
    content_type: "json",
    delay_seconds: 0,
  });
});

test("pause evidence stays indeterminate for in-flight work and detaches exactly one consumer", async () => {
  const provider = createProvider();
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: provider.fetchImplementation,
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  const handle = await lifecycle.provision(base);
  await lifecycle.publishAndResume({
    ...base,
    handle,
    message: verificationMessage(),
  });
  provider.requests.length = 0;
  const result = await lifecycle.pauseAndDetach({...base, handle});
  assert.deepEqual(result.pause, {
    delivery: "paused",
    observedAt: "2026-07-24T00:00:00.000Z",
    inFlight: "unknown",
    drained: false,
    quiescenceRequired: true,
  });
  assert.equal(result.handle.consumer, null);
  assert.deepEqual(
    provider.requests.map(({method, path}) => `${method} ${path}`),
    [
      "GET /queues/queue-1",
      "PATCH /queues/queue-1",
      "DELETE /queues/queue-1/consumers/consumer-1",
      "GET /queues/queue-1",
    ],
  );
});

test("deletes queues only after exact cleanup and quiescence evidence", async () => {
  const provider = createProvider();
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: provider.fetchImplementation,
    now: () => new Date("2026-07-24T00:00:00Z"),
  });
  const provisioned = await lifecycle.provision(base);
  await lifecycle.publishAndResume({
    ...base,
    handle: provisioned,
    message: verificationMessage(),
  });
  const paused = await lifecycle.pauseAndDetach({...base, handle: provisioned});
  await assert.rejects(
    lifecycle.deleteAfterQuiescence({
      ...base,
      handle: paused.handle,
      cleanupState: "complete",
      quiescenceState: "pending",
      tombstoneState: "retained",
    }),
    /cleanup_evidence_invalid/,
  );
  provider.requests.length = 0;
  const result = await lifecycle.deleteAfterQuiescence({
    ...base,
    handle: paused.handle,
    cleanupState: "complete",
    quiescenceState: "complete",
    tombstoneState: "retained",
  });
  assert.equal(result.state, "queues-deleted");
  assert.equal(result.queue.exists, false);
  assert.equal(result.deadLetterQueue.exists, false);
  assert.deepEqual(
    provider.requests.map(({method, path}) => `${method} ${path}`),
    [
      "GET /queues/queue-1",
      "GET /queues/dlq-1",
      "DELETE /queues/queue-1",
      "GET /queues/queue-1",
      "DELETE /queues/dlq-1",
      "GET /queues/dlq-1",
    ],
  );
});

test("fails closed on unexpected consumers, ownership drift, or ambiguous deletion", async () => {
  const provider = createProvider();
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: provider.fetchImplementation,
  });
  const handle = await lifecycle.provision(base);
  await assert.rejects(
    lifecycle.publishAndResume({
      ...base,
      handle: {...handle, queue: {...handle.queue, name: "other"}},
      message: verificationMessage(),
    }),
    /ownership_mismatch/,
  );

  const broken = createCloudflareVerifierQueueLifecycle({
    accountId,
    token: "secret-provider-token",
    fetchImplementation: async () => json({unexpected: true}),
  });
  await assert.rejects(broken.provision(base), /provider_response_invalid/);
});

test("rejects oversized messages locally and never exposes a provider token", async () => {
  const provider = createProvider();
  const token = "secret-provider-token";
  const lifecycle = createCloudflareVerifierQueueLifecycle({
    accountId,
    token,
    fetchImplementation: provider.fetchImplementation,
  });
  const handle = await lifecycle.provision(base);
  const oversized = verificationMessage();
  oversized.expected.containers = [
    oversized.expected.containers[1],
    ...Array.from({length: 2_000}, (_, index) => ({
      ...oversized.expected.containers[0],
      stableSlot: `processing-${index}`,
    })),
  ];
  await assert.rejects(
    lifecycle.publishAndResume({...base, handle, message: oversized}),
    /message_too_large/,
  );

  const rejected = createCloudflareVerifierQueueLifecycle({
    accountId,
    token,
    fetchImplementation: async () => json(null, 500),
  });
  await assert.rejects(rejected.provision(base), (error) => {
    assert.equal(error.message.includes(token), false);
    return /provider_rejected/.test(error.message);
  });
});
