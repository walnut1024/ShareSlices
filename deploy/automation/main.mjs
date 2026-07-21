#!/usr/bin/env node

import {pathToFileURL} from "node:url";

import {createKubernetesAdapter} from "../kubernetes/adapter.mjs";
import {executeInvocation, parseInvocation} from "./cli.mjs";
import {
  createFileSecretResolvers,
  createKubernetesStatusObserver,
  createKubernetesStateObserver,
  createPostgresControlObserver,
  validateSecretReferenceForFileResolution,
} from "./control-observation.mjs";
import {createLifecycleExecutor} from "./lifecycle.mjs";
import {createProductionPlanApplier} from "./production-apply.mjs";
import {createProductionReleaseFinalizer} from "./production-finalize.mjs";
import {TargetAdapterError} from "./target-adapter.mjs";

export function createProductionKubernetesAdapter({
  environment = process.env,
  createAdapter = createKubernetesAdapter,
  createControlObserver = createPostgresControlObserver,
  createPlanApplier = createProductionPlanApplier,
  createReleaseFinalizer = createProductionReleaseFinalizer,
} = {}) {
  const resolvers = () => {
    const root = environment.SHARESLICES_SECRET_ROOT;
    if (!root) {
      throw new TargetAdapterError(
        "deployment_secret_root_required",
        "Production control observation requires SHARESLICES_SECRET_ROOT.",
      );
    }
    return createFileSecretResolvers(root);
  };
  const observeControl = async ({config}) => {
    validateSecretReferenceForFileResolution(config.shared.database);
    return createControlObserver({resolvers: resolvers()})({config});
  };
  const applyPlan = async (input) => {
    const owner = environment.SHARESLICES_DEPLOYMENT_PRINCIPAL;
    if (!owner) {
      throw new TargetAdapterError(
        "deployment_principal_required",
        "Production apply requires SHARESLICES_DEPLOYMENT_PRINCIPAL.",
      );
    }
    return createPlanApplier({resolvers: resolvers(), owner})(input);
  };
  const finalizeRelease = async (input) => {
    const owner = environment.SHARESLICES_DEPLOYMENT_PRINCIPAL;
    if (!owner) {
      throw new TargetAdapterError(
        "deployment_principal_required",
        "Production release finalization requires SHARESLICES_DEPLOYMENT_PRINCIPAL.",
      );
    }
    return createReleaseFinalizer({resolvers: resolvers(), owner})(input);
  };
  return createAdapter({
    observeState: createKubernetesStateObserver({observeControl}),
    observeStatus: createKubernetesStatusObserver({observeControl}),
    applyPlan,
    finalizeRelease,
  });
}

export function createProductionExecutor({
  kubernetesAdapter = createProductionKubernetesAdapter(),
} = {}) {
  return createLifecycleExecutor({kubernetes: kubernetesAdapter});
}

export async function main(
  argv = process.argv.slice(2),
  output = process.stdout,
  execute = createProductionExecutor(),
) {
  const execution = await executeInvocation(parseInvocation(argv), execute);
  output.write(`${JSON.stringify(execution.result)}\n`);
  return execution.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
