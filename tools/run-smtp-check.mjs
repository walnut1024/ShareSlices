import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function applyLayer(target, layer) {
  if (Object.hasOwn(layer, "AUTH_EMAIL_SMTP_URL_FILE") && !Object.hasOwn(layer, "AUTH_EMAIL_SMTP_URL")) {
    delete target.AUTH_EMAIL_SMTP_URL;
  }
  if (Object.hasOwn(layer, "AUTH_EMAIL_SMTP_URL") && !Object.hasOwn(layer, "AUTH_EMAIL_SMTP_URL_FILE")) {
    delete target.AUTH_EMAIL_SMTP_URL_FILE;
  }
  Object.assign(target, layer);
}

export function buildSmtpCheckEnv(defaults, overrides, inherited) {
  const environment = { ...defaults };
  applyLayer(environment, overrides);
  applyLayer(environment, inherited);
  return environment;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const environment = buildSmtpCheckEnv(readEnvFile(".env.example"), readEnvFile(".env"), process.env);
  const result = spawnSync(
    "node",
    ["api/node_modules/tsx/dist/cli.mjs", "api/src/email/smtp-check.ts"],
    { env: environment, stdio: "inherit" }
  );
  process.exitCode = result.status ?? 1;
}
