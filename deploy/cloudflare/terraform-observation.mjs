import {TargetAdapterError} from "../automation/target-adapter.mjs";

function desiredResource(bundle, logicalId) {
  return bundle.phases
    .flatMap(({resources}) => resources)
    .find((resource) => resource.logicalId === logicalId);
}

function outputValue(outputs, name) {
  const output = outputs?.[name];
  if (
    !output ||
    output.sensitive === true ||
    !Object.hasOwn(output, "value") ||
    typeof output.value !== "object" ||
    output.value === null
  ) {
    throw new TargetAdapterError(
      "cloudflare_terraform_output_invalid",
      "Cloudflare Terraform output is missing, sensitive, or malformed.",
    );
  }
  return output.value;
}

function prerequisitesMatch(config, desired, observed) {
  return (
    observed.account_id === config.cloudflare.accountId &&
    observed.artifact_bucket_name === desired.artifactBucketName &&
    observed.deployment_state_bucket_name === desired.deploymentStateBucketName &&
    observed.jobs_queue_name === desired.jobsQueueName &&
    observed.dead_letter_queue_name === desired.deadLetterQueueName &&
    typeof observed.jobs_queue_id === "string" &&
    observed.jobs_queue_id.length > 0 &&
    typeof observed.dead_letter_queue_id === "string" &&
    observed.dead_letter_queue_id.length > 0 &&
    observed.hyperdrive_name === desired.hyperdriveName &&
    typeof observed.hyperdrive_id === "string" &&
    observed.hyperdrive_id.length > 0 &&
    observed.hyperdrive_caching_disabled === desired.hyperdriveCachingDisabled &&
    observed.hyperdrive_origin_sslmode === desired.hyperdriveOriginSslmode &&
    Number.isSafeInteger(observed.hyperdrive_connection_limit) &&
    observed.hyperdrive_connection_limit > 0
  );
}

export function createCloudflareTerraformObserver({readState} = {}) {
  if (typeof readState !== "function") {
    throw new TypeError("Cloudflare Terraform observation requires a structured state reader.");
  }
  return async ({config, release, bundle}) => {
    const state = await readState({config, release, bundle});
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.lineage !== "string" ||
      state.lineage.length === 0 ||
      !Number.isSafeInteger(state.serial) ||
      state.serial < 0 ||
      typeof state.outputs !== "object" ||
      state.outputs === null
    ) {
      throw new TargetAdapterError(
        "cloudflare_terraform_state_invalid",
        "Cloudflare Terraform state identity is incomplete.",
      );
    }
    const prerequisite = desiredResource(
      bundle,
      "cloudflare/terraform/private-prerequisites",
    );
    if (!prerequisite) {
      throw new TargetAdapterError(
        "cloudflare_terraform_bundle_invalid",
        "Cloudflare target bundle is missing Terraform prerequisites.",
      );
    }
    const privatePrerequisites = outputValue(
      state.outputs,
      "private_prerequisites",
    );
    const activation = outputValue(state.outputs, "activation");
    if (!prerequisitesMatch(config, prerequisite.desired, privatePrerequisites)) {
      throw new TargetAdapterError(
        "cloudflare_terraform_prerequisite_drift",
        "Cloudflare Terraform prerequisites do not match the target bundle.",
      );
    }
    if (
      typeof activation.enabled !== "boolean" ||
      typeof activation.custom_domains !== "object" ||
      activation.custom_domains === null ||
      typeof activation.worker_routes !== "object" ||
      activation.worker_routes === null
    ) {
      throw new TargetAdapterError(
        "cloudflare_terraform_activation_invalid",
        "Cloudflare Terraform activation output is malformed.",
      );
    }
    const resources = [{
      logicalId: prerequisite.logicalId,
      digest: prerequisite.digest,
      owner: "terraform",
      retention: prerequisite.retention,
      providerIdentity: {
        lineage: state.lineage,
        serial: state.serial,
        queueIds: [
          privatePrerequisites.jobs_queue_id,
          privatePrerequisites.dead_letter_queue_id,
        ],
        hyperdriveId: privatePrerequisites.hyperdrive_id,
      },
      releaseId: release?.releaseId ?? null,
      ownershipMarkers: {
        installation: config.installationId,
        owner: "terraform",
        release: release?.releaseId ?? null,
      },
    }];
    return Object.freeze({
      revision: `${state.lineage}:${state.serial}`,
      resources: Object.freeze(resources),
      activation: Object.freeze({
        enabled: activation.enabled,
        customDomainCount: Object.keys(activation.custom_domains).length,
        workerRouteCount: Object.keys(activation.worker_routes).length,
      }),
    });
  };
}
