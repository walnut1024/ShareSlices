import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalBytes, sha256Digest } from "./canonical.mjs";

const schema = JSON.parse(
  await readFile(new URL("../contract/release.schema.json", import.meta.url), "utf8"),
);
const publicationSchema = JSON.parse(
  await readFile(new URL("../contract/artifact-publication.schema.json", import.meta.url), "utf8"),
);
const validateRelease = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
}).compile(schema);
const validatePublication = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
}).compile(publicationSchema);

const REQUIRED_ARTIFACTS = Object.freeze({
  kubernetes: Object.freeze([
    "api-image",
    "maintenance-image",
    "web-image",
    "content-image",
    "processing-image",
  ]),
  cloudflare: Object.freeze([
    "app-worker-bundle",
    "content-worker-bundle",
    "jobs-worker-bundle",
    "static-assets",
    "trusted-processing-image",
    "thumbnail-image",
  ]),
});

function calculateReleaseId(release) {
  const body = { ...release };
  delete body.releaseId;
  return sha256Digest(body);
}

function requireTargetArtifacts(release, artifactBytes) {
  const missing = REQUIRED_ARTIFACTS[release.target]?.filter(
    (name) => !release.artifacts.some((artifact) => artifact.name === name) || !artifactBytes.has(name),
  );
  if (!missing || missing.length > 0) {
    throw new ReleaseQualificationError(
      "release_target_artifact_missing",
      `Release is missing required ${release.target ?? "unknown"} artifacts: ${(missing ?? []).join(", ")}.`,
    );
  }
}

export class ReleaseQualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseQualificationError";
    this.code = code;
  }
}

function requireCompatibilityEvidence(release) {
  const entries = release.migrationCompatibility;
  if (!Array.isArray(entries) || entries.length !== release.migrations.length) {
    throw new ReleaseQualificationError(
      "release_migration_compatibility_incomplete",
      "Every release migration must have one ordered compatibility result.",
    );
  }
  const evidenceDigests = new Set();
  for (let index = 0; index < release.migrations.length; index += 1) {
    const migration = release.migrations[index];
    const evidence = entries[index];
    const expectedNMinus1 = release.compatibility.runtimeNMinus1 === null
      ? "not_applicable"
      : "passed";
    if (
      evidence.order !== migration.order
      || evidence.migrationId !== migration.id
      || evidence.schemaHead !== migration.id
      || evidence.runtimeN !== "passed"
      || evidence.runtimeNMinus1 !== expectedNMinus1
      || evidence.jobsContractRevision !== release.contractRevisions.jobs
      || evidence.objectLayoutRevision !== release.contractRevisions.objectLayout
      || evidenceDigests.has(evidence.evidenceDigest)
    ) {
      throw new ReleaseQualificationError(
        "release_migration_compatibility_invalid",
        `Migration compatibility evidence is incomplete or inconsistent at order ${index + 1}.`,
      );
    }
    evidenceDigests.add(evidence.evidenceDigest);
  }
  const finalHead = entries.at(-1)?.schemaHead ?? release.compatibility.schemaHead;
  if (
    finalHead !== release.compatibility.schemaHead
    || release.contractRevisions.database !== release.compatibility.schemaHead
  ) {
    throw new ReleaseQualificationError(
      "release_schema_range_invalid",
      "The declared database contract and final migration head must describe one schema range.",
    );
  }

  for (const name of ["jobs", "objectLayout"]) {
    const pair = release.contractCompatibility[name];
    if (
      pair.current.revision !== release.contractRevisions[name]
      || pair.current.fixtureDigest === null
    ) {
      throw new ReleaseQualificationError(
        "release_adjacent_contract_incomplete",
        `Current ${name} contract compatibility evidence is incomplete.`,
      );
    }
    const expectsPrevious = release.compatibility.runtimeNMinus1 !== null;
    if (
      expectsPrevious !== (pair.previous.revision !== null)
      || expectsPrevious !== (pair.previous.fixtureDigest !== null)
    ) {
      throw new ReleaseQualificationError(
        "release_adjacent_contract_incomplete",
        `Previous ${name} contract compatibility evidence does not match the N-1 runtime window.`,
      );
    }
  }
}

export function serializeCanonicalRelease(release) {
  if (!validateRelease(release)) {
    throw new ReleaseQualificationError(
      "release_contract_invalid",
      "Release does not match the immutable release contract.",
    );
  }
  requireCompatibilityEvidence(release);
  return canonicalBytes(release);
}

export function serializeCanonicalTargetBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new ReleaseQualificationError(
      "target_bundle_invalid",
      "Target bundle must be an object.",
    );
  }
  return Object.freeze({
    bytes: canonicalBytes(bundle),
    digest: sha256Digest(bundle),
  });
}

export function qualifyReleaseArtifacts(
  release,
  artifactBytes,
  { retainedProviderIdentities = [] } = {},
) {
  serializeCanonicalRelease(release);
  const retainedTags = new Map(
    retainedProviderIdentities
      .filter(({ kind }) => kind === "release_tag")
      .map(({ value, contentDigest }) => [value, contentDigest]),
  );
  const identities = new Set();
  const names = new Set();
  for (const artifact of release.artifacts) {
    if (names.has(artifact.name)) {
      throw new ReleaseQualificationError(
        "release_artifact_name_reused",
        `Release artifact name ${artifact.name} is reused.`,
      );
    }
    names.add(artifact.name);
    const bytes = artifactBytes.get(artifact.name);
    if (!(bytes instanceof Uint8Array)) {
      throw new ReleaseQualificationError(
        "release_artifact_missing",
        `Release artifact ${artifact.name} is missing.`,
      );
    }
    if (sha256Digest(bytes) !== artifact.contentDigest) {
      throw new ReleaseQualificationError(
        "release_artifact_digest_mismatch",
        `Release artifact ${artifact.name} does not match its content digest.`,
      );
    }
    const identity = artifact.providerIdentity;
    const identityKey = `${identity.kind}:${identity.value}`;
    if (identities.has(identityKey)) {
      throw new ReleaseQualificationError(
        "provider_identity_reused",
        "A provider identity is reused within the release.",
      );
    }
    identities.add(identityKey);
    if (identity.kind === "digest" && identity.value !== artifact.contentDigest) {
      throw new ReleaseQualificationError(
        "provider_digest_mismatch",
        `Provider digest for ${artifact.name} does not match its content digest.`,
      );
    }
    if (identity.kind === "release_tag") {
      if (identity.verifiedContentDigest !== artifact.contentDigest) {
        throw new ReleaseQualificationError(
          "provider_tag_unverified",
          `Provider tag for ${artifact.name} is not verified against its content digest.`,
        );
      }
      const retainedDigest = retainedTags.get(identity.value);
      if (retainedDigest && retainedDigest !== artifact.contentDigest) {
        throw new ReleaseQualificationError(
          "provider_tag_reused",
          `Provider tag for ${artifact.name} was previously used for different content.`,
        );
      }
    }
  }
  if (release.releaseId !== calculateReleaseId(release)) {
    throw new ReleaseQualificationError(
      "release_id_mismatch",
      "Release ID does not match the canonical Secret-free release body.",
    );
  }
  return Object.freeze({
    releaseBytes: serializeCanonicalRelease(release),
    artifactCount: release.artifacts.length,
  });
}

export function qualifyArtifactPublication(publication) {
  if (!validatePublication(publication)) {
    throw new ReleaseQualificationError(
      "artifact_publication_contract_invalid",
      "Artifact publication prerequisites do not match the checked contract.",
    );
  }
  const credentialIds = [
    publication.releaseStore.buildPushCredentialRef.logicalId,
    publication.releaseStore.deployPullCredentialRef.logicalId,
    publication.ociRegistry.buildPushCredentialRef.logicalId,
    publication.ociRegistry.deployPullCredentialRef.logicalId,
  ];
  if (new Set(credentialIds).size !== credentialIds.length) {
    throw new ReleaseQualificationError(
      "artifact_publication_credential_scope_reused",
      "Build-push and deploy-pull credential references must be distinct.",
    );
  }
  return Object.freeze({
    digest: sha256Digest(publication),
    kubernetesImagePullSecretRef: publication.ociRegistry.kubernetesImagePullSecretRef,
  });
}

function requirePublicationPlatforms(release, publication) {
  for (const artifact of release.artifacts.filter(({ artifactKind }) => artifactKind === "oci-image")) {
    for (const required of publication.ociRegistry.requiredPlatforms) {
      if (!artifact.platforms.includes(required)) {
        throw new ReleaseQualificationError(
          "release_artifact_platform_missing",
          `OCI artifact ${artifact.name} is missing required platform ${required}.`,
        );
      }
    }
  }
}

export function constructReleaseManifest(input) {
  const artifactBytes = input.artifactBytes;
  if (!(artifactBytes instanceof Map)) {
    throw new ReleaseQualificationError(
      "release_artifact_inputs_invalid",
      "Release artifact inputs must be supplied as a Map.",
    );
  }
  if (!(input.migrationBytes instanceof Map)) {
    throw new ReleaseQualificationError(
      "release_migration_inputs_invalid",
      "Release migration inputs must be supplied as a Map.",
    );
  }
  for (const [name, value] of [
    ["configuration", input.configuration],
    ["route contract", input.routeContract],
    ["cache contract", input.cacheContract],
    ["verification contract", input.verificationContract],
  ]) {
    if (value === undefined || value === null) {
      throw new ReleaseQualificationError(
        "release_contract_evidence_missing",
        `Release ${name} evidence is missing.`,
      );
    }
  }
  requireTargetArtifacts(input, artifactBytes);
  const artifacts = input.artifacts.map((artifact) => {
    const bytes = artifactBytes.get(artifact.name);
    if (!(bytes instanceof Uint8Array)) {
      throw new ReleaseQualificationError(
        "release_artifact_missing",
        `Release artifact ${artifact.name} is missing.`,
      );
    }
    return {
      ...artifact,
      contentDigest: sha256Digest(bytes),
      providerIdentity: artifact.providerIdentity.kind === "digest"
        ? { ...artifact.providerIdentity, value: sha256Digest(bytes) }
        : artifact.providerIdentity,
    };
  });
  const migrations = input.migrations.map((migration, index) => {
    if (migration.order !== index + 1) {
      throw new ReleaseQualificationError(
        "release_migration_order_invalid",
        "Release migrations must be contiguous and ordered from one.",
      );
    }
    const bytes = input.migrationBytes.get(migration.id);
    if (!(bytes instanceof Uint8Array)) {
      throw new ReleaseQualificationError(
        "release_migration_missing",
        `Release migration ${migration.id} is missing.`,
      );
    }
    return { order: migration.order, id: migration.id, checksum: sha256Digest(bytes) };
  });
  const {
    artifactBytes: ignoredArtifactBytes,
    migrationBytes: ignoredMigrationBytes,
    configuration: ignoredConfiguration,
    routeContract: ignoredRouteContract,
    cacheContract: ignoredCacheContract,
    verificationContract: ignoredVerificationContract,
    retainedProviderIdentities: ignoredRetainedProviderIdentities,
    releaseId: ignoredReleaseId,
    ...releaseFields
  } = input;
  void ignoredArtifactBytes;
  void ignoredMigrationBytes;
  void ignoredConfiguration;
  void ignoredRouteContract;
  void ignoredCacheContract;
  void ignoredVerificationContract;
  void ignoredRetainedProviderIdentities;
  void ignoredReleaseId;
  const body = {
    ...releaseFields,
    artifacts,
    migrations,
    configurationDigest: sha256Digest(input.configuration),
    routeContractDigest: sha256Digest(input.routeContract),
    cacheContractDigest: sha256Digest(input.cacheContract),
    verificationContractDigest: sha256Digest(input.verificationContract),
  };
  const release = { ...body, releaseId: sha256Digest(body) };
  requireTargetArtifacts(release, artifactBytes);
  qualifyReleaseArtifacts(release, artifactBytes, {
    retainedProviderIdentities: input.retainedProviderIdentities,
  });
  return Object.freeze(release);
}

export async function publishRelease(release, artifactBytes, publication, adapters) {
  const qualified = qualifyArtifactPublication(publication);
  requireTargetArtifacts(release, artifactBytes);
  qualifyReleaseArtifacts(release, artifactBytes, {
    retainedProviderIdentities: adapters.retainedProviderIdentities ?? [],
  });
  requirePublicationPlatforms(release, publication);
  const releaseBytes = serializeCanonicalRelease(release);
  const releaseKey = `${publication.releaseStore.namespace}/releases/${release.releaseId.slice(7)}/release.json`;
  const releaseWrite = await adapters.releaseStore.putImmutable({
    key: releaseKey,
    bytes: releaseBytes,
    digest: sha256Digest(releaseBytes),
  });
  if (!releaseWrite || !["created", "existing"].includes(releaseWrite.outcome) || releaseWrite.digest !== sha256Digest(releaseBytes)) {
    throw new ReleaseQualificationError(
      "release_store_write_unconfirmed",
      "Immutable release manifest write was not confirmed with the expected digest.",
    );
  }
  for (const artifact of release.artifacts) {
    const bytes = artifactBytes.get(artifact.name);
    if (artifact.artifactKind === "oci-image") {
      const observation = await adapters.ociRegistry.verifyDigest({
        repository: publication.ociRegistry.repository,
        name: artifact.name,
        digest: artifact.contentDigest,
        requiredPlatforms: artifact.platforms,
      });
      if (observation?.digest !== artifact.contentDigest
        || !artifact.platforms.every((platform) => observation.platforms?.includes(platform))) {
        throw new ReleaseQualificationError(
          "oci_artifact_verification_failed",
          `OCI artifact ${artifact.name} was not observed at its required digest and platforms.`,
        );
      }
    } else {
      const write = await adapters.releaseStore.putImmutable({
        key: `${publication.releaseStore.namespace}/releases/${release.releaseId.slice(7)}/artifacts/${artifact.name}`,
        bytes,
        digest: artifact.contentDigest,
      });
      if (!write || !["created", "existing"].includes(write.outcome) || write.digest !== artifact.contentDigest) {
        throw new ReleaseQualificationError(
          "release_artifact_write_unconfirmed",
          `Immutable release artifact ${artifact.name} write was not confirmed.`,
        );
      }
    }
  }
  const retention = await adapters.retention.protect({
    releaseId: release.releaseId,
    previousReleaseId: release.previousReleaseId ?? null,
    minimumReleaseCount: publication.retention.minimumReleaseCount,
    rollbackWindowSeconds: publication.retention.rollbackWindowSeconds,
  });
  if (retention?.protected !== true) {
    throw new ReleaseQualificationError(
      "release_retention_unconfirmed",
      "Rollback-window release retention was not confirmed.",
    );
  }
  return Object.freeze({
    releaseId: release.releaseId,
    releaseKey,
    publicationDigest: qualified.digest,
  });
}
