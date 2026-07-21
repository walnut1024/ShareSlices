import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function validateGalleryLocalConfiguration(configuration) {
  const services = configuration.services ?? {};
  const apiEnvironment = services.api?.environment ?? {};
  const expectedOrigin = apiEnvironment.WEB_ORIGIN;
  if (!expectedOrigin) throw new Error("Gallery local API is missing WEB_ORIGIN.");

  let canonicalHost;
  try {
    canonicalHost = new URL(expectedOrigin).hostname;
  } catch {
    throw new Error(`Gallery local WEB_ORIGIN is invalid: ${expectedOrigin}`);
  }

  for (const serviceName of ["migrate", "maintenance", "gallery-content", "web"]) {
    const actual = services[serviceName]?.environment?.WEB_ORIGIN;
    if (actual !== expectedOrigin) {
      throw new Error(
        `Gallery local ${serviceName} WEB_ORIGIN must match API WEB_ORIGIN (${expectedOrigin}); received ${actual ?? "missing"}.`,
      );
    }
  }

  if (apiEnvironment.BETTER_AUTH_URL !== expectedOrigin) {
    throw new Error("Gallery local BETTER_AUTH_URL must match WEB_ORIGIN.");
  }

  const configuredHost = services.web?.environment?.WEB_CANONICAL_HOST;
  if (configuredHost !== canonicalHost) {
    throw new Error(
      `Gallery local WEB_CANONICAL_HOST must equal WEB_ORIGIN hostname (${canonicalHost}); received ${configuredHost ?? "missing"}.`,
    );
  }

  return { origin: expectedOrigin, host: canonicalHost };
}

function resolvedComposeConfiguration({ connectionArgs = [], environment = process.env } = {}) {
  const result = spawnSync(
    "docker",
    [
      ...connectionArgs,
      "compose",
      "--project-directory",
      repositoryRoot,
      "-p",
      "shareslices",
      "-f",
      "deploy/compose/compose.yaml",
      "-f",
      "deploy/compose/compose.gallery-local.yaml",
      "config",
      "--format",
      "json",
    ],
    { cwd: repositoryRoot, encoding: "utf8", env: environment },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Could not resolve Gallery local Compose configuration.");
  }
  return JSON.parse(result.stdout);
}

export function runGalleryConfigurationCheck(options) {
  const canonical = validateGalleryLocalConfiguration(resolvedComposeConfiguration(options));
  console.log(`Gallery local canonical Web origin: ${canonical.origin}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGalleryConfigurationCheck();
}
