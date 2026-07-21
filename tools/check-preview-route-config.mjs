import { readFile } from "node:fs/promises";

const renderedConfigurations = [
  "web/vite.config.ts",
  "deploy/compose/Caddyfile",
  "deploy/kubernetes/base/configmap.yaml",
];

for (const source of renderedConfigurations) {
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

const dockerfile = await readFile(new URL("../web/Dockerfile", import.meta.url), "utf8");
if (!dockerfile.includes("COPY --chown=10001:10001 deploy/compose/Caddyfile /etc/caddy/Caddyfile")) {
  throw new Error("web/Dockerfile does not install the canonical Compose Caddy configuration.");
}

console.log(
  `Preview route policy covers ${renderedConfigurations.length} trusted-Web configurations and the Web image reuses the canonical Caddy configuration.`,
);
