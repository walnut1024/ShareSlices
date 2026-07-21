import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalBytes, sha256Digest } from "./canonical.mjs";

const schema = JSON.parse(
  await readFile(new URL("../contract/release.schema.json", import.meta.url), "utf8"),
);
const validateRelease = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
}).compile(schema);

export class ReleaseQualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseQualificationError";
    this.code = code;
  }
}

export function serializeCanonicalRelease(release) {
  if (!validateRelease(release)) {
    throw new ReleaseQualificationError(
      "release_contract_invalid",
      "Release does not match the immutable release contract.",
    );
  }
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
  for (const artifact of release.artifacts) {
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
  return Object.freeze({
    releaseBytes: serializeCanonicalRelease(release),
    artifactCount: release.artifacts.length,
  });
}
