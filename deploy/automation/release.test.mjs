import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256Digest } from "./canonical.mjs";
import {
  qualifyReleaseArtifacts,
  constructReleaseManifest,
  publishRelease,
  qualifyArtifactPublication,
  ReleaseQualificationError,
  serializeCanonicalRelease,
  serializeCanonicalTargetBundle,
} from "./release.mjs";

const fixturePath = new URL("../contract/fixtures/release.valid.json", import.meta.url);
const fixture = async () => JSON.parse(await readFile(fixturePath, "utf8"));
const publicationFixture = async () => JSON.parse(await readFile(
  new URL("../contract/fixtures/artifact-publication.valid.json", import.meta.url),
  "utf8",
));

function artifactInputs(release) {
  const inputs = new Map();
  for (const artifact of release.artifacts) {
    const bytes = Buffer.from(`artifact:${artifact.name}`);
    artifact.contentDigest = sha256Digest(bytes);
    if (artifact.providerIdentity.kind === "digest") {
      artifact.providerIdentity.value = artifact.contentDigest;
    }
    if (artifact.providerIdentity.kind === "release_tag") {
      artifact.providerIdentity.verifiedContentDigest = artifact.contentDigest;
    }
    inputs.set(artifact.name, bytes);
  }
  const body = { ...release };
  delete body.releaseId;
  release.releaseId = sha256Digest(body);
  return inputs;
}

test("serializes releases and target bundles deterministically", async () => {
  const release = await fixture();
  const reordered = Object.fromEntries(Object.entries(release).reverse());
  assert.deepEqual(serializeCanonicalRelease(release), serializeCanonicalRelease(reordered));

  const first = serializeCanonicalTargetBundle({ target: "kubernetes", release });
  const second = serializeCanonicalTargetBundle({ release: reordered, target: "kubernetes" });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.digest, second.digest);
});

test("verifies every artifact content digest and qualified provider identity", async () => {
  const release = await fixture();
  const inputs = artifactInputs(release);
  const result = qualifyReleaseArtifacts(release, inputs);
  assert.equal(result.artifactCount, release.artifacts.length);

  inputs.set(release.artifacts[0].name, Buffer.from("changed"));
  assert.throws(
    () => qualifyReleaseArtifacts(release, inputs),
    (error) => error instanceof ReleaseQualificationError && error.code === "release_artifact_digest_mismatch",
  );
});

test("rejects mutable, duplicate, mismatched, and reused provider identities", async () => {
  const mutable = await fixture();
  const mutableInputs = artifactInputs(mutable);
  mutable.artifacts[0].providerIdentity.mutable = true;
  assert.throws(
    () => qualifyReleaseArtifacts(mutable, mutableInputs),
    (error) => error.code === "release_contract_invalid",
  );

  const duplicate = await fixture();
  const duplicateInputs = artifactInputs(duplicate);
  duplicate.artifacts[1].providerIdentity = structuredClone(duplicate.artifacts[0].providerIdentity);
  assert.throws(
    () => qualifyReleaseArtifacts(duplicate, duplicateInputs),
    (error) => error.code === "provider_identity_reused",
  );

  const reused = await fixture();
  const reusedInputs = artifactInputs(reused);
  const tagged = reused.artifacts.find(({ providerIdentity }) => providerIdentity.kind === "release_tag");
  assert.ok(tagged);
  assert.throws(
    () => qualifyReleaseArtifacts(reused, reusedInputs, {
      retainedProviderIdentities: [{
        kind: "release_tag",
        value: tagged.providerIdentity.value,
        contentDigest: `sha256:${"f".repeat(64)}`,
      }],
    }),
    (error) => error.code === "provider_tag_reused",
  );
});

function completeCloudflareInputs(base) {
  const names = [
    ["app-worker-bundle", "worker-bundle"],
    ["content-worker-bundle", "worker-bundle"],
    ["jobs-worker-bundle", "worker-bundle"],
    ["static-assets", "static-assets"],
    ["trusted-processing-image", "oci-image"],
    ["thumbnail-image", "oci-image"],
  ];
  const artifactBytes = new Map(names.map(([name]) => [name, Buffer.from(`artifact:${name}`)]));
  return {
    ...base,
    target: "cloudflare",
    artifacts: names.map(([name, artifactKind]) => ({
      name,
      artifactKind,
      ...(artifactKind === "oci-image" ? { platforms: ["linux/amd64"] } : {}),
      providerIdentity: artifactKind === "oci-image"
        ? { kind: "digest", value: `sha256:${"0".repeat(64)}`, qualified: true, mutable: false }
        : { kind: "version_id", value: `${name}-v1`, qualified: true, mutable: false },
    })),
    artifactBytes,
    migrationBytes: new Map(base.migrations.map(({ id }) => [id, Buffer.from(`migration:${id}`)])),
    configuration: { target: "cloudflare", installation: "example" },
    routeContract: { revision: "routes-v1" },
    cacheContract: { revision: "cache-v1" },
    verificationContract: { revision: "verification-v1" },
  };
}

test("constructs the same complete release manifest from identical evidence", async () => {
  const base = await fixture();
  const input = completeCloudflareInputs(base);
  delete input.releaseId;
  const first = constructReleaseManifest(input);
  const second = constructReleaseManifest({ ...input, artifactBytes: new Map(input.artifactBytes) });
  assert.deepEqual(first, second);
  assert.match(first.releaseId, /^sha256:[a-f0-9]{64}$/);

  input.artifactBytes.delete("thumbnail-image");
  assert.throws(
    () => constructReleaseManifest(input),
    (error) => error.code === "release_target_artifact_missing",
  );
});

test("derives migration and contract digests and rejects incomplete evidence", async () => {
  const input = completeCloudflareInputs(await fixture());
  delete input.releaseId;
  const release = constructReleaseManifest(input);
  assert.equal(release.migrations[0].checksum, sha256Digest(input.migrationBytes.get(release.migrations[0].id)));
  assert.equal(release.routeContractDigest, sha256Digest(input.routeContract));
  assert.equal(release.cacheContractDigest, sha256Digest(input.cacheContract));
  assert.equal(release.verificationContractDigest, sha256Digest(input.verificationContract));

  input.migrationBytes.clear();
  assert.throws(
    () => constructReleaseManifest(input),
    (error) => error.code === "release_migration_missing",
  );
});

test("publishes immutable bundles and verifies OCI digests before retention", async () => {
  const base = await fixture();
  const input = completeCloudflareInputs(base);
  delete input.releaseId;
  const release = constructReleaseManifest(input);
  const publication = await publicationFixture();
  const calls = [];
  const result = await publishRelease(release, input.artifactBytes, publication, {
    releaseStore: {
      putImmutable: async (entry) => {
        calls.push(["store", entry.key, entry.digest]);
        return { outcome: "created", digest: entry.digest };
      },
    },
    ociRegistry: {
      verifyDigest: async (entry) => {
        calls.push(["oci", entry.name, entry.digest]);
        return { digest: entry.digest, platforms: entry.requiredPlatforms };
      },
    },
    retention: {
      protect: async (entry) => {
        calls.push(["retention", entry.releaseId]);
        return { protected: true };
      },
    },
  });
  assert.equal(result.releaseId, release.releaseId);
  assert.equal(calls.filter(([kind]) => kind === "oci").length, 2);
  assert.equal(calls.at(-1)[0], "retention");
  assert.ok(calls.some(([kind, key]) => kind === "store" && key.endsWith("/release.json")));
});

test("rejects shared publication credentials and missing OCI platforms", async () => {
  const publication = await publicationFixture();
  publication.ociRegistry.deployPullCredentialRef = publication.ociRegistry.buildPushCredentialRef;
  assert.throws(
    () => qualifyArtifactPublication(publication),
    (error) => error.code === "artifact_publication_credential_scope_reused",
  );

  const base = await fixture();
  const input = completeCloudflareInputs(base);
  delete input.releaseId;
  const release = constructReleaseManifest(input);
  const validPublication = await publicationFixture();
  validPublication.ociRegistry.requiredPlatforms = ["linux/amd64", "linux/arm64"];
  await assert.rejects(
    publishRelease(release, input.artifactBytes, validPublication, {
      releaseStore: { putImmutable: async () => {} },
      ociRegistry: { verifyDigest: async () => {} },
      retention: { protect: async () => {} },
    }),
    (error) => error.code === "release_artifact_platform_missing",
  );
});

test("fails closed on unconfirmed immutable writes, registry observations, or retention", async () => {
  const input = completeCloudflareInputs(await fixture());
  delete input.releaseId;
  const release = constructReleaseManifest(input);
  const publication = await publicationFixture();
  const validStore = {
    putImmutable: async ({ digest }) => ({ outcome: "created", digest }),
  };
  const validRegistry = {
    verifyDigest: async ({ digest, requiredPlatforms }) => ({ digest, platforms: requiredPlatforms }),
  };
  const validRetention = { protect: async () => ({ protected: true }) };

  await assert.rejects(
    publishRelease(release, input.artifactBytes, publication, {
      releaseStore: { putImmutable: async () => ({ outcome: "indeterminate" }) },
      ociRegistry: validRegistry,
      retention: validRetention,
    }),
    (error) => error.code === "release_store_write_unconfirmed",
  );
  await assert.rejects(
    publishRelease(release, input.artifactBytes, publication, {
      releaseStore: validStore,
      ociRegistry: { verifyDigest: async () => ({ digest: `sha256:${"f".repeat(64)}`, platforms: ["linux/amd64"] }) },
      retention: validRetention,
    }),
    (error) => error.code === "oci_artifact_verification_failed",
  );
  await assert.rejects(
    publishRelease(release, input.artifactBytes, publication, {
      releaseStore: validStore,
      ociRegistry: validRegistry,
      retention: { protect: async () => ({ protected: false }) },
    }),
    (error) => error.code === "release_retention_unconfirmed",
  );
});
