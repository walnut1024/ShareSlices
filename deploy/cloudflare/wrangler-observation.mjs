import {sha256Digest} from "../automation/canonical.mjs";
import {TargetAdapterError} from "../automation/target-adapter.mjs";

const roles = Object.freeze([
  ["application", "application"],
  ["content", "content"],
  ["jobs", "jobs"],
]);

function desiredWorker(bundle, name) {
  return bundle.phases
    .flatMap(({resources}) => resources)
    .find(({logicalId}) => logicalId === `cloudflare/worker/${name}`);
}

export function cloudflareDeploymentMarker(installationId, releaseId, resourceDigest) {
  return `shareslices:${installationId}:${releaseId}:${resourceDigest}`;
}

function currentDeployment(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  const sorted = [...deployments].sort((left, right) =>
    String(left.created_on).localeCompare(String(right.created_on)));
  return sorted.at(-1);
}

function validateDeployment(deployment) {
  return (
    typeof deployment?.id === "string" &&
    deployment.id.length > 0 &&
    typeof deployment.created_on === "string" &&
    Number.isFinite(Date.parse(deployment.created_on)) &&
    Array.isArray(deployment.versions) &&
    deployment.versions.length > 0 &&
    deployment.versions.every(({version_id: versionId, percentage}) =>
      typeof versionId === "string" &&
      versionId.length > 0 &&
      typeof percentage === "number" &&
      percentage >= 0 &&
      percentage <= 100)
  );
}

export function createCloudflareWranglerObserver({readDeployments} = {}) {
  if (typeof readDeployments !== "function") {
    throw new TypeError("Cloudflare Wrangler observation requires a deployment reader.");
  }
  return async ({config, release, bundle}) => {
    const resources = [];
    const revisions = [];
    for (const [role, configKey] of roles) {
      const name = config.cloudflare.workers[configKey];
      const desired = desiredWorker(bundle, name);
      if (!desired) {
        throw new TargetAdapterError(
          "cloudflare_wrangler_bundle_invalid",
          "Cloudflare target bundle is missing a Worker resource.",
        );
      }
      const deployments = await readDeployments({config, release, bundle, role, name});
      if (!Array.isArray(deployments)) {
        throw new TargetAdapterError(
          "cloudflare_wrangler_deployment_observation_invalid",
          "Wrangler returned an invalid deployment observation.",
        );
      }
      const deployment = currentDeployment(deployments);
      if (!deployment) {
        revisions.push(`${role}:absent`);
        continue;
      }
      if (!validateDeployment(deployment)) {
        throw new TargetAdapterError(
          "cloudflare_wrangler_deployment_observation_invalid",
          "Wrangler returned an invalid deployment observation.",
        );
      }
      const marker = cloudflareDeploymentMarker(
        config.installationId,
        release.releaseId,
        desired.digest,
      );
      const fullyPromoted = deployment.versions.length === 1 &&
        deployment.versions[0].percentage === 100;
      if (
        deployment.annotations?.["workers/message"] !== marker ||
        !fullyPromoted
      ) {
        revisions.push(`${role}:${deployment.id}:unowned-or-staged`);
        continue;
      }
      resources.push({
        logicalId: desired.logicalId,
        digest: desired.digest,
        owner: "wrangler",
        retention: desired.retention,
        providerIdentity: {
          deploymentId: deployment.id,
          versionId: deployment.versions[0].version_id,
          createdOn: deployment.created_on,
        },
        releaseId: release.releaseId,
        ownershipMarkers: {
          installation: config.installationId,
          owner: "wrangler",
          release: release.releaseId,
        },
      });
      revisions.push(`${role}:${deployment.id}:${deployment.versions[0].version_id}`);
    }
    return Object.freeze({
      revision: sha256Digest(revisions.sort()),
      resources: Object.freeze(resources),
    });
  };
}
