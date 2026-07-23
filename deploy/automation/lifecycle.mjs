import { readFile } from "node:fs/promises";

import { diagnoseCloudflareDatabase } from "../cloudflare/database-doctor.mjs";
import {sha256Digest} from "./canonical.mjs";
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
import { bindTargetAdapter, TargetAdapterError } from "./target-adapter.mjs";

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

async function loadPlan(path) {
  if (!path) {
    throw new DeploymentLifecycleError(
      "deployment_plan_required",
      "An authorized deployment plan path is required.",
      exitCodes.invalidInput,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new DeploymentLifecycleError(
      "deployment_plan_unreadable",
      "Deployment plan could not be read as JSON.",
      exitCodes.invalidInput,
    );
  }
  const plan = parsed?.schemaVersion === "shareslices.deployment-result/v1"
    ? parsed.data?.plan
    : parsed;
  if (
    plan?.schemaVersion !== "shareslices.deployment-plan/v1" ||
    typeof plan.planDigest !== "string" ||
    !Array.isArray(plan.actions)
  ) {
    throw new DeploymentLifecycleError(
      "deployment_plan_invalid",
      "Deployment plan does not match the supported schema.",
      exitCodes.invalidInput,
    );
  }
  const {planDigest, ...body} = plan;
  if (sha256Digest(body) !== planDigest) {
    throw new DeploymentLifecycleError(
      "deployment_plan_digest_mismatch",
      "Deployment plan digest does not match its canonical content.",
      exitCodes.invalidInput,
    );
  }
  return plan;
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

async function executeReadOnly({ command, config, release, adapter, options }) {
  if (command === "doctor") {
    const prerequisites = discoverPrerequisites(config);
    const diagnosis = await adapter.doctor({ config, prerequisites, release });
    if (!diagnosis || !Array.isArray(diagnosis.checks)) {
      throw new DeploymentLifecycleError(
        "deployment_doctor_result_invalid",
        "Target Adapter returned an invalid doctor result.",
      );
    }
    if (config.target === "cloudflare") {
      diagnosis.checks.push(...diagnoseCloudflareDatabase(diagnosis.database));
    }
    const unavailable = diagnosis.checks.some(({ state }) => state === "unavailable");
    if (unavailable) {
      return {
        exitCode: exitCodes.prerequisiteUnavailable,
        result: deploymentResult(command, {
          target: config.target,
          requestedRelease: release?.releaseId ?? null,
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
      release?.releaseId ?? null,
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
    const operation = options.operation ?? "apply";
    if (!["apply", "rollback"].includes(operation)) {
      throw new DeploymentLifecycleError(
        "deployment_plan_operation_invalid",
        "Plan operation must be apply or rollback.",
        exitCodes.invalidInput,
      );
    }
    const bundle = validateBundleIdentity(
      await adapter.render({ config, release }),
      config,
      release,
    );
    const canonical = serializeCanonicalTargetBundle(bundle);
    const planning = await adapter.plan({
      config,
      release,
      bundle,
      bundleDigest: canonical.digest,
      operation,
    });
    const plan = buildDeploymentPlan({...planning, operation});
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

  if (command === "verify") {
    const verification = await adapter.verify({config, release, level: "core"});
    if (
      !verification ||
      verification.level !== "core" ||
      !["passed", "failed", "indeterminate"].includes(verification.outcome) ||
      !Array.isArray(verification.checks)
    ) {
      throw new DeploymentLifecycleError(
        "deployment_verification_result_invalid",
        "Target Adapter returned an invalid verification result.",
      );
    }
    if (verification.outcome !== "passed") {
      return {
        exitCode: verification.outcome === "indeterminate" ? exitCodes.indeterminate : exitCodes.failed,
        result: deploymentResult(command, {
          target: config.target,
          requestedRelease: release?.releaseId ?? null,
          outcome: verification.outcome,
          reason: {
            code: verification.outcome === "indeterminate"
              ? "deployment_verification_indeterminate"
              : "required_check_failed",
            message: "One or more required deployment checks did not pass.",
          },
          data: {verification},
        }),
      };
    }
    return successful(command, config.target, release?.releaseId ?? null, {verification});
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
      const release = ["render", "plan", "apply"].includes(command) ||
        (command === "doctor" && options.release) ||
        (["verify", "rollback"].includes(command) && options.release)
        ? await loadRelease(options.release)
        : null;
      requestedRelease = release?.releaseId ?? requestedRelease;
      if (command === "apply") {
        const plan = await loadPlan(options.plan);
        if (plan.operation !== "apply" || plan.target !== config.target || plan.releaseId !== release.releaseId) {
          throw new DeploymentLifecycleError(
            "deployment_plan_identity_mismatch",
            "Deployment plan does not match the selected target and release.",
            exitCodes.invalidInput,
          );
        }
        const bundle = validateBundleIdentity(await adapter.render({config, release}), config, release);
        const canonical = serializeCanonicalTargetBundle(bundle);
        if (plan.bundleDigest !== canonical.digest) {
          throw new DeploymentLifecycleError(
            "deployment_plan_bundle_mismatch",
            "Deployment plan does not authorize the rendered target bundle.",
            exitCodes.invalidInput,
          );
        }
        const result = await adapter.apply({
          config,
          release,
          bundle,
          plan,
          authorizedPlanDigest: plan.planDigest,
        });
        if (result?.outcome === "external_reconciler_required") {
          return {
            exitCode: exitCodes.externalReconcilerRequired,
            result: deploymentResult(command, {
              target: config.target,
              requestedRelease: release.releaseId,
              outcome: "external_reconciler_required",
              reason: {
                code: "external_reconciler_required",
                message: "An external reconciler must apply the immutable handoff.",
              },
              data: {bundleDigest: canonical.digest, phases: result.phases},
            }),
          };
        }
        return successful(command, config.target, release.releaseId, {
          bundleDigest: canonical.digest,
          phases: result?.phases ?? [],
        });
      }
      if (command === "rollback") {
        if (!release) {
          throw new DeploymentLifecycleError(
            "rollback_release_required",
            "Rollback requires an explicit immutable release.",
            exitCodes.invalidInput,
          );
        }
        const plan = await loadPlan(options.plan);
        if (plan.operation !== "rollback" || plan.target !== config.target || plan.releaseId !== release.releaseId) {
          throw new DeploymentLifecycleError(
            "deployment_plan_identity_mismatch",
            "Rollback plan does not match the selected target, operation, and release.",
            exitCodes.invalidInput,
          );
        }
        const bundle = validateBundleIdentity(await adapter.render({config, release}), config, release);
        const canonical = serializeCanonicalTargetBundle(bundle);
        if (plan.bundleDigest !== canonical.digest) {
          throw new DeploymentLifecycleError(
            "deployment_plan_bundle_mismatch",
            "Rollback plan does not authorize the rendered target bundle.",
            exitCodes.invalidInput,
          );
        }
        const result = await adapter.rollback({
          config,
          release,
          plan,
          authorizedPlanDigest: plan.planDigest,
        });
        if (result?.outcome === "refused") {
          return {
            exitCode: exitCodes.refused,
            result: deploymentResult(command, {
              target: config.target,
              requestedRelease: release.releaseId,
              outcome: "refused",
              reason: {
                code: result.refusalReasons?.[0] ?? "rollback_refused",
                message: "The requested rollback is not compatible with current deployment state.",
              },
              data: {rollback: result},
            }),
          };
        }
        if (result?.outcome === "external_reconciler_required") {
          return {
            exitCode: exitCodes.externalReconcilerRequired,
            result: deploymentResult(command, {
              target: config.target,
              requestedRelease: release.releaseId,
              outcome: "external_reconciler_required",
              reason: {
                code: "external_reconciler_required",
                message: "An external reconciler must apply the immutable rollback handoff.",
              },
              data: {rollback: result},
            }),
          };
        }
        if (result?.outcome !== "succeeded") {
          throw new DeploymentLifecycleError(
            "deployment_rollback_result_invalid",
            "Target Adapter returned an invalid rollback result.",
          );
        }
        return successful(command, config.target, release.releaseId, {rollback: result});
      }
      return await executeReadOnly({ command, config, release, adapter, options });
    } catch (error) {
      const known =
        error instanceof DeploymentLifecycleError ||
        error instanceof DeploymentConfigError ||
        error instanceof ReleaseQualificationError ||
        error instanceof TargetAdapterError;
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
