import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baselinePath = fileURLToPath(
  new URL("../../compose/feature-baseline.json", import.meta.url),
);

export const composeFeatureBaseline = Object.freeze(
  JSON.parse(readFileSync(baselinePath, "utf8")),
);

function executeDocker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no diagnostic output";
    throw new Error(`docker ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function requireOption(help, option, command) {
  if (!new RegExp(`(^|\\s)${option.replaceAll("-", "\\-")}(\\s|$)`, "m").test(help)) {
    throw new Error(`Docker Compose ${command} does not support required option ${option}`);
  }
}

export function parseComposePsJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split("\n").map((line) => JSON.parse(line));
  }
}

export function assertResidentServicesReady(records, expectedServices) {
  const byService = new Map(records.map((record) => [record.Service, record]));
  for (const service of expectedServices) {
    const record = byService.get(service);
    if (!record) throw new Error(`Compose service ${service} is absent from machine-readable ps`);
    if (record.State !== "running") {
      throw new Error(`Compose service ${service} is ${record.State ?? "unknown"}, not running`);
    }
    if (record.Health && record.Health !== "healthy") {
      throw new Error(`Compose service ${service} health is ${record.Health}`);
    }
  }
}

export function verifyComposeCapabilities({
  connectionArgs,
  composeArgs,
  environment,
  executeCommand = executeDocker,
}) {
  const run = (args) => executeCommand([...connectionArgs, ...args], { env: environment });
  const version = run(["compose", "version", "--short"]);
  if (!/^v?\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    throw new Error(`Docker Compose returned an invalid version: ${version || "empty"}`);
  }
  const upHelp = run(["compose", "up", "--help"]);
  for (const option of composeFeatureBaseline.upOptions) requireOption(upHelp, option, "up");
  const psHelp = run(["compose", "ps", "--help"]);
  requireOption(psHelp, "--format", "ps");

  // Quiet validation proves that the selected Compose parser accepts the checked
  // long-form dependency conditions without returning the resolved, secret-bearing model.
  run([...composeArgs, "config", "--quiet"]);
  const records = parseComposePsJson(
    run([...composeArgs, "ps", "--format", composeFeatureBaseline.psFormat]),
  );
  return Object.freeze({ records: Object.freeze(records), version });
}

export function inspectComposeServices({
  connectionArgs,
  composeArgs,
  environment,
  executeCommand = executeDocker,
}) {
  return parseComposePsJson(
    executeCommand(
      [...connectionArgs, ...composeArgs, "ps", "--format", composeFeatureBaseline.psFormat],
      { env: environment },
    ),
  );
}
