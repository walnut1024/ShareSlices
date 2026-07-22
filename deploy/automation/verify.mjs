import {readFile} from "node:fs/promises";

import {sha256Digest} from "./canonical.mjs";

const requestTimeoutMs = 5_000;
const contractRoot = new URL("../contract/", import.meta.url);
const coreScenarioIds = Object.freeze([
  "trusted-health",
  "viewer-cache-boundary",
  "content-authority-isolation",
]);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, contractRoot), "utf8"));
}

async function loadCoreContract(topology) {
  const [contract, routes, cache] = await Promise.all([
    readJson("verification-scenarios.json"),
    readJson("route-projection.json"),
    readJson("cache-projection.json"),
  ]);
  const scenarios = new Map(contract.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const id of coreScenarioIds) {
    const scenario = scenarios.get(id);
    if (!scenario || scenario.level !== "core" || scenario.mutating !== false) {
      throw new TypeError(`Verification contract is missing read-only core scenario ${id}.`);
    }
  }
  const fixture = topology === "compose"
    ? await readJson("fixtures/verification.compose.json")
    : null;
  return {
    schemaVersion: contract.schemaVersion,
    contractDigest: sha256Digest(contract),
    routes,
    cache,
    scenarios,
    fixture,
  };
}

function normalizeAddresses({addresses, applicationOrigin, contentOrigin}) {
  const application = applicationOrigin ?? addresses?.application;
  const content = contentOrigin ?? addresses?.content;
  const normalized = {
    web: addresses?.web ?? application,
    api: addresses?.api ?? application,
    viewer: addresses?.viewer ?? application,
    content,
    origin: addresses?.origin ?? application,
    edge: addresses?.edge ?? application,
  };
  for (const [role, value] of Object.entries(normalized)) {
    try {
      const parsed = new URL(value);
      if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      throw new TypeError(`Core verification requires a valid ${role} address.`);
    }
  }
  return Object.freeze(normalized);
}

function header(response, name) {
  return response.headers.get(name);
}

function check(id, scenarioId, passed, evidence) {
  return Object.freeze({
    id,
    scenarioId,
    outcome: passed ? "passed" : "failed",
    reasonCode: passed ? null : "required_check_failed",
    evidence: Object.freeze(evidence),
  });
}

function notApplicable(id, reasonCode) {
  return Object.freeze({
    id,
    scenarioId: id,
    outcome: "not_applicable",
    reasonCode,
    evidence: Object.freeze({topology: "compose"}),
  });
}

async function request(fetchImplementation, origin, path, headers = {}) {
  try {
    const response = await fetchImplementation(new URL(path, origin), {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        "User-Agent": "ShareSlices-Deployment-Verifier/1",
        ...headers,
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return {response, error: null};
  } catch {
    return {response: null, error: "request_failed"};
  }
}

function responseEvidence(response, error) {
  if (!response) return {status: null, error};
  return {
    status: response.status,
    cacheControl: header(response, "cache-control"),
    contentType: header(response, "content-type"),
    requestIdPresent: Boolean(header(response, "x-request-id")),
    referrerPolicy: header(response, "referrer-policy"),
    contentSecurityPolicyPresent: Boolean(header(response, "content-security-policy")),
    permissionsPolicyPresent: Boolean(header(response, "permissions-policy")),
    contentTypeOptions: header(response, "x-content-type-options"),
    robotsPolicy: header(response, "x-robots-tag"),
    corsOrigin: header(response, "access-control-allow-origin"),
    corsCredentialsPresent: Boolean(header(response, "access-control-allow-credentials")),
    setCookiePresent: Boolean(header(response, "set-cookie")),
    locationPresent: Boolean(header(response, "location")),
    storageMetadataPresent: [
      "x-amz-bucket-region",
      "x-amz-request-id",
      "x-r2-request-id",
    ].some((name) => Boolean(header(response, name))),
  };
}

function projectionChecks(contract) {
  const routeIds = new Set(contract.routes.rows.map(({id}) => id));
  const requiredRoutes = [
    "web-static-assets",
    "health-live",
    "health-ready",
    "management-api",
    "viewer-entry",
    "viewer-assets",
    "preview-entry",
    "preview-assets",
    "gallery-content-public",
    "gallery-content-review",
    "internal-routes",
  ];
  const cacheById = new Map(contract.cache.policies.map((policy) => [policy.id, policy]));
  const staticPolicy = cacheById.get("web-static-immutable");
  const noStorePolicies = [
    "viewer-authorized-outward-no-store",
    "preview-no-store",
    "content-authorized-no-store",
    "dynamic-no-store",
    "forbidden",
  ].map((id) => cacheById.get(id));
  return [
    check(
      "route-ownership-projection",
      "trusted-health",
      requiredRoutes.every((id) => routeIds.has(id)) &&
        contract.routes.rows.every(({owner}) => owner && typeof owner === "object"),
      {requiredRouteCount: requiredRoutes.length, projectedRouteCount: routeIds.size},
    ),
    check(
      "static-cache-eligibility-projection",
      "viewer-cache-boundary",
      staticPolicy?.contentHashRequired === true &&
        staticPolicy?.outwardCacheControl === "public, max-age=31536000, immutable",
      {contentHashRequired: staticPolicy?.contentHashRequired === true, immutable: staticPolicy?.outwardCacheControl?.includes("immutable") === true},
    ),
    check(
      "dynamic-cache-bypass-projection",
      "viewer-cache-boundary",
      noStorePolicies.every((policy) => policy?.outwardCacheControl === "no-store"),
      {checkedPolicyCount: noStorePolicies.length},
    ),
    check(
      "private-storage-projection",
      "content-authority-isolation",
      contract.cache.privateObjectStorage === true &&
        contract.routes.rows.every(({pathPattern}) => !/bucket|object-storage|r2\.dev|s3/i.test(pathPattern)),
      {privateObjectStorage: contract.cache.privateObjectStorage === true},
    ),
  ];
}

function probeDefinitions(addresses) {
  const internalPaths = [
    "/internal/capture",
    "/internal/maintenance",
    "/internal/migrations",
    "/internal/deployment-control",
  ];
  return [
    {id: "web-shell", scenarioId: "trusted-health", origin: addresses.web, path: "/", statuses: [200]},
    {id: "trusted-health-live", scenarioId: "trusted-health", origin: addresses.api, path: "/health", statuses: [200], requestId: true, cacheControl: "no-store"},
    {id: "trusted-health-ready", scenarioId: "trusted-health", origin: addresses.api, path: "/ready", statuses: [200], requestId: true, cacheControl: "no-store"},
    {id: "origin-health-live", scenarioId: "trusted-health", origin: addresses.origin, path: "/health", statuses: [200], requestId: true, cacheControl: "no-store"},
    {id: "edge-health-live", scenarioId: "trusted-health", origin: addresses.edge, path: "/health", statuses: [200], requestId: true, cacheControl: "no-store"},
    {
      id: "api-untrusted-cors-refused",
      scenarioId: "content-authority-isolation",
      origin: addresses.api,
      path: "/health",
      statuses: [200],
      requestHeaders: {Origin: "https://deployment-verifier.invalid"},
      cacheControl: "no-store",
      corsOrigin: null,
    },
    {
      id: "viewer-unknown-no-store",
      scenarioId: "viewer-cache-boundary",
      origin: addresses.viewer,
      path: "/a/unknown-share-link-000000/",
      statuses: [404],
      cacheControl: "no-store",
      robotsPolicy: "noindex",
    },
    {
      id: "preview-unauthorized-no-store",
      scenarioId: "viewer-cache-boundary",
      origin: addresses.api,
      path: "/api/versions/00000000-0000-4000-8000-000000000000/content/",
      statuses: [401, 404],
      cacheControl: "no-store",
    },
    {
      id: "viewer-management-route-forbidden",
      scenarioId: "content-authority-isolation",
      origin: addresses.viewer,
      path: "/a/unknown-share-link-000000/api/artifacts",
      statuses: [404],
      cacheControl: "no-store",
    },
    {id: "content-health-live", scenarioId: "content-authority-isolation", origin: addresses.content, path: "/health", statuses: [200], requestId: true, cacheControl: "no-store"},
    {id: "content-health-ready", scenarioId: "content-authority-isolation", origin: addresses.content, path: "/ready", statuses: [200], requestId: true, cacheControl: "no-store"},
    {
      id: "content-public-credential-refused",
      scenarioId: "content-authority-isolation",
      origin: addresses.content,
      path: "/gallery-content/public/invalid-verifier-credential/index.html",
      statuses: [404],
      cacheControl: "no-store",
      referrerPolicy: "no-referrer",
      contentSecurityPolicy: true,
      permissionsPolicy: true,
      contentTypeOptions: "nosniff",
      corsOrigin: "*",
      corsCredentials: false,
    },
    {
      id: "content-review-credential-refused",
      scenarioId: "content-authority-isolation",
      origin: addresses.content,
      path: "/gallery-content/review/invalid-verifier-credential/index.html",
      statuses: [404],
      cacheControl: "no-store",
      referrerPolicy: "no-referrer",
      contentSecurityPolicy: true,
      permissionsPolicy: true,
      contentTypeOptions: "nosniff",
      corsOrigin: "*",
      corsCredentials: false,
    },
    {id: "content-management-route-forbidden", scenarioId: "content-authority-isolation", origin: addresses.content, path: "/api/artifacts", statuses: [404]},
    {id: "content-raw-object-route-forbidden", scenarioId: "content-authority-isolation", origin: addresses.content, path: "/objects/private-verifier-object", statuses: [200, 404], privateStorage: true},
    {id: "trusted-raw-object-route-forbidden", scenarioId: "content-authority-isolation", origin: addresses.api, path: "/objects/private-verifier-object", statuses: [200, 404], privateStorage: true},
    ...[addresses.api, addresses.viewer, addresses.content, addresses.origin, addresses.edge].flatMap((origin, originIndex) =>
      internalPaths.map((path, pathIndex) => ({
        id: `internal-route-forbidden-${originIndex + 1}-${pathIndex + 1}`,
        scenarioId: "content-authority-isolation",
        origin,
        path,
        statuses: [404],
      }))),
  ];
}

function probePassed(probe, response, evidence) {
  return Boolean(response) &&
    probe.statuses.includes(response.status) &&
    (!probe.cacheControl || evidence.cacheControl === probe.cacheControl) &&
    (!probe.requestId || evidence.requestIdPresent) &&
    (!probe.referrerPolicy || evidence.referrerPolicy === probe.referrerPolicy) &&
    (!probe.contentSecurityPolicy || evidence.contentSecurityPolicyPresent) &&
    (!probe.permissionsPolicy || evidence.permissionsPolicyPresent) &&
    (!probe.contentTypeOptions || evidence.contentTypeOptions === probe.contentTypeOptions) &&
    (!probe.robotsPolicy || evidence.robotsPolicy?.includes(probe.robotsPolicy)) &&
    (probe.corsOrigin === undefined || evidence.corsOrigin === probe.corsOrigin) &&
    (probe.corsCredentials === undefined || evidence.corsCredentialsPresent === probe.corsCredentials) &&
    !evidence.setCookiePresent &&
    !evidence.locationPresent &&
    (!probe.privateStorage || !evidence.storageMetadataPresent);
}

export async function runCoreVerification({
  topology = "kubernetes",
  addresses,
  applicationOrigin,
  contentOrigin,
  fetchImplementation = fetch,
}) {
  const normalizedAddresses = normalizeAddresses({addresses, applicationOrigin, contentOrigin});
  const contract = await loadCoreContract(topology);
  const checks = projectionChecks(contract);
  for (const probe of probeDefinitions(normalizedAddresses)) {
    const {response, error} = await request(
      fetchImplementation,
      probe.origin,
      probe.path,
      probe.requestHeaders,
    );
    const evidence = responseEvidence(response, error);
    checks.push(check(probe.id, probe.scenarioId, probePassed(probe, response, evidence), evidence));
  }
  if (contract.fixture) {
    for (const [id, reasonCode] of Object.entries(contract.fixture.expectedNotApplicable).sort(([left], [right]) => left.localeCompare(right))) {
      const scenario = contract.scenarios.get(id);
      if (
        !scenario?.appliesTo.includes("compose") ||
        scenario.disabledExpectation !== "not_applicable" ||
        scenario.notApplicableReason !== reasonCode
      ) {
        throw new TypeError(`Compose applicability projection disagrees with scenario ${id}.`);
      }
      checks.push(notApplicable(id, reasonCode));
    }
  }
  return Object.freeze({
    schemaVersion: "shareslices.verification-result/v1",
    contractSchemaVersion: contract.schemaVersion,
    contractDigest: contract.contractDigest,
    level: "core",
    topology,
    outcome: checks.every(({outcome}) => ["passed", "not_applicable"].includes(outcome)) ? "passed" : "failed",
    checks: Object.freeze(checks),
  });
}
