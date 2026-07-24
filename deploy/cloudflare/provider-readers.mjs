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

function requireNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function sameProviderVersion(left, right) {
  return (
    (typeof left === "string" || typeof left === "number") &&
    (typeof right === "string" || typeof right === "number") &&
    String(left) === String(right)
  );
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

export function createCloudflareContainerApplicationReader({
  runCommand = defaultCommand,
  executable = wranglerPath,
} = {}) {
  return async ({names}) => {
    if (
      !Array.isArray(names) ||
      names.length === 0 ||
      names.some((name) => !requireNonEmptyString(name)) ||
      new Set(names).size !== names.length
    ) {
      throw new TargetAdapterError(
        "cloudflare_container_application_expectation_invalid",
        "Cloudflare Container application names are invalid.",
      );
    }
    const result = runCommand(executable, ["containers", "list", "--json"]);
    const applications = parseJson(result.stdout);
    if (result.status !== 0 || !Array.isArray(applications)) {
      throw new TargetAdapterError(
        "cloudflare_container_applications_unavailable",
        "Cloudflare Container applications could not be read as structured JSON.",
      );
    }
    return Object.freeze(Object.fromEntries(names.map((name) => {
      const matches = applications.filter((application) => application?.name === name);
      if (matches.length !== 1 || !requireNonEmptyString(matches[0]?.id)) {
        throw new TargetAdapterError(
          "cloudflare_container_application_identity_mismatch",
          "Cloudflare Container application identity does not match the deployment configuration.",
        );
      }
      return [name, matches[0].id];
    })));
  };
}

export function createCloudflareContainerInstanceReader({
  runCommand = defaultCommand,
  executable = wranglerPath,
} = {}) {
  return async ({applications, terminalEvidence}) => {
    if (
      !Array.isArray(applications) ||
      applications.length === 0 ||
      applications.some((application) =>
        !requireNonEmptyString(application?.name) ||
        !requireNonEmptyString(application?.image) ||
        !["string", "number"].includes(typeof application?.version)
      ) ||
      new Set(applications.map(({name}) => name)).size !== applications.length
    ) {
      throw new TargetAdapterError(
        "cloudflare_container_expectation_invalid",
        "Cloudflare Container application expectations are invalid.",
      );
    }
    const reportedInstances = terminalEvidence?.containers?.map(
      ({providerInstance}) => providerInstance,
    );
    if (
      !Array.isArray(reportedInstances) ||
      reportedInstances.length === 0 ||
      reportedInstances.some((identity) => !requireNonEmptyString(identity)) ||
      new Set(reportedInstances).size !== reportedInstances.length
    ) {
      throw new TargetAdapterError(
        "cloudflare_container_evidence_invalid",
        "Cloudflare Container runtime evidence is invalid.",
      );
    }

    const listResult = runCommand(executable, ["containers", "list", "--json"]);
    const listedApplications = parseJson(listResult.stdout);
    if (listResult.status !== 0 || !Array.isArray(listedApplications)) {
      throw new TargetAdapterError(
        "cloudflare_container_applications_unavailable",
        "Cloudflare Container applications could not be read as structured JSON.",
      );
    }

    const observedInstances = [];
    for (const expected of applications) {
      const matches = listedApplications.filter(({name}) => name === expected.name);
      if (
        matches.length !== 1 ||
        !requireNonEmptyString(matches[0]?.id) ||
        matches[0].image !== expected.image ||
        !sameProviderVersion(matches[0].version, expected.version)
      ) {
        throw new TargetAdapterError(
          "cloudflare_container_application_identity_mismatch",
          "Cloudflare Container application identity does not match the authorized release.",
        );
      }
      const application = matches[0];
      const instancesResult = runCommand(executable, [
        "containers",
        "instances",
        application.id,
        "--json",
      ]);
      const instances = parseJson(instancesResult.stdout);
      if (
        instancesResult.status !== 0 ||
        !Array.isArray(instances) ||
        instances.some((instance) =>
          !requireNonEmptyString(instance?.id) ||
          !["running", "provisioning", "failed", "stopping", "stopped", "unhealthy", "inactive"]
            .includes(instance?.state) ||
          (instance.state !== "inactive" &&
            !["string", "number"].includes(typeof instance?.version))
        )
      ) {
        throw new TargetAdapterError(
          "cloudflare_container_instances_unavailable",
          "Cloudflare Container instances could not be read as structured JSON.",
        );
      }
      for (const instance of instances) {
        if (["stopped", "stopping", "failed", "inactive"].includes(instance.state)) {
          continue;
        }
        if (!sameProviderVersion(instance.version, expected.version)) {
          throw new TargetAdapterError(
            "cloudflare_container_previous_version_selectable",
            "A selectable Cloudflare Container instance belongs to another application version.",
          );
        }
        observedInstances.push(instance.id);
      }
    }

    if (
      reportedInstances.some((identity) => !observedInstances.includes(identity))
    ) {
      throw new TargetAdapterError(
        "cloudflare_container_instance_identity_mismatch",
        "Cloudflare Container runtime evidence does not match provider instance inventory.",
      );
    }
    return Object.freeze([...reportedInstances].sort());
  };
}
