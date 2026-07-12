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
  const deployment = new Set([
    ...matches(composeText, /\$\{([A-Z][A-Z0-9_]+)/g),
    ...matches(kubernetesText, /^\s+(?:- name:\s+)?([A-Z][A-Z0-9_]+):/gm)
  ]);
  validateDeploymentConfiguration({
    catalog,
    runtime,
    deployment,
    runtimeOnly: new Set(["AUTH_EMAIL_SMTP_CHECK_TO", "AUTH_EMAIL_SMTP_URL_FILE"]),
    deploymentOnly: new Set(["API_UPSTREAM"])
  });

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
