import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function difference(left, right) {
  return [...left].filter((name) => !right.has(name)).sort();
}

function union(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

export function validateDeploymentConfiguration({
  catalog,
  runtime,
  deployment,
  runtimeOnly = new Set(),
  deploymentOnly = new Set()
}) {
  const missingFromCatalog = difference(union(runtime, deployment), catalog);
  if (missingFromCatalog.length > 0) {
    throw new Error(`Deployment variables missing from .env.example: ${missingFromCatalog.join(", ")}`);
  }

  const staleCatalog = difference(catalog, union(runtime, deployment, deploymentOnly));
  if (staleCatalog.length > 0) {
    throw new Error(`Stale .env.example variables have no typed or deployment owner: ${staleCatalog.join(", ")}`);
  }

  const untypedDeployment = difference(deployment, union(runtime, deploymentOnly));
  if (untypedDeployment.length > 0) {
    throw new Error(`Deployment variables have no typed runtime owner: ${untypedDeployment.join(", ")}`);
  }

  const missingFromDeployment = difference(runtime, union(deployment, runtimeOnly));
  if (missingFromDeployment.length > 0) {
    throw new Error(`Typed runtime variables are absent from deployment manifests: ${missingFromDeployment.join(", ")}`);
  }
}

export function composeEnvironmentKeys(value) {
  const keys = new Set();
  let environmentIndent = null;
  for (const line of value.split("\n")) {
    const indent = line.match(/^\s*/)[0].length;
    if (environmentIndent !== null) {
      if (line.trim() && indent <= environmentIndent) environmentIndent = null;
      else {
        const key = line.match(/^\s+([A-Z][A-Z0-9_]+):/);
        if (key) keys.add(key[1]);
      }
    }
    if (/^\s*environment:(?:\s|$)/.test(line)) environmentIndent = indent;
  }
  return keys;
}

async function checkRepository() {
  const root = new URL("../", import.meta.url);
  const text = (path) => readFile(new URL(path, root), "utf8");
  const matches = (value, pattern) => new Set([...value.matchAll(pattern)].map((match) => match[1]));
  const catalogText = await text(".env.example");
  const apiText = await text("api/src/env.ts");
  const workerText = await text("worker/src/config.rs");
  const composeText = await text("compose.yaml");
  const kubernetesText = (await Promise.all([
    "deploy/kubernetes/base/configmap.yaml",
    "deploy/kubernetes/base/secret.yaml",
    "deploy/kubernetes/base/api.yaml",
    "deploy/kubernetes/base/web.yaml",
    "deploy/kubernetes/base/worker.yaml",
    "deploy/kubernetes/overlays/intranet/addresses.yaml",
    "deploy/kubernetes/overlays/shared-test/addresses.yaml",
    "deploy/kubernetes/overlays/public-production/public-origins.yaml"
  ].map(text))).join("\n");

  const catalog = matches(catalogText, /^#?\s*([A-Z][A-Z0-9_]+)=/gm);
  const runtime = new Set([
    ...matches(apiText, /^\s{4}([A-Z][A-Z0-9_]+):/gm),
    ...matches(apiText, /source\.([A-Z][A-Z0-9_]+)/g),
    ...matches(workerText, /"([A-Z][A-Z0-9_]+)"/g)
  ]);
  const compose = union(matches(composeText, /\$\{([A-Z][A-Z0-9_]+)/g), composeEnvironmentKeys(composeText));
  const kubernetes = matches(kubernetesText, /^\s+(?:- name:\s+)?([A-Z][A-Z0-9_]+):/gm);
  const deployment = union(compose, kubernetes);
  const runtimeOnly = new Set(["AUTH_EMAIL_SMTP_CHECK_TO", "AUTH_EMAIL_SMTP_URL_FILE"]);
  const deploymentOnly = new Set(["API_UPSTREAM", "MINIO_ROOT_PASSWORD", "MINIO_ROOT_USER", "POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER", "WEB_CANONICAL_HOST"]);
  validateDeploymentConfiguration({
    catalog,
    runtime,
    deployment,
    runtimeOnly,
    deploymentOnly
  });
  for (const [target, variables] of [["Compose", compose], ["Kubernetes", kubernetes]]) {
    const missing = difference(runtime, union(variables, runtimeOnly));
    if (missing.length > 0) throw new Error(`${target} is missing typed runtime variables: ${missing.join(", ")}`);
  }

  for (const removed of ["AUTH_EMAIL_DELIVERY_MODE", "AUTH_EMAIL_HTTP_URL", "AUTH_EMAIL_HTTP_TOKEN"]) {
    if (catalogText.includes(removed) || apiText.includes(removed) || composeText.includes(removed) || kubernetesText.includes(removed)) {
      throw new Error(`Removed deployment variable is still referenced: ${removed}`);
    }
  }

  console.log(`Deployment configuration contract covers ${runtime.size} typed variables.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkRepository();
}
