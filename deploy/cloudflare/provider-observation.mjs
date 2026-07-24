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

async function readApi(fetchImplementation, token, path) {
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
          limits: Object.freeze({}),
        });
      },
    );
  };
}
