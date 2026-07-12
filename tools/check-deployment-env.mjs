import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

function matches(value, pattern) {
  return new Set([...value.matchAll(pattern)].map((match) => match[1]));
}

const catalogText = await text(".env.example");
const catalog = matches(catalogText, /^#?\s*([A-Z][A-Z0-9_]+)=/gm);
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

const referenced = new Set([
  ...matches(apiText, /^\s{4}([A-Z][A-Z0-9_]+):/gm),
  ...matches(apiText, /source\.([A-Z][A-Z0-9_]+)/g),
  ...matches(workerText, /"([A-Z][A-Z0-9_]+)"/g),
  ...matches(composeText, /\$\{([A-Z][A-Z0-9_]+)/g),
  ...matches(kubernetesText, /^\s+(?:- name:\s+)?([A-Z][A-Z0-9_]+):/gm)
]);

const missing = [...referenced].filter((name) => !catalog.has(name)).sort();
if (missing.length > 0) {
  throw new Error(`Deployment variables missing from .env.example: ${missing.join(", ")}`);
}

for (const removed of ["AUTH_EMAIL_DELIVERY_MODE", "AUTH_EMAIL_HTTP_URL", "AUTH_EMAIL_HTTP_TOKEN"]) {
  if (catalogText.includes(removed) || apiText.includes(removed) || composeText.includes(removed) || kubernetesText.includes(removed)) {
    throw new Error(`Removed deployment variable is still referenced: ${removed}`);
  }
}

console.log(`Deployment configuration catalog covers ${referenced.size} referenced variables.`);
