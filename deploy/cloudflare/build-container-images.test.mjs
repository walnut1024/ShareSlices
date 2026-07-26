import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {buildCloudflareContainerImages} from "./build-container-images.mjs";

// cspell:ignore containerimage
const sourceRevision = "0123456789abcdef0123456789abcdef01234567";

test("builds distinct trusted and secretless Cloudflare Container images", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-cloudflare-images-test-"));
  const calls = [];
  const runBuild = async (input) => {
    calls.push(input);
    const character = String(calls.length);
    return {"containerimage.digest": `sha256:${character.repeat(64)}`};
  };
  try {
    const first = await buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: resolve(root, "first"),
      buildProxy: "http://host.docker.internal:7890",
      sourceRepositoryUrl: "https://github.com/example/shareslices",
      runBuild,
    });
    calls.length = 0;
    const second = await buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: resolve(root, "second"),
      buildProxy: "http://host.docker.internal:7890",
      sourceRepositoryUrl: "https://github.com/example/shareslices",
      runBuild,
    });
    assert.deepEqual(first, second);
    assert.deepEqual(first.images.map(({name, target}) => [name, target]), [
      ["trusted-processing-image", "trusted-processing-runtime"],
      ["thumbnail-image", "thumbnail-runtime"],
    ]);
    assert.equal(
      first.images.every(({providerReference}) => providerReference.includes("@sha256:")),
      true,
    );
    assert.equal(
      first.images.every(({publicationTag}) => publicationTag.endsWith(`release-${sourceRevision}`)),
      true,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls.every(({buildProxy}) =>
      buildProxy === "http://host.docker.internal:7890"), true);
    assert.equal(calls.every(({sourceRepositoryUrl}) =>
      sourceRepositoryUrl === "https://github.com/example/shareslices"), true);
    assert.equal(first.sourceRepositoryUrl, "https://github.com/example/shareslices");
    assert.deepEqual(
      await readFile(resolve(root, "first/cloudflare-container-images-manifest.json")),
      await readFile(resolve(root, "second/cloudflare-container-images-manifest.json")),
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("refuses mutable identity, unconfirmed digest, and occupied output", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-cloudflare-images-refusal-"));
  try {
    await assert.rejects(buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision: "main",
      outputDirectory: resolve(root, "mutable"),
    }), /full Git commit SHA/);
    await assert.rejects(buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      sourceRepositoryUrl: "https://github.com/example/shareslices?token=secret",
      outputDirectory: resolve(root, "query-source"),
      runBuild: async () => ({}),
    }), /source repository URL is invalid/);
    await assert.rejects(buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: resolve(root, "missing-digest"),
      runBuild: async () => ({}),
    }), /digest_unconfirmed/);
    await assert.rejects(buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: resolve(root, "credentialed-proxy"),
      buildProxy: "http://user:password@proxy.example.test",
      runBuild: async () => ({}),
    }), /build proxy is invalid/);
    const occupied = resolve(root, "occupied");
    await writeFile(occupied, "reserved");
    await assert.rejects(buildCloudflareContainerImages({
      repository: "registry.example.test/shareslices",
      sourceRevision,
      outputDirectory: occupied,
      runBuild: async () => ({}),
    }));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
