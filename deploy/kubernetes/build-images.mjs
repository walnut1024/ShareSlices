#!/usr/bin/env node

import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {fileURLToPath, pathToFileURL} from "node:url";

import {canonicalBytes, sha256Digest} from "../automation/canonical.mjs";

// cspell:ignore containerimage opencontainers
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const imageDefinitions = Object.freeze([
  {name: "api-image", dockerfile: "api/Dockerfile", target: "api"},
  {name: "maintenance-image", dockerfile: "api/Dockerfile", target: "maintenance"},
  {name: "content-image", dockerfile: "api/Dockerfile", target: "content"},
  {name: "web-image", dockerfile: "web/Dockerfile", target: "runtime"},
  {name: "processing-image", dockerfile: "worker/Dockerfile", target: "runtime"},
]);

function validateInput(repository, sourceRevision, platforms, sourceRepositoryUrl) {
  if (!/^[a-z0-9][a-z0-9._:/-]*[a-z0-9]$/.test(repository ?? "") || repository.includes("://")) {
    throw new TypeError("Kubernetes image repository is invalid.");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? "")) {
    throw new TypeError("Kubernetes image build requires a full Git commit SHA.");
  }
  if (!Array.isArray(platforms) || platforms.length === 0 ||
      platforms.some((platform) => !/^linux\/(amd64|arm64)$/.test(platform))) {
    throw new TypeError("Kubernetes image platforms are invalid.");
  }
  if (sourceRepositoryUrl !== undefined) {
    const sourceUrl = URL.parse(sourceRepositoryUrl);
    if (sourceUrl === null || sourceUrl.protocol !== "https:" ||
        sourceUrl.username !== "" || sourceUrl.password !== "" ||
        sourceUrl.search !== "" || sourceUrl.hash !== "") {
      throw new TypeError("Kubernetes image source repository URL is invalid.");
    }
  }
}

async function requireEmptyDirectory(outputDirectory) {
  await mkdir(outputDirectory, {recursive: true});
  if ((await readdir(outputDirectory)).length > 0) {
    throw new Error("kubernetes_image_output_not_empty");
  }
}

async function defaultBuild({
  definition,
  reference,
  platforms,
  metadataPath,
  sourceRepositoryUrl,
}) {
  const arguments_ = [
    "buildx", "build",
    "--file", resolve(repositoryRoot, definition.dockerfile),
    "--target", definition.target,
    "--platform", platforms.join(","),
    "--tag", reference,
    "--label", `org.opencontainers.image.revision=${reference.slice(reference.lastIndexOf("-") + 1)}`,
  ];
  if (sourceRepositoryUrl !== undefined) {
    arguments_.push("--label", `org.opencontainers.image.source=${sourceRepositoryUrl}`);
  }
  arguments_.push(
    "--provenance=mode=max",
    "--sbom=true",
    "--push",
    "--metadata-file", metadataPath,
    repositoryRoot,
  );
  await execute("docker", arguments_, {cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024});
  return JSON.parse(await readFile(metadataPath, "utf8"));
}

export async function buildKubernetesImages({
  repository,
  sourceRevision,
  outputDirectory,
  platforms = ["linux/amd64"],
  sourceRepositoryUrl,
  runBuild = defaultBuild,
}) {
  validateInput(repository, sourceRevision, platforms, sourceRepositoryUrl);
  const absoluteOutput = resolve(outputDirectory);
  await requireEmptyDirectory(absoluteOutput);
  const scratch = await mkdtemp(resolve(tmpdir(), "shareslices-kubernetes-images-"));
  try {
    const images = [];
    for (const definition of imageDefinitions) {
      const tag = `release-${sourceRevision}`;
      const reference = `${repository}/${definition.name}:${tag}`;
      const metadata = await runBuild({
        definition,
        reference,
        platforms,
        metadataPath: resolve(scratch, `${definition.name}.json`),
        sourceRepositoryUrl,
      });
      const digest = metadata?.["containerimage.digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
        throw new Error(`kubernetes_image_digest_unconfirmed:${definition.name}`);
      }
      images.push(Object.freeze({
        name: definition.name,
        dockerfile: definition.dockerfile,
        target: definition.target,
        platforms: Object.freeze([...platforms]),
        contentDigest: digest,
        providerReference: `${repository}/${definition.name}@${digest}`,
        publicationTag: reference,
      }));
    }
    const body = Object.freeze({
      schemaVersion: "shareslices.kubernetes-images/v1",
      sourceRevision,
      repository,
      ...(sourceRepositoryUrl === undefined ? {} : {sourceRepositoryUrl}),
      images: Object.freeze(images),
    });
    const manifest = Object.freeze({...body, manifestDigest: sha256Digest(body)});
    await writeFile(resolve(absoluteOutput, "kubernetes-images-manifest.json"), canonicalBytes(manifest), {flag: "wx"});
    return manifest;
  } catch (error) {
    await rm(absoluteOutput, {recursive: true, force: true});
    throw error;
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new TypeError("Expected --name value arguments.");
    options[name.slice(2)] = value;
  }
  return {
    repository: options.repository,
    sourceRevision: options["source-revision"],
    outputDirectory: options.output,
    platforms: options.platforms?.split(",") ?? ["linux/amd64"],
    sourceRepositoryUrl: options["source-repository-url"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildKubernetesImages(parseArguments(process.argv.slice(2)));
}
