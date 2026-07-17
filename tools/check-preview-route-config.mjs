import { readFile } from "node:fs/promises";

const sources = [
  "web/vite.config.ts",
  "web/Dockerfile",
  "deploy/compose/Caddyfile",
  "deploy/kubernetes/base/configmap.yaml",
  "deploy/kubernetes/overlays/public-production/public-origins.yaml",
];

for (const source of sources) {
  const content = await readFile(new URL(`../${source}`, import.meta.url), "utf8");
  if (!content.includes("console") || !content.includes("artifacts") || !content.includes("preview")) {
    throw new Error(`${source} does not match the canonical Console Preview route.`);
  }
  if (!content.includes("no-store")) {
    throw new Error(`${source} does not preserve the Preview no-store policy.`);
  }
  if (!content.includes("/artifacts") && !content.includes("(?:console\\/)?artifacts")) {
    throw new Error(`${source} does not preserve the legacy Preview route.`);
  }
}

console.log(`Preview route policy covers ${sources.length} trusted-Web configurations.`);
