import {withResolvedSecret} from "../automation/secrets.mjs";

const endpoint = "https://api.cloudflare.com/client/v4/graphql";

const query = `
query ShareSlicesR2Telemetry(
  $accountTag: string!
  $startDate: Time!
  $endDate: Time!
  $artifactBucket: string!
  $stateBucket: string!
) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      artifactOperations: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $artifactBucket
        }
      ) { sum { requests } }
      stateOperations: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $stateBucket
        }
      ) { sum { requests } }
      artifactStorage: r2StorageAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $artifactBucket
        }
        orderBy: [datetime_DESC]
      ) { max { payloadSize metadataSize } }
      stateStorage: r2StorageAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          bucketName: $stateBucket
        }
        orderBy: [datetime_DESC]
      ) { max { payloadSize metadataSize } }
    }
  }
}`;

function sum(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);
}

function project(body, observedAt) {
  const account = body?.data?.viewer?.accounts?.[0];
  const lists = [
    account?.artifactOperations,
    account?.stateOperations,
    account?.artifactStorage,
    account?.stateStorage,
  ];
  if (
    Array.isArray(body?.errors) ||
    !account ||
    lists.some((value) => !Array.isArray(value))
  ) {
    return Object.freeze({
      state: "unknown",
      reasonCode: "cloudflare_r2_analytics_unavailable",
      observedAt,
      requests: null,
      bytes: null,
    });
  }
  const requests =
    sum(account.artifactOperations, (row) => row.sum?.requests) +
    sum(account.stateOperations, (row) => row.sum?.requests);
  const bytes =
    sum(account.artifactStorage, (row) =>
      Number(row.max?.payloadSize ?? 0) + Number(row.max?.metadataSize ?? 0)) +
    sum(account.stateStorage, (row) =>
      Number(row.max?.payloadSize ?? 0) + Number(row.max?.metadataSize ?? 0));
  if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(bytes)) {
    return Object.freeze({
      state: "unknown",
      reasonCode: "cloudflare_r2_analytics_invalid",
      observedAt,
      requests: null,
      bytes: null,
    });
  }
  return Object.freeze({
    state: "observed",
    reasonCode: "cloudflare_r2_analytics_observed",
    observedAt,
    requests,
    bytes,
  });
}

export function createCloudflareAnalyticsObserver({
  resolvers,
  fetchImplementation = fetch,
  now = () => new Date(),
  windowMilliseconds = 15 * 60 * 1_000,
} = {}) {
  return async ({config}) => withResolvedSecret(
    config.cloudflare.providerReadToken,
    resolvers ?? {},
    async (token) => {
      const end = now();
      const start = new Date(end.getTime() - windowMilliseconds);
      let response;
      let body;
      try {
        response = await fetchImplementation(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            variables: {
              accountTag: config.cloudflare.accountId,
              startDate: start.toISOString(),
              endDate: end.toISOString(),
              artifactBucket: config.cloudflare.r2.artifactBucket,
              stateBucket: config.cloudflare.r2.deploymentStateBucket,
            },
          }),
        });
        body = await response.json();
      } catch {
        response = null;
      }
      if (!response?.ok) {
        return Object.freeze({
          r2: Object.freeze({
            state: "unknown",
            reasonCode: "cloudflare_r2_analytics_unavailable",
            observedAt: end.toISOString(),
            requests: null,
            bytes: null,
          }),
        });
      }
      return Object.freeze({r2: project(body, end.toISOString())});
    },
  );
}
