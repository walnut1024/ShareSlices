import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

import {TargetAdapterError} from "../automation/target-adapter.mjs";

const terraformDirectory = fileURLToPath(
  new URL("./terraform", import.meta.url),
);
const wranglerPath = fileURLToPath(
  new URL("../../node_modules/.bin/wrangler", import.meta.url),
);

function defaultCommand(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJson(value) {
  const arrayStart = value.indexOf("[");
  const objectStart = value.indexOf("{");
  const starts = [arrayStart, objectStart].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  try {
    return JSON.parse(value.slice(start));
  } catch {
    return null;
  }
}

export function createCloudflareTerraformStateReader({
  runCommand = defaultCommand,
  directory = terraformDirectory,
} = {}) {
  return async () => {
    const result = runCommand("terraform", [`-chdir=${directory}`, "state", "pull"]);
    const state = parseJson(result.stdout);
    if (
      result.status !== 0 ||
      !state ||
      typeof state.lineage !== "string" ||
      !Number.isSafeInteger(state.serial) ||
      typeof state.outputs !== "object" ||
      state.outputs === null
    ) {
      throw new TargetAdapterError(
        "cloudflare_terraform_state_unavailable",
        "Cloudflare Terraform state could not be read as structured JSON.",
      );
    }
    return {
      lineage: state.lineage,
      serial: state.serial,
      outputs: state.outputs,
    };
  };
}

export function createCloudflareWranglerDeploymentReader({
  runCommand = defaultCommand,
  executable = wranglerPath,
} = {}) {
  return async ({name}) => {
    const result = runCommand(executable, [
      "deployments",
      "list",
      "--name",
      name,
      "--json",
    ]);
    if (result.status !== 0) {
      if (/\[code:\s*10007\]/.test(result.stderr)) return [];
      throw new TargetAdapterError(
        "cloudflare_wrangler_deployments_unavailable",
        "Cloudflare Worker deployments could not be read as structured JSON.",
      );
    }
    const deployments = parseJson(result.stdout);
    if (!Array.isArray(deployments)) {
      throw new TargetAdapterError(
        "cloudflare_wrangler_deployments_invalid",
        "Cloudflare Worker deployments response is not a JSON array.",
      );
    }
    return deployments;
  };
}
