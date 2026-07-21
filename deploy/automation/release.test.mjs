import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256Digest } from "./canonical.mjs";
import {
  qualifyReleaseArtifacts,
  ReleaseQualificationError,
  serializeCanonicalRelease,
  serializeCanonicalTargetBundle,
} from "./release.mjs";

const fixturePath = new URL("../contract/fixtures/release.valid.json", import.meta.url);
const fixture = async () => JSON.parse(await readFile(fixturePath, "utf8"));

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
