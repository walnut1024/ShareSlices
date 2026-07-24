import {readFile} from "node:fs/promises";

import {sha256Digest} from "../automation/canonical.mjs";

const requiredArtifacts = Object.freeze([
  "app-worker-bundle",
  "content-worker-bundle",
  "jobs-worker-bundle",
  "static-assets",
  "trusted-processing-image",
  "thumbnail-image",
]);

const terraformSources = Object.freeze([
  "main.tf",
  "outputs.tf",
  "variables.tf",
  "versions.tf",
  ".terraform.lock.hcl",
]);

function resource(logicalId, phase, owner, desired, options = {}) {
  const body = {
    logicalId,
    phase,
    owner,
    retention: options.retention ?? "active",
    securitySensitive: options.securitySensitive ?? false,
    desired,
  };
  return Object.freeze({...body, digest: sha256Digest(body)});
}

async function sourceDigest() {
  const entries = await Promise.all(terraformSources.map(async (name) => [
    name,
    sha256Digest(await readFile(new URL(`./terraform/${name}`, import.meta.url))),
  ]));
  return sha256Digest(Object.fromEntries(entries));
}

function artifactMap(release) {
  const artifacts = new Map(release.artifacts.map((artifact) => [artifact.name, artifact]));
  const missing = requiredArtifacts.filter((name) => !artifacts.has(name));
  if (missing.length > 0) {
    throw new TypeError(`Cloudflare release is missing required artifacts: ${missing.join(", ")}.`);
  }
  return artifacts;
}

function artifactDesired(artifact) {
  return {
    artifactKind: artifact.artifactKind,
    contentDigest: artifact.contentDigest,
    providerIdentity: artifact.providerIdentity,
  };
}

export async function renderCloudflareBundle({config, release}) {
  if (config.target !== "cloudflare" || release.target !== "cloudflare") {
    throw new TypeError("Cloudflare render requires matching Cloudflare configuration and release.");
  }
  const artifacts = artifactMap(release);
  const terraformModuleDigest = await sourceDigest();
  const prerequisites = [
    resource(
      "cloudflare/terraform/private-prerequisites",
      "prerequisites",
      "terraform",
      {
        moduleDigest: terraformModuleDigest,
        accountId: config.cloudflare.accountId,
        installationId: config.installationId,
        artifactBucketName: config.cloudflare.r2.artifactBucket,
        deploymentStateBucketName: config.cloudflare.r2.deploymentStateBucket,
        jobsQueueName: config.cloudflare.queues.jobs,
        deadLetterQueueName: config.cloudflare.queues.deadLetter,
        hyperdriveName: `${config.installationId}-application`,
        hyperdriveCachingDisabled: true,
        hyperdriveOriginSslmode: "verify-full",
        postgresqlOriginReference: config.cloudflare.postgresqlOrigin,
        releaseStoreReference: config.cloudflare.releaseStore,
        costControls: config.cloudflare.costControls,
        activateIngress: false,
      },
      {securitySensitive: true},
    ),
    resource(
      "cloudflare/r2/public-access",
      "prerequisites",
      "deployment-module",
      {
        artifactBucket: config.cloudflare.r2.artifactBucket,
        r2DevEnabled: false,
        publicCustomDomainEnabled: false,
      },
      {securitySensitive: true},
    ),
  ];
  const migration = [resource(
    `deployment-control/migrations/${release.compatibility.schemaHead}`,
    "migration",
    "deployment-module",
    {
      execution: "one-shot-direct-postgresql",
      databaseReference: config.shared.database,
      migrations: release.migrations,
      schemaHead: release.compatibility.schemaHead,
    },
    {securitySensitive: true},
  )];
  const privateRuntime = [
    ...requiredArtifacts.map((name) => resource(
      `cloudflare/release-artifact/${name}`,
      "private-runtime",
      name.endsWith("image") ? "wrangler" : "deployment-module",
      artifactDesired(artifacts.get(name)),
      {retention: "rollback-window"},
    )),
    ...[
      ["application", config.cloudflare.workers.application],
      ["content", config.cloudflare.workers.content],
      ["jobs", config.cloudflare.workers.jobs],
    ].map(([role, name]) => resource(
      `cloudflare/worker/${name}`,
      "private-runtime",
      "wrangler",
      {
        role,
        name,
        workersDev: false,
        previewUrls: false,
        releaseId: release.releaseId,
        routeAttached: false,
        triggerAttached: false,
        cpuMilliseconds:
          config.cloudflare.costControls.workerCpuMilliseconds[role],
      },
      {securitySensitive: true},
    )),
  ];
  const publicRuntime = [resource(
    "cloudflare/ingress/application-and-content",
    "public-runtime",
    "terraform",
    {
      activation: "separately-authorized",
      applicationOrigin: config.shared.publicOrigins.application,
      contentOrigin: config.shared.publicOrigins.content,
      applicationWorker: config.cloudflare.workers.application,
      contentWorker: config.cloudflare.workers.content,
      requiredProviderInputs: ["application-zone-id", "content-zone-id", "route-or-custom-domain-selection"],
    },
    {securitySensitive: true},
  )];
  const verification = [resource(
    `deployment-control/release-verification/${release.releaseId}`,
    "verification",
    "deployment-module",
    {
      releaseId: release.releaseId,
      verificationContractDigest: release.verificationContractDigest,
      routeContractDigest: release.routeContractDigest,
      cacheContractDigest: release.cacheContractDigest,
      requiresProviderObservation: true,
    },
    {securitySensitive: true},
  )];
  return Object.freeze({
    schemaVersion: "shareslices.cloudflare-target-bundle/v1",
    target: "cloudflare",
    releaseId: release.releaseId,
    configurationDigest: release.configurationDigest,
    phases: Object.freeze([
      Object.freeze({id: "prerequisites", resources: Object.freeze(prerequisites)}),
      Object.freeze({id: "migration", resources: Object.freeze(migration)}),
      Object.freeze({id: "private-runtime", resources: Object.freeze(privateRuntime)}),
      Object.freeze({id: "public-runtime", resources: Object.freeze(publicRuntime)}),
      Object.freeze({id: "verification", resources: Object.freeze(verification)}),
    ]),
    unresolvedProviderInputs: Object.freeze([
      "hyperdrive-id",
      "r2-bucket-observations",
      "queue-ids",
      "application-zone-id",
      "content-zone-id",
      "route-or-custom-domain-selection",
    ]),
  });
}
