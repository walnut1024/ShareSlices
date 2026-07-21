import { readFile } from "node:fs/promises";

import { deploymentResult, exitCodes } from "./cli.mjs";
import {
  DeploymentConfigError,
  discoverPrerequisites,
  loadDeploymentConfig,
} from "./config.mjs";
import { buildDeploymentPlan } from "./plan.mjs";
import {
  ReleaseQualificationError,
  serializeCanonicalRelease,
  serializeCanonicalTargetBundle,
} from "./release.mjs";
import { deriveDeploymentStatus } from "./status.mjs";
import { bindTargetAdapter } from "./target-adapter.mjs";

export class DeploymentLifecycleError extends Error {
  constructor(code, message, exitCode = exitCodes.failed) {
    super(message);
    this.name = "DeploymentLifecycleError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

async function loadRelease(path) {
  if (!path) {
    throw new DeploymentLifecycleError(
      "deployment_release_required",
      "A release manifest path is required.",
      exitCodes.invalidInput,
    );
  }
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new DeploymentLifecycleError(
      "deployment_release_unreadable",
      "Release manifest could not be read.",
      exitCodes.invalidInput,
    );
  }
  let release;
  try {
    release = JSON.parse(contents);
  } catch {
    throw new DeploymentLifecycleError(
      "deployment_release_invalid_json",
      "Release manifest is not valid JSON.",
      exitCodes.invalidInput,
    );
  }
  serializeCanonicalRelease(release);
  return release;
}

function adapterFor(registry, target) {
  const implementation = registry?.[target];
  if (!implementation) {
    throw new DeploymentLifecycleError(
      "deployment_target_adapter_unavailable",
      `No ${target} target Adapter is registered.`,
      exitCodes.prerequisiteUnavailable,
    );
  }
  return bindTargetAdapter(implementation);
}

function successful(command, target, requestedRelease, data, outcome = "succeeded") {
  return {
    exitCode: exitCodes.succeeded,
    result: deploymentResult(command, {
      target,
      requestedRelease,
      outcome,
      data,
    }),
  };
}

function validateBundleIdentity(bundle, config, release) {
  if (
    !bundle ||
    bundle.target !== config.target ||
    bundle.releaseId !== release.releaseId
  ) {
    throw new DeploymentLifecycleError(
      "target_bundle_identity_mismatch",
      "Target bundle does not match the selected target and release.",
    );
  }
  return bundle;
}

async function executeReadOnly({ command, config, release, adapter }) {
  if (command === "doctor") {
    const prerequisites = discoverPrerequisites(config);
    const diagnosis = await adapter.doctor({ config, prerequisites });
    if (!diagnosis || !Array.isArray(diagnosis.checks)) {
      throw new DeploymentLifecycleError(
        "deployment_doctor_result_invalid",
        "Target Adapter returned an invalid doctor result.",
      );
    }
    const unavailable = diagnosis.checks.some(({ state }) => state === "unavailable");
    if (unavailable) {
      return {
        exitCode: exitCodes.prerequisiteUnavailable,
        result: deploymentResult(command, {
          target: config.target,
          outcome: "failed",
          reason: {
            code: "deployment_prerequisite_unavailable",
            message: "One or more deployment prerequisites are unavailable.",
          },
          data: { prerequisites, checks: diagnosis.checks },
        }),
      };
    }
    return successful(
      command,
      config.target,
      null,
      { prerequisites, checks: diagnosis.checks },
      diagnosis.checks.some(({ state }) => state === "warning") ? "warning" : "succeeded",
    );
  }

  if (command === "render") {
    const bundle = validateBundleIdentity(
      await adapter.render({ config, release }),
      config,
      release,
    );
    const canonical = serializeCanonicalTargetBundle(bundle);
    return successful(command, config.target, release.releaseId, {
      bundle,
      bundleDigest: canonical.digest,
    });
  }

  if (command === "plan") {
    const bundle = validateBundleIdentity(
      await adapter.render({ config, release }),
      config,
      release,
    );
    const canonical = serializeCanonicalTargetBundle(bundle);
    const planning = await adapter.plan({ config, release, bundle, bundleDigest: canonical.digest });
    const plan = buildDeploymentPlan(planning);
    if (plan.outcome === "refused") {
      return {
        exitCode: exitCodes.refused,
        result: deploymentResult(command, {
          target: config.target,
          requestedRelease: release.releaseId,
          outcome: "refused",
          reason: {
            code: plan.refusalReasons[0] ?? "deployment_plan_refused",
            message: "Deployment plan requires separate review.",
          },
          data: { bundleDigest: canonical.digest, plan },
        }),
      };
    }
    return successful(command, config.target, release.releaseId, {
      bundleDigest: canonical.digest,
      plan,
    });
  }

  if (command === "status") {
    const projection = await adapter.status({ config });
    return successful(command, config.target, null, {
      status: deriveDeploymentStatus(projection),
    });
  }

  throw new DeploymentLifecycleError(
    "deployment_command_not_wired",
    `${command} is not wired to the shared lifecycle yet.`,
  );
}

export function createLifecycleExecutor(adapterRegistry) {
  return async ({ command, options }) => {
    let config;
    let requestedRelease = options.release ?? null;
    try {
      config = await loadDeploymentConfig(options.config);
      const adapter = adapterFor(adapterRegistry, config.target);
      const release = ["render", "plan", "apply"].includes(command)
        ? await loadRelease(options.release)
        : null;
      requestedRelease = release?.releaseId ?? requestedRelease;
      return await executeReadOnly({ command, config, release, adapter });
    } catch (error) {
      const known =
        error instanceof DeploymentLifecycleError ||
        error instanceof DeploymentConfigError ||
        error instanceof ReleaseQualificationError;
      const normalized = known
        ? error
        : new DeploymentLifecycleError(
          "deployment_target_operation_failed",
          "Target Adapter operation failed.",
        );
      const exitCode = normalized.exitCode ?? (
        normalized instanceof DeploymentConfigError || normalized instanceof ReleaseQualificationError
          ? exitCodes.invalidInput
          : exitCodes.failed
      );
      return {
        exitCode,
        result: deploymentResult(command, {
          target: config?.target ?? null,
          requestedRelease,
          reason: { code: normalized.code, message: normalized.message },
        }),
      };
    }
  };
}
