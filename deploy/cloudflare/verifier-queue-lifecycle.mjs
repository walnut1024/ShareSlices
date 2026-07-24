import {releaseVerifierResourceNames} from "./verifier-wrangler-config.mjs";
import {pausedVerifierQueueEvidence} from "./verifier-lifecycle.mjs";
import {
  assertCloudflareReleaseVerificationMessage,
} from "./release-verification-message.mjs";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const DEFAULT_RETENTION_SECONDS = 60;
// The documented 128 KB limit includes about 100 bytes of provider metadata.
const MAXIMUM_MESSAGE_BODY_BYTES = 127_000;
const MAXIMUM_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

function fail(reason) {
  throw new Error(`cloudflare_verifier_queue_${reason}`);
}

function requireAccountId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) {
    fail("account_invalid");
  }
  return value;
}

function requireProviderId(kind, value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    fail(`${kind}_id_invalid`);
  }
  return value;
}

function requireToken(value) {
  if (typeof value !== "string" || value.length === 0) {
    fail("credential_invalid");
  }
  return value;
}

function requirePositiveInteger(kind, value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${kind}_invalid`);
  return value;
}

function requireTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) fail("clock_invalid");
  return timestamp.toISOString();
}

function requireLifecycleInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("input_invalid");
  }
  const names = releaseVerifierResourceNames(input);
  const worker = names.worker;
  const retentionSeconds = input.retentionSeconds ??
    DEFAULT_RETENTION_SECONDS;
  if (
    !Number.isSafeInteger(retentionSeconds) ||
    retentionSeconds < 60 ||
    retentionSeconds > 1_209_600
  ) {
    fail("retention_invalid");
  }
  return Object.freeze({
    accountId: requireAccountId(input.accountId),
    names,
    worker,
    releaseId: input.releaseId,
    fence: input.fence,
    retentionSeconds,
  });
}

function requireHandle(input, expected) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("handle_invalid");
  }
  if (
    input.accountId !== expected.accountId ||
    input.releaseId !== expected.releaseId ||
    input.fence !== expected.fence ||
    input.worker !== expected.worker ||
    input.queue?.name !== expected.names.queue ||
    input.deadLetterQueue?.name !== expected.names.deadLetterQueue
  ) {
    fail("ownership_mismatch");
  }
  return Object.freeze({
    accountId: input.accountId,
    releaseId: input.releaseId,
    fence: input.fence,
    worker: input.worker,
    queue: Object.freeze({
      id: requireProviderId("queue", input.queue.id),
      name: input.queue.name,
    }),
    deadLetterQueue: Object.freeze({
      id: requireProviderId("dead_letter_queue", input.deadLetterQueue.id),
      name: input.deadLetterQueue.name,
    }),
    consumer: input.consumer
      ? Object.freeze({
          id: requireProviderId("consumer", input.consumer.id),
          scriptName: input.consumer.scriptName,
        })
      : null,
  });
}

function queueProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("provider_response_invalid");
  }
  const consumers = value.consumers;
  if (
    !Array.isArray(consumers) ||
    !Number.isSafeInteger(value.consumers_total_count) ||
    value.consumers_total_count !== consumers.length ||
    typeof value.queue_name !== "string"
  ) {
    fail("provider_response_invalid");
  }
  return Object.freeze({
    id: requireProviderId("queue", value.queue_id),
    name: value.queue_name,
    deliveryPaused: value.settings?.delivery_paused,
    retentionSeconds: value.settings?.message_retention_period,
    consumers: Object.freeze(consumers.map(consumerProjection)),
  });
}

function consumerProjection(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.type !== "worker" ||
    typeof value.script_name !== "string" ||
    typeof value.queue_name !== "string"
  ) {
    fail("provider_response_invalid");
  }
  return Object.freeze({
    id: requireProviderId("consumer", value.consumer_id),
    type: value.type,
    scriptName: value.script_name,
    queueName: value.queue_name,
    deadLetterQueue: value.dead_letter_queue || null,
    settings: Object.freeze({
      batchSize: value.settings?.batch_size,
      maximumConcurrency: value.settings?.max_concurrency,
      maximumRetries: value.settings?.max_retries,
      maximumWaitMilliseconds: value.settings?.max_wait_time_ms,
      retryDelaySeconds: value.settings?.retry_delay,
    }),
  });
}

function assertQueue(queue, {id, name, paused, retentionSeconds}) {
  if (
    queue.id !== id ||
    queue.name !== name ||
    queue.deliveryPaused !== paused ||
    queue.retentionSeconds !== retentionSeconds
  ) {
    fail("ownership_mismatch");
  }
  return queue;
}

function assertConsumer(consumer, expected) {
  if (
    consumer.scriptName !== expected.worker ||
    consumer.queueName !== expected.names.queue ||
    consumer.deadLetterQueue !== expected.names.deadLetterQueue ||
    consumer.settings.batchSize !== 1 ||
    consumer.settings.maximumConcurrency !== 1 ||
    consumer.settings.maximumRetries !== 3 ||
    consumer.settings.maximumWaitMilliseconds !== 1_000 ||
    consumer.settings.retryDelaySeconds !== 30
  ) {
    fail("consumer_mismatch");
  }
  return consumer;
}

async function boundedJson(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_RESPONSE_BYTES) {
    fail("provider_response_too_large");
  }
  let serialized;
  try {
    serialized = await response.text();
  } catch {
    fail("provider_unavailable");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAXIMUM_RESPONSE_BYTES) {
    fail("provider_response_too_large");
  }
  try {
    return JSON.parse(serialized);
  } catch {
    fail("provider_response_invalid");
  }
}

function createClient({accountId, token, fetchImplementation}) {
  const account = encodeURIComponent(requireAccountId(accountId));
  const credential = requireToken(token);
  if (typeof fetchImplementation !== "function") fail("fetch_invalid");

  async function request(method, path, body, {allowNotFound = false} = {}) {
    let response;
    try {
      response = await fetchImplementation(`${API_ORIGIN}/accounts/${account}${path}`, {
        method,
        headers: Object.freeze({
          Authorization: `Bearer ${credential}`,
          ...(body === undefined ? {} : {"content-type": "application/json"}),
        }),
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
    } catch {
      fail("provider_unavailable");
    }
    const payload = await boundedJson(response);
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok || payload?.success !== true) fail("provider_rejected");
    return payload.result;
  }

  return Object.freeze({
    createQueue: (name) => request("POST", "/queues", {queue_name: name}),
    getQueue: (id, options) =>
      request("GET", `/queues/${encodeURIComponent(id)}`, undefined, options),
    patchQueue: (id, settings) =>
      request("PATCH", `/queues/${encodeURIComponent(id)}`, {settings}),
    deleteQueue: (id) =>
      request("DELETE", `/queues/${encodeURIComponent(id)}`),
    createConsumer: (queueId, body) =>
      request(
        "POST",
        `/queues/${encodeURIComponent(queueId)}/consumers`,
        body,
      ),
    deleteConsumer: (queueId, consumerId) =>
      request(
        "DELETE",
        `/queues/${encodeURIComponent(queueId)}/consumers/` +
          encodeURIComponent(consumerId),
      ),
    pushMessage: (queueId, body) =>
      request(
        "POST",
        `/queues/${encodeURIComponent(queueId)}/messages`,
        {body, content_type: "json", delay_seconds: 0},
      ),
  });
}

async function readOwnedQueue(client, owned, expected) {
  const result = await client.getQueue(owned.id);
  return assertQueue(queueProjection(result), {
    id: owned.id,
    name: owned.name,
    paused: expected.paused,
    retentionSeconds: expected.retentionSeconds,
  });
}

function requireVerificationMessage(message, expected) {
  let copy;
  try {
    copy = assertCloudflareReleaseVerificationMessage(message, expected);
  } catch {
    fail("message_invalid");
  }
  if (
    new TextEncoder().encode(JSON.stringify(copy)).byteLength >
      MAXIMUM_MESSAGE_BODY_BYTES
  ) {
    fail("message_too_large");
  }
  return copy;
}

export function createCloudflareVerifierQueueLifecycle({
  accountId,
  token,
  fetchImplementation = fetch,
  now = () => new Date(),
} = {}) {
  const client = createClient({accountId, token, fetchImplementation});

  return Object.freeze({
    async provision(input) {
      const expected = requireLifecycleInput({...input, accountId});
      const createdDeadLetter = queueProjection(
        await client.createQueue(expected.names.deadLetterQueue),
      );
      if (
        createdDeadLetter.name !== expected.names.deadLetterQueue ||
        createdDeadLetter.consumers.length !== 0
      ) {
        fail("ownership_mismatch");
      }
      const deadLetterQueue = queueProjection(await client.patchQueue(
        createdDeadLetter.id,
        {
          delivery_paused: true,
          delivery_delay: 0,
          message_retention_period: expected.retentionSeconds,
        },
      ));
      assertQueue(deadLetterQueue, {
        id: createdDeadLetter.id,
        name: expected.names.deadLetterQueue,
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });

      const createdQueue = queueProjection(
        await client.createQueue(expected.names.queue),
      );
      if (
        createdQueue.name !== expected.names.queue ||
        createdQueue.consumers.length !== 0
      ) {
        fail("ownership_mismatch");
      }
      const queue = queueProjection(await client.patchQueue(createdQueue.id, {
        delivery_paused: true,
        delivery_delay: 0,
        message_retention_period: expected.retentionSeconds,
      }));
      assertQueue(queue, {
        id: createdQueue.id,
        name: expected.names.queue,
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });

      const consumer = assertConsumer(consumerProjection(
        await client.createConsumer(queue.id, {
          script_name: expected.worker,
          type: "worker",
          dead_letter_queue: expected.names.deadLetterQueue,
          settings: {
            batch_size: 1,
            max_concurrency: 1,
            max_retries: 3,
            max_wait_time_ms: 1_000,
            retry_delay: 30,
          },
        }),
      ), expected);
      const observed = await readOwnedQueue(
        client,
        {id: queue.id, name: queue.name},
        {paused: true, retentionSeconds: expected.retentionSeconds},
      );
      if (
        observed.consumers.length !== 1 ||
        observed.consumers[0].id !== consumer.id
      ) {
        fail("consumer_mismatch");
      }
      assertConsumer(observed.consumers[0], expected);
      return Object.freeze({
        accountId: expected.accountId,
        releaseId: expected.releaseId,
        fence: expected.fence,
        worker: expected.worker,
        queue: Object.freeze({id: queue.id, name: queue.name}),
        deadLetterQueue: Object.freeze({
          id: deadLetterQueue.id,
          name: deadLetterQueue.name,
        }),
        consumer: Object.freeze({
          id: consumer.id,
          scriptName: consumer.scriptName,
        }),
      });
    },

    async publishAndResume(input) {
      const expected = requireLifecycleInput({...input, accountId});
      const handle = requireHandle(input.handle, expected);
      if (!handle.consumer) fail("consumer_missing");
      const queue = await readOwnedQueue(client, handle.queue, {
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });
      if (queue.consumers.length !== 1) fail("consumer_mismatch");
      assertConsumer(queue.consumers[0], expected);
      if (queue.consumers[0].id !== handle.consumer.id) {
        fail("consumer_mismatch");
      }
      await client.pushMessage(
        queue.id,
        requireVerificationMessage(input.message, expected),
      );
      assertQueue(queueProjection(await client.patchQueue(queue.id, {
        delivery_paused: false,
      })), {
        id: queue.id,
        name: queue.name,
        paused: false,
        retentionSeconds: expected.retentionSeconds,
      });
      const resumed = await readOwnedQueue(client, handle.queue, {
        paused: false,
        retentionSeconds: expected.retentionSeconds,
      });
      if (resumed.consumers.length !== 1) fail("consumer_mismatch");
      assertConsumer(resumed.consumers[0], expected);
      return Object.freeze({
        state: "delivery-resumed",
        message: Object.freeze({
          nonce: input.message.nonce,
          invocationId: input.message.invocationId,
          releaseId: expected.releaseId,
          fence: expected.fence,
          subFence: input.message.subFence,
        }),
        observedAt: requireTimestamp(now()),
      });
    },

    async pauseAndDetach(input) {
      const expected = requireLifecycleInput({...input, accountId});
      const handle = requireHandle(input.handle, expected);
      if (!handle.consumer) fail("consumer_missing");
      const queue = await readOwnedQueue(client, handle.queue, {
        paused: false,
        retentionSeconds: expected.retentionSeconds,
      });
      if (
        queue.consumers.length !== 1 ||
        queue.consumers[0].id !== handle.consumer.id
      ) {
        fail("consumer_mismatch");
      }
      assertConsumer(queue.consumers[0], expected);
      assertQueue(queueProjection(await client.patchQueue(queue.id, {
        delivery_paused: true,
      })), {
        id: queue.id,
        name: queue.name,
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });
      const pausedAt = requireTimestamp(now());
      await client.deleteConsumer(queue.id, handle.consumer.id);
      const detached = await readOwnedQueue(client, handle.queue, {
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });
      if (detached.consumers.length !== 0) fail("consumer_detach_unconfirmed");
      return Object.freeze({
        state: "paused-consumer-detached",
        pause: pausedVerifierQueueEvidence({
          deliveryPaused: true,
          observedAt: pausedAt,
        }),
        handle: Object.freeze({...handle, consumer: null}),
      });
    },

    async deleteAfterQuiescence(input) {
      const expected = requireLifecycleInput({...input, accountId});
      const handle = requireHandle(input.handle, expected);
      if (handle.consumer !== null) fail("consumer_still_attached");
      if (
        input.cleanupState !== "complete" ||
        input.quiescenceState !== "complete" ||
        input.tombstoneState !== "retained"
      ) {
        fail("cleanup_evidence_invalid");
      }
      const queue = await readOwnedQueue(client, handle.queue, {
        paused: true,
        retentionSeconds: expected.retentionSeconds,
      });
      if (queue.consumers.length !== 0) fail("consumer_detach_unconfirmed");
      const deadLetterQueue = await readOwnedQueue(
        client,
        handle.deadLetterQueue,
        {paused: true, retentionSeconds: expected.retentionSeconds},
      );
      if (deadLetterQueue.consumers.length !== 0) {
        fail("dead_letter_consumer_present");
      }
      await client.deleteQueue(queue.id);
      if (await client.getQueue(queue.id, {allowNotFound: true}) !== null) {
        fail("queue_delete_unconfirmed");
      }
      await client.deleteQueue(deadLetterQueue.id);
      if (
        await client.getQueue(deadLetterQueue.id, {allowNotFound: true}) !==
          null
      ) {
        fail("dead_letter_queue_delete_unconfirmed");
      }
      return Object.freeze({
        state: "queues-deleted",
        queue: Object.freeze({id: queue.id, name: queue.name, exists: false}),
        deadLetterQueue: Object.freeze({
          id: deadLetterQueue.id,
          name: deadLetterQueue.name,
          exists: false,
        }),
        observedAt: requireTimestamp(now()),
      });
    },
  });
}
