import {withResolvedSecret} from "../automation/secrets.mjs";

const endpoint = "https://api.cloudflare.com/client/v4/graphql";

const r2Query = `
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

const containerQuery = `
query ShareSlicesContainerTelemetry(
  $accountTag: String!
  $startDate: Time!
  $endDate: Time!
  $processingApplicationId: String!
  $thumbnailApplicationId: String!
) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      processingMetrics: containersMetricsAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          applicationId: $processingApplicationId
        }
      ) { max { containerUptime } }
      thumbnailMetrics: containersMetricsAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          applicationId: $thumbnailApplicationId
        }
      ) { max { containerUptime } }
      processingUsage: containersUsageAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          applicationId: $processingApplicationId
        }
      ) { sum { cpuTimeSec allocatedMemory allocatedDisk txBytes } }
      thumbnailUsage: containersUsageAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: $startDate
          datetime_leq: $endDate
          applicationId: $thumbnailApplicationId
        }
      ) { sum { cpuTimeSec allocatedMemory allocatedDisk txBytes } }
    }
  }
}`;

function sum(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) ?? 0), 0);
}

function unknownR2(observedAt, reasonCode = "cloudflare_r2_analytics_unavailable") {
  return Object.freeze({
    state: "unknown",
    reasonCode,
    observedAt,
    requests: null,
    bytes: null,
  });
}

function unknownContainer(
  observedAt,
  reasonCode = "cloudflare_container_analytics_unavailable",
) {
  return Object.freeze({
    state: "unknown",
    reasonCode,
    observedAt,
    startupMilliseconds: null,
    runtimeMilliseconds: null,
    usage: Object.freeze({
      cpuTimeSeconds: null,
      allocatedMemoryByteSeconds: null,
      allocatedDiskByteSeconds: null,
      transmittedBytes: null,
    }),
  });
}

function projectR2(body, observedAt) {
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
    return unknownR2(observedAt);
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
    return unknownR2(observedAt, "cloudflare_r2_analytics_invalid");
  }
  return Object.freeze({
    state: "observed",
    reasonCode: "cloudflare_r2_analytics_observed",
    observedAt,
    requests,
    bytes,
  });
}

function projectContainer(body, observedAt) {
  const account = body?.data?.viewer?.accounts?.[0];
  const metricRows = [
    ...(account?.processingMetrics ?? []),
    ...(account?.thumbnailMetrics ?? []),
  ];
  const usageRows = [
    ...(account?.processingUsage ?? []),
    ...(account?.thumbnailUsage ?? []),
  ];
  if (
    Array.isArray(body?.errors) ||
    !account ||
    !Array.isArray(account.processingMetrics) ||
    !Array.isArray(account.thumbnailMetrics) ||
    !Array.isArray(account.processingUsage) ||
    !Array.isArray(account.thumbnailUsage)
  ) {
    return unknownContainer(observedAt);
  }
  const runtimeSeconds = metricRows.reduce(
    (maximum, row) => Math.max(maximum, Number(row.max?.containerUptime ?? 0)),
    0,
  );
  const usage = {
    cpuTimeSeconds: sum(usageRows, (row) => row.sum?.cpuTimeSec),
    allocatedMemoryByteSeconds: sum(
      usageRows,
      (row) => row.sum?.allocatedMemory,
    ),
    allocatedDiskByteSeconds: sum(
      usageRows,
      (row) => row.sum?.allocatedDisk,
    ),
    transmittedBytes: sum(usageRows, (row) => row.sum?.txBytes),
  };
  const runtimeMilliseconds = runtimeSeconds * 1_000;
  if (
    !Number.isFinite(runtimeMilliseconds) ||
    runtimeMilliseconds < 0 ||
    Object.values(usage).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return unknownContainer(observedAt, "cloudflare_container_analytics_invalid");
  }
  return Object.freeze({
    state: "observed",
    reasonCode: "cloudflare_container_runtime_observed_startup_unavailable",
    observedAt,
    // Cloudflare's documented GraphQL datasets expose uptime and resource
    // usage, but no Container startup-duration field.
    startupMilliseconds: null,
    runtimeMilliseconds,
    usage: Object.freeze(usage),
  });
}

export function createCloudflareAnalyticsObserver({
  resolvers,
  readContainerApplications,
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
      let applicationIds;
      try {
        applicationIds = await readContainerApplications?.({
          names: [
            `${config.installationId}-processing`,
            `${config.installationId}-thumbnail`,
          ],
        });
        if (
          typeof applicationIds?.[`${config.installationId}-processing`] !== "string" ||
          typeof applicationIds?.[`${config.installationId}-thumbnail`] !== "string"
        ) {
          applicationIds = null;
        }
      } catch {
        applicationIds = null;
      }
      const request = async (query, variables) => {
        try {
          const response = await fetchImplementation(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({query, variables}),
          });
          if (!response.ok) return null;
          return await response.json();
        } catch {
          return null;
        }
      };
      const commonVariables = {
        accountTag: config.cloudflare.accountId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
      const r2Promise = request(r2Query, {
        ...commonVariables,
        artifactBucket: config.cloudflare.r2.artifactBucket,
        stateBucket: config.cloudflare.r2.deploymentStateBucket,
      });
      const containerPromise = applicationIds
        ? request(containerQuery, {
            ...commonVariables,
            processingApplicationId:
              applicationIds[`${config.installationId}-processing`],
            thumbnailApplicationId:
              applicationIds[`${config.installationId}-thumbnail`],
          })
        : Promise.resolve(null);
      const [r2Body, containerBody] = await Promise.all([
        r2Promise,
        containerPromise,
      ]);
      return Object.freeze({
        r2: r2Body
          ? projectR2(r2Body, end.toISOString())
          : unknownR2(end.toISOString()),
        container: containerBody
          ? projectContainer(containerBody, end.toISOString())
          : unknownContainer(
              end.toISOString(),
              applicationIds
                ? "cloudflare_container_analytics_unavailable"
                : "cloudflare_container_application_identity_unavailable",
            ),
      });
    },
  );
}
