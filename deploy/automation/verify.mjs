import {readFile} from "node:fs/promises";

import {sha256Digest} from "./canonical.mjs";

const requestTimeoutMs = 5_000;
const contractUrl = new URL("../contract/verification-scenarios.json", import.meta.url);

async function loadCoreContract() {
  const bytes = await readFile(contractUrl);
  const contract = JSON.parse(bytes.toString("utf8"));
  const scenarios = new Map(contract.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const id of ["trusted-health", "viewer-cache-boundary", "content-authority-isolation"]) {
    const scenario = scenarios.get(id);
    if (!scenario || scenario.level !== "core" || scenario.mutating !== false) {
      throw new TypeError(`Verification contract is missing read-only core scenario ${id}.`);
    }
  }
  return {schemaVersion: contract.schemaVersion, contractDigest: sha256Digest(contract)};
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

async function request(fetchImplementation, origin, path, method = "GET") {
  try {
    const response = await fetchImplementation(new URL(path, origin), {
      method,
      redirect: "manual",
      credentials: "omit",
      headers: {"User-Agent": "ShareSlices-Deployment-Verifier/1"},
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
    requestIdPresent: Boolean(header(response, "x-request-id")),
    referrerPolicy: header(response, "referrer-policy"),
    setCookiePresent: Boolean(header(response, "set-cookie")),
    locationPresent: Boolean(header(response, "location")),
  };
}

export async function runCoreVerification({
  applicationOrigin,
  contentOrigin,
  fetchImplementation = fetch,
}) {
  const contract = await loadCoreContract();
  const probes = [
    {id: "trusted-health-live", scenarioId: "trusted-health", origin: applicationOrigin, path: "/health", statuses: [200], requestId: true},
    {id: "trusted-health-ready", scenarioId: "trusted-health", origin: applicationOrigin, path: "/ready", statuses: [200], requestId: true},
    {
      id: "viewer-unknown-no-store",
      scenarioId: "viewer-cache-boundary",
      origin: applicationOrigin,
      path: "/a/unknown-share-link-000000/",
      statuses: [404],
      cacheControl: "no-store",
    },
    {
      id: "preview-unauthorized-no-store",
      scenarioId: "viewer-cache-boundary",
      origin: applicationOrigin,
      path: "/api/versions/00000000-0000-4000-8000-000000000000/content/",
      statuses: [401, 404],
      cacheControl: "no-store",
    },
    {id: "content-health-live", scenarioId: "content-authority-isolation", origin: contentOrigin, path: "/health", statuses: [200]},
    {id: "content-health-ready", scenarioId: "content-authority-isolation", origin: contentOrigin, path: "/ready", statuses: [200]},
    {
      id: "content-public-credential-refused",
      scenarioId: "content-authority-isolation",
      origin: contentOrigin,
      path: "/gallery-content/public/invalid-verifier-credential/index.html",
      statuses: [404],
      cacheControl: "no-store",
      referrerPolicy: "no-referrer",
    },
    {
      id: "content-review-credential-refused",
      scenarioId: "content-authority-isolation",
      origin: contentOrigin,
      path: "/gallery-content/review/invalid-verifier-credential/index.html",
      statuses: [404],
      cacheControl: "no-store",
      referrerPolicy: "no-referrer",
    },
    {id: "trusted-internal-route-forbidden", scenarioId: "content-authority-isolation", origin: applicationOrigin, path: "/internal/deployment-verifier", statuses: [404]},
    {id: "content-internal-route-forbidden", scenarioId: "content-authority-isolation", origin: contentOrigin, path: "/internal/deployment-verifier", statuses: [404]},
    {id: "content-management-route-forbidden", scenarioId: "content-authority-isolation", origin: contentOrigin, path: "/api/artifacts", statuses: [404]},
  ];
  const checks = [];
  for (const probe of probes) {
    const {response, error} = await request(fetchImplementation, probe.origin, probe.path);
    const evidence = responseEvidence(response, error);
    const passed = Boolean(response) &&
      probe.statuses.includes(response.status) &&
      (!probe.cacheControl || evidence.cacheControl === probe.cacheControl) &&
      (!probe.requestId || evidence.requestIdPresent) &&
      (!probe.referrerPolicy || evidence.referrerPolicy === probe.referrerPolicy) &&
      !evidence.setCookiePresent &&
      !evidence.locationPresent;
    checks.push(check(probe.id, probe.scenarioId, passed, evidence));
  }
  return Object.freeze({
    schemaVersion: "shareslices.verification-result/v1",
    contractSchemaVersion: contract.schemaVersion,
    contractDigest: contract.contractDigest,
    level: "core",
    outcome: checks.every(({outcome}) => outcome === "passed") ? "passed" : "failed",
    checks: Object.freeze(checks),
  });
}
