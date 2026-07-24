import {getDomain} from "tldts";

import {withResolvedSecret} from "../automation/secrets.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";

const apiOrigin = "https://api.cloudflare.com/client/v4";
const activeSubscriptionStates = new Set(["Trial", "Provisioned", "Paid"]);

function apiError() {
  return new TargetAdapterError(
    "cloudflare_provider_observation_unavailable",
    "Cloudflare provider state could not be read through the configured API token.",
  );
}

async function readApi(fetchImplementation, token, path, {allowNotFound = false} = {}) {
  let response;
  try {
    response = await fetchImplementation(`${apiOrigin}${path}`, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw apiError();
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw apiError();
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok || body?.success !== true) throw apiError();
  return body;
}

async function readNumberedPages(fetchImplementation, token, path) {
  const result = [];
  let page = 1;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const body = await readApi(
      fetchImplementation,
      token,
      `${path}${separator}page=${page}&per_page=50`,
    );
    if (!Array.isArray(body.result)) throw apiError();
    result.push(...body.result);
    const totalPages = body.result_info?.total_pages ?? 1;
    if (!Number.isSafeInteger(totalPages) || totalPages < page) throw apiError();
    if (page >= totalPages) break;
    page += 1;
  } while (true);
  return result;
}

function subscriptionIsWorkersPaid(subscription) {
  if (!activeSubscriptionStates.has(subscription?.state)) return false;
  const plan = subscription?.rate_plan;
  const identity = [
    plan?.public_name,
    plan?.scope,
    ...(Array.isArray(plan?.sets) ? plan.sets : []),
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();
  return /\bworkers\b/.test(identity) && /\bpaid\b/.test(identity);
}

function configuredSites(config) {
  return Object.values(config.shared.publicOrigins).map(
    (origin) => getDomain(new URL(origin).hostname),
  );
}

function safeBinding(binding) {
  if (
    typeof binding?.name !== "string" ||
    typeof binding?.type !== "string"
  ) {
    throw apiError();
  }
  return Object.freeze(Object.fromEntries([
    ["name", binding.name],
    ["type", binding.type],
    ["bucketName", binding.bucket_name],
    ["queueName", binding.queue_name],
    ["service", binding.service],
    ["className", binding.class_name],
    ["namespace", binding.namespace],
  ].filter(([, value]) => typeof value === "string")));
}

async function observeWorkers(fetchImplementation, token, accountId, config) {
  return Object.freeze(Object.fromEntries(await Promise.all(
    Object.entries(config.cloudflare.workers).map(async ([role, name]) => {
      const scriptName = encodeURIComponent(name);
      const prefix = `/accounts/${accountId}/workers/scripts/${scriptName}`;
      const [settings, subdomain, schedules] = await Promise.all([
        readApi(fetchImplementation, token, `${prefix}/settings`, {allowNotFound: true}),
        readApi(fetchImplementation, token, `${prefix}/subdomain`, {allowNotFound: true}),
        readApi(fetchImplementation, token, `${prefix}/schedules`, {allowNotFound: true}),
      ]);
      if (!settings && !subdomain && !schedules) {
        return [role, Object.freeze({name, exists: false})];
      }
      if (!settings || !subdomain || !schedules) throw apiError();
      if (
        !Array.isArray(settings.result?.bindings) ||
        typeof subdomain.result?.enabled !== "boolean" ||
        typeof subdomain.result?.previews_enabled !== "boolean" ||
        !Array.isArray(schedules.result?.schedules)
      ) {
        throw apiError();
      }
      return [role, Object.freeze({
        name,
        exists: true,
        workersDevEnabled: subdomain.result.enabled,
        previewUrlsEnabled: subdomain.result.previews_enabled,
        bindings: Object.freeze(settings.result.bindings.map(safeBinding)),
        cpuMilliseconds: settings.result.limits?.cpu_ms ?? null,
        schedules: Object.freeze(schedules.result.schedules.map(({cron}) => {
          if (typeof cron !== "string") throw apiError();
          return cron;
        }).sort()),
      })];
    }),
  )));
}

export function createCloudflareProviderObserver({
  resolvers,
  fetchImplementation = fetch,
  now = () => new Date(),
} = {}) {
  return async ({config, account}) => {
    if (account?.id !== config.cloudflare.accountId) throw apiError();
    return withResolvedSecret(
      config.cloudflare.providerReadToken,
      resolvers ?? {},
      async (token) => {
        const accountId = encodeURIComponent(config.cloudflare.accountId);
        const [zones, queues, bucketsBody, subscriptions] = await Promise.all([
          readNumberedPages(fetchImplementation, token, `/zones?account.id=${accountId}`),
          readNumberedPages(fetchImplementation, token, `/accounts/${accountId}/queues`),
          readApi(fetchImplementation, token, `/accounts/${accountId}/r2/buckets?per_page=1000`),
          readNumberedPages(
            fetchImplementation,
            token,
            `/accounts/${accountId}/subscriptions`,
          ),
        ]);
        const buckets = Array.isArray(bucketsBody.result?.buckets)
          ? bucketsBody.result.buckets
          : [];
        const sites = configuredSites(config);
        const activeZoneNames = new Set(
          zones.filter(({status, account: owner}) =>
            status === "active" && owner?.id === config.cloudflare.accountId
          ).map(({name}) => name),
        );
        const queueNames = new Set(queues.map(({queue_name: name}) => name));
        const bucketNames = new Set(buckets.map(({name}) => name));
        const configuredBuckets = Object.values(config.cloudflare.r2);
        const bucketAccess = bucketNames.size > 0
          ? await Promise.all(configuredBuckets.map(async (name) => {
              if (!bucketNames.has(name)) return {private: false};
              const bucketName = encodeURIComponent(name);
              const [managed, custom] = await Promise.all([
                readApi(
                  fetchImplementation,
                  token,
                  `/accounts/${accountId}/r2/buckets/${bucketName}/domains/managed`,
                ),
                readApi(
                  fetchImplementation,
                  token,
                  `/accounts/${accountId}/r2/buckets/${bucketName}/domains/custom`,
                ),
              ]);
              const customDomains = Array.isArray(custom.result?.domains)
                ? custom.result.domains
                : [];
              return {
                private: managed.result?.enabled === false &&
                  customDomains.every(({enabled}) => enabled === false),
              };
            }))
          : [];
        const workers = await observeWorkers(
          fetchImplementation,
          token,
          accountId,
          config,
        );
        const configuredQueues = queues.filter(({queue_name: name}) =>
          Object.values(config.cloudflare.queues).includes(name)
        );
        const queueMetrics = new Map(await Promise.all(
          configuredQueues.map(async ({queue_id: queueId, queue_name: queueName}) => {
            if (typeof queueId !== "string" || queueId.length === 0) throw apiError();
            const metrics = await readApi(
              fetchImplementation,
              token,
              `/accounts/${accountId}/queues/${encodeURIComponent(queueId)}/metrics`,
            );
            const values = metrics.result;
            if (
              !Number.isSafeInteger(values?.backlog_count) ||
              values.backlog_count < 0 ||
              !Number.isSafeInteger(values?.backlog_bytes) ||
              values.backlog_bytes < 0 ||
              !Number.isSafeInteger(values?.oldest_message_timestamp_ms) ||
              values.oldest_message_timestamp_ms < 0
            ) {
              throw apiError();
            }
            const oldestMessageTimestamp = values.oldest_message_timestamp_ms === 0
              ? null
              : new Date(values.oldest_message_timestamp_ms);
            if (
              oldestMessageTimestamp &&
              Number.isNaN(oldestMessageTimestamp.getTime())
            ) {
              throw apiError();
            }
            return [queueName, Object.freeze({
              approximate: true,
              backlogCount: values.backlog_count,
              backlogBytes: values.backlog_bytes,
              oldestMessageTimestamp: oldestMessageTimestamp?.toISOString() ?? null,
            })];
          }),
        ));
        const queueState = Object.freeze(Object.fromEntries(
          configuredQueues
            .map((queue) => [queue.queue_name, Object.freeze({
              deliveryPaused: queue.settings?.delivery_paused ?? null,
              metrics: queueMetrics.get(queue.queue_name),
              consumers: Object.freeze((queue.consumers ?? []).map((consumer) =>
                Object.freeze({
                  scriptName: consumer.script_name ?? null,
                  deadLetterQueue: consumer.dead_letter_queue || null,
                  batchSize: consumer.settings?.batch_size ?? null,
                  maximumConcurrency: consumer.settings?.max_concurrency ?? null,
                  maximumRetries: consumer.settings?.max_retries ?? null,
                })
              )),
            })]),
        ));
        return Object.freeze({
          observedAt: now().toISOString(),
          workersPaid: subscriptions.some(subscriptionIsWorkersPaid),
          zonesReady: sites.every((site) => activeZoneNames.has(site)),
          distinctSites: sites.length === 2 && sites[0] !== sites[1],
          queuesReady: Object.values(config.cloudflare.queues).every(
            (name) => queueNames.has(name),
          ),
          privateR2: bucketAccess.length === configuredBuckets.length &&
            bucketAccess.every(({private: isPrivate}) => isPrivate),
          workers,
          queues: queueState,
          limits: Object.freeze({}),
        });
      },
    );
  };
}
