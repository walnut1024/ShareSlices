#!/usr/bin/env node

import {pathToFileURL} from "node:url";

import {createCloudflareAdapter} from "../cloudflare/adapter.mjs";
import {
  createCloudflareTerraformStateReader,
  createCloudflareWranglerDeploymentReader,
} from "../cloudflare/provider-readers.mjs";
import {createCloudflareProviderObserver} from "../cloudflare/provider-observation.mjs";
import {createCloudflareStateObserver} from "../cloudflare/state-observation.mjs";
import {createCloudflareStatusObserver} from "../cloudflare/status-observation.mjs";
import {createCloudflareTerraformObserver} from "../cloudflare/terraform-observation.mjs";
import {createCloudflareWranglerObserver} from "../cloudflare/wrangler-observation.mjs";
import {createKubernetesAdapter} from "../kubernetes/adapter.mjs";
import {
  createOciImageAvailabilityProbe,
  createReleaseStoreAccessProbe,
} from "../kubernetes/artifact-probes.mjs";
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
import {createProductionRollbackExecutor} from "./production-rollback.mjs";
import {TargetAdapterError} from "./target-adapter.mjs";

export function createProductionKubernetesAdapter({
  environment = process.env,
  createAdapter = createKubernetesAdapter,
  createControlObserver = createPostgresControlObserver,
  createPlanApplier = createProductionPlanApplier,
  createReleaseFinalizer = createProductionReleaseFinalizer,
  createRollbackExecutor = createProductionRollbackExecutor,
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
  const rollbackRelease = async (input) => {
    const owner = environment.SHARESLICES_DEPLOYMENT_PRINCIPAL;
    if (!owner) {
      throw new TargetAdapterError(
        "deployment_principal_required",
        "Production rollback requires SHARESLICES_DEPLOYMENT_PRINCIPAL.",
      );
    }
    return createRollbackExecutor({resolvers: resolvers(), owner})(input);
  };
  const probeReleaseStoreAccess = async (input) => createReleaseStoreAccessProbe({
    resolvers: resolvers(),
  })(input);
  const probeImageAvailability = createOciImageAvailabilityProbe();
  return createAdapter({
    observeState: createKubernetesStateObserver({observeControl}),
    observeStatus: createKubernetesStatusObserver({observeControl}),
    applyPlan,
    finalizeRelease,
    rollbackRelease,
    probeReleaseStoreAccess,
    probeImageAvailability,
  });
}

export function createProductionCloudflareAdapter({
  environment = process.env,
  createAdapter = createCloudflareAdapter,
  createControlObserver = createPostgresControlObserver,
  createStateObserver = createCloudflareStateObserver,
  createStatusObserver = createCloudflareStatusObserver,
  createTerraformObserver = createCloudflareTerraformObserver,
  createWranglerObserver = createCloudflareWranglerObserver,
  createProviderObserver = createCloudflareProviderObserver,
  readTerraformState = createCloudflareTerraformStateReader(),
  readWranglerDeployments = createCloudflareWranglerDeploymentReader(),
} = {}) {
  const resolvers = () => {
    const root = environment.SHARESLICES_SECRET_ROOT;
    if (!root) {
      throw new TargetAdapterError(
        "deployment_secret_root_required",
        "Production Cloudflare observation requires SHARESLICES_SECRET_ROOT.",
      );
    }
    return createFileSecretResolvers(root);
  };
  const observeControl = async ({config}) => {
    validateSecretReferenceForFileResolution(config.shared.database);
    return createControlObserver({resolvers: resolvers()})({config});
  };
  const observeState = createStateObserver({
    observeControl,
    observeTerraform: createTerraformObserver({readState: readTerraformState}),
    observeWrangler: createWranglerObserver({
      readDeployments: readWranglerDeployments,
    }),
  });
  const observeProvider = async (input) => createProviderObserver({
    resolvers: resolvers(),
  })(input);
  const observeStatus = createStatusObserver({
    observeControl,
    observeProvider,
    readTerraformState,
    readWranglerDeployments,
  });
  const probeReleaseStoreAccess = async (input) => createReleaseStoreAccessProbe({
    resolvers: resolvers(),
  })(input);
  return createAdapter({
    observeProvider,
    observeState,
    observeStatus,
    probeReleaseStoreAccess,
  });
}

export function createProductionExecutor({
  kubernetesAdapter = createProductionKubernetesAdapter(),
  cloudflareAdapter = createProductionCloudflareAdapter(),
} = {}) {
  return createLifecycleExecutor({
    kubernetes: kubernetesAdapter,
    cloudflare: cloudflareAdapter,
  });
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
