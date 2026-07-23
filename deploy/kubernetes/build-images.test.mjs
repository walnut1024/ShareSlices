import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {buildKubernetesImages} from "./build-images.mjs";

// cspell:ignore containerimage
const sourceRevision = "0123456789abcdef0123456789abcdef01234567";

async function outputDirectory(root, name) {
  return resolve(root, name);
}

test("builds every Kubernetes role once and records only immutable digest references", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-build-images-test-"));
  const calls = [];
  const runBuild = async (input) => {
    calls.push(input);
    const character = String(calls.length);
    return {"containerimage.digest": `sha256:${character.repeat(64)}`};
  };
  try {
    const first = await buildKubernetesImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: await outputDirectory(root, "first"),
      runBuild,
    });
    calls.length = 0;
    const second = await buildKubernetesImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: await outputDirectory(root, "second"),
      runBuild,
    });
    assert.deepEqual(first, second);
    assert.deepEqual(first.images.map(({name}) => name), [
      "api-image", "maintenance-image", "content-image", "web-image", "processing-image",
    ]);
    assert.equal(first.images.every(({providerReference}) => providerReference.includes("@sha256:")), true);
    assert.equal(first.images.every(({publicationTag}) => publicationTag.endsWith(`release-${sourceRevision}`)), true);
    assert.equal(calls.length, 5);
    const firstBytes = await readFile(resolve(root, "first/kubernetes-images-manifest.json"));
    const secondBytes = await readFile(resolve(root, "second/kubernetes-images-manifest.json"));
    assert.deepEqual(firstBytes, secondBytes);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("refuses a mutable source identity, unconfirmed digest, or nonempty output", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-build-images-refusal-"));
  try {
    await assert.rejects(buildKubernetesImages({
      repository: "registry.example.test/shareslices",
      sourceRevision: "main",
      outputDirectory: resolve(root, "mutable"),
    }), /full Git commit SHA/);
    await assert.rejects(buildKubernetesImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: resolve(root, "missing-digest"),
      runBuild: async () => ({}),
    }), /digest_unconfirmed/);
    const occupied = resolve(root, "occupied");
    await writeFile(occupied, "reserved");
    await assert.rejects(buildKubernetesImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: occupied,
      runBuild: async () => ({}),
    }));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
