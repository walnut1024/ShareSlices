import {sha256Digest} from "../automation/canonical.mjs";
import {serializeCanonicalTargetBundle} from "../automation/release.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/;

function requireObservation(source, observation) {
  if (
    !observation ||
    typeof observation !== "object" ||
    typeof observation.revision !== "string" ||
    observation.revision.length === 0 ||
    !Array.isArray(observation.resources)
  ) {
    throw new TargetAdapterError(
      `cloudflare_${source}_observation_invalid`,
      `Cloudflare ${source} observation is incomplete.`,
    );
  }
  return observation;
}

function normalizeResource(source, resource, installationId) {
  if (
    typeof resource?.logicalId !== "string" ||
    resource.logicalId.length === 0 ||
    !digestPattern.test(resource.digest ?? "") ||
    !["terraform", "wrangler", "deployment-module"].includes(resource.owner) ||
    !["active", "rollback", "durable", "external"].includes(resource.retention)
  ) {
    throw new TargetAdapterError(
      `cloudflare_${source}_resource_invalid`,
      `Cloudflare ${source} returned an invalid resource observation.`,
    );
  }
  if (
    resource.ownershipMarkers?.installation !== installationId ||
    resource.ownershipMarkers?.owner !== resource.owner
  ) {
    throw new TargetAdapterError(
      "cloudflare_resource_ownership_unproven",
      "An observed Cloudflare resource does not carry the required ownership markers.",
    );
  }
  return Object.freeze({
    logicalId: resource.logicalId,
    digest: resource.digest,
    owner: resource.owner,
    retention: resource.retention,
    providerIdentity: resource.providerIdentity ?? null,
    releaseId: resource.releaseId ?? null,
    ownershipMarkers: Object.freeze({
      installation: resource.ownershipMarkers.installation,
      owner: resource.ownershipMarkers.owner,
      release: resource.ownershipMarkers.release ?? null,
    }),
  });
}

function controlResources(control, config, release, bundle) {
  const desired = (bundle?.phases ?? []).flatMap(({resources}) => resources);
  const resources = [];
  const migration = desired.find(({phase}) => phase === "migration");
  if (
    migration &&
    control.databaseSchemaHead === migration.desired?.schemaHead
  ) {
    resources.push({
      logicalId: migration.logicalId,
      digest: migration.digest,
      owner: "deployment-module",
      retention: migration.retention,
      providerIdentity: {
        schemaHead: control.databaseSchemaHead,
        source: "postgresql",
      },
      releaseId: release?.releaseId ?? null,
      ownershipMarkers: {
        installation: config.installationId,
        owner: "deployment-module",
        release: release?.releaseId ?? null,
      },
    });
  }
  const verification = desired.find(({phase}) => phase === "verification");
  const active = control.releaseRecords?.active;
  const bundleDigest = verification
    ? serializeCanonicalTargetBundle(bundle).digest
    : null;
  if (
    verification &&
    active?.target === "cloudflare" &&
    active.releaseId === release?.releaseId &&
    active.bundleDigest === bundleDigest &&
    active.configurationDigest === bundle.configurationDigest
  ) {
    resources.push({
      logicalId: verification.logicalId,
      digest: verification.digest,
      owner: "deployment-module",
      retention: verification.retention,
      providerIdentity: {
        operationId: active.operationId,
        fencingToken: active.fencingToken,
      },
      releaseId: active.releaseId,
      ownershipMarkers: {
        installation: config.installationId,
        owner: "deployment-module",
        release: active.releaseId,
      },
    });
  }
  return resources;
}

export function createCloudflareStateObserver({
  observeControl,
  observeTerraform,
  observeWrangler,
} = {}) {
  if (
    typeof observeControl !== "function" ||
    typeof observeTerraform !== "function" ||
    typeof observeWrangler !== "function"
  ) {
    throw new TypeError(
      "Cloudflare state observation requires control, Terraform, and Wrangler observers.",
    );
  }
  return async ({config, release, bundle}) => {
    const [control, terraformRaw, wranglerRaw] = await Promise.all([
      observeControl({config}),
      observeTerraform({config, release, bundle}),
      observeWrangler({config, release, bundle}),
    ]);
    if (!control?.controlSchema || typeof control.controlSchema.revision !== "string") {
      throw new TargetAdapterError(
        "cloudflare_control_observation_invalid",
        "Cloudflare control-state observation is incomplete.",
      );
    }
    const terraform = requireObservation("terraform", terraformRaw);
    const wrangler = requireObservation("wrangler", wranglerRaw);
    const resources = [];
    const logicalIds = new Set();
    for (const [source, observation] of [
      ["control", {
        revision: control.controlSchema.revision,
        resources: controlResources(control, config, release, bundle),
      }],
      ["terraform", terraform],
      ["wrangler", wrangler],
    ]) {
      for (const candidate of observation.resources) {
        const resource = normalizeResource(source, candidate, config.installationId);
        if (logicalIds.has(resource.logicalId)) {
          throw new TargetAdapterError(
            "cloudflare_resource_ownership_conflict",
            "A Cloudflare resource was reported by more than one authoritative owner.",
          );
        }
        logicalIds.add(resource.logicalId);
        resources.push(resource);
      }
    }
    resources.sort((left, right) => left.logicalId.localeCompare(right.logicalId));
    const revision = sha256Digest({
      control: control.controlSchema.revision,
      terraform: terraform.revision,
      wrangler: wrangler.revision,
      resources,
    });
    return Object.freeze({
      revision,
      controlSchema: control.controlSchema,
      releaseRecords: control.releaseRecords ?? {},
      operation: control.operation ?? null,
      resources: Object.freeze(resources),
      sourceRevisions: Object.freeze({
        control: control.controlSchema.revision,
        terraform: terraform.revision,
        wrangler: wrangler.revision,
      }),
    });
  };
}
