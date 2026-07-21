#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { DeploymentConfigError, loadDeploymentConfig } from "./config.mjs";

const commands = new Set([
  "doctor",
  "render",
  "plan",
  "apply",
  "status",
  "verify",
  "rollback",
]);

export const exitCodes = Object.freeze({
  succeeded: 0,
  invalidInput: 2,
  prerequisiteUnavailable: 3,
  refused: 4,
  failed: 5,
  indeterminate: 6,
  externalReconcilerRequired: 20,
});

export function deploymentResult(command, overrides = {}) {
  return {
    schemaVersion: "shareslices.deployment-result/v1",
    command,
    target: null,
    requestedRelease: null,
    outcome: "failed",
    reason: null,
    data: null,
    ...overrides,
  };
}

export function parseInvocation(argv) {
  const [command, ...arguments_] = argv;
  if (!commands.has(command)) {
    return {
      exitCode: exitCodes.invalidInput,
        result: deploymentResult(null, {
        reason: {
          code: "invalid_deployment_command",
          message: "Expected doctor, render, plan, apply, status, verify, or rollback.",
        },
      }),
    };
  }

  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      return {
        exitCode: exitCodes.invalidInput,
        result: deploymentResult(command, {
          reason: {
            code: "invalid_deployment_arguments",
            message: "Options must use --name value pairs.",
          },
        }),
      };
    }
    const key = name.slice(2);
    if (!new Set(["config", "release", "plan", "operation"]).has(key) || options[key] !== undefined) {
      return {
        exitCode: exitCodes.invalidInput,
        result: deploymentResult(command, {
          reason: {
            code: "invalid_deployment_arguments",
            message: "Only one --config, --release, --plan, and --operation option is accepted.",
          },
        }),
      };
    }
    options[key] = value;
  }
  return { command, options };
}

async function unimplementedExecution({ command, options }) {
  try {
    const config = await loadDeploymentConfig(options.config);
    return {
      exitCode: exitCodes.failed,
      result: deploymentResult(command, {
        target: config.target,
        requestedRelease: options.release ?? null,
        reason: {
          code: "deployment_command_not_implemented",
          message: "The target Adapter for this deployment command is not implemented yet.",
        },
      }),
    };
  } catch (error) {
    if (!(error instanceof DeploymentConfigError)) throw error;
    return {
      exitCode: exitCodes.invalidInput,
      result: deploymentResult(command, {
        requestedRelease: options.release ?? null,
        reason: { code: error.code, message: error.message },
      }),
    };
  }
}

export async function executeInvocation(invocation, execute = unimplementedExecution) {
  if ("exitCode" in invocation) return invocation;
  return execute(invocation);
}

export async function main(argv = process.argv.slice(2), output = process.stdout) {
  const execution = await executeInvocation(parseInvocation(argv));
  output.write(`${JSON.stringify(execution.result)}\n`);
  return execution.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
