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
  {
    name: "trusted-processing-image",
    dockerfile: "worker/Dockerfile",
    target: "trusted-processing-runtime",
  },
  {
    name: "thumbnail-image",
    dockerfile: "worker/Dockerfile",
    target: "thumbnail-runtime",
  },
]);

function validateInput(repository, sourceRevision, platforms, buildProxy, sourceRepositoryUrl) {
  if (!/^[a-z0-9][a-z0-9._:/-]*[a-z0-9]$/.test(repository ?? "") || repository.includes("://")) {
    throw new TypeError("Cloudflare Container image repository is invalid.");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? "")) {
    throw new TypeError("Cloudflare Container image build requires a full Git commit SHA.");
  }
  if (!Array.isArray(platforms) || platforms.length === 0 ||
      platforms.some((platform) => !/^linux\/(amd64|arm64)$/.test(platform))) {
    throw new TypeError("Cloudflare Container image platforms are invalid.");
  }
  if (buildProxy !== undefined) {
    const proxyUrl = URL.parse(buildProxy);
    if (proxyUrl === null || !["http:", "https:"].includes(proxyUrl.protocol) ||
        proxyUrl.username !== "" || proxyUrl.password !== "") {
      throw new TypeError("Cloudflare Container image build proxy is invalid.");
    }
  }
  if (sourceRepositoryUrl !== undefined) {
    const sourceUrl = URL.parse(sourceRepositoryUrl);
    if (sourceUrl === null || sourceUrl.protocol !== "https:" ||
        sourceUrl.username !== "" || sourceUrl.password !== "" ||
        sourceUrl.search !== "" || sourceUrl.hash !== "") {
      throw new TypeError("Cloudflare Container image source repository URL is invalid.");
    }
  }
}

async function requireEmptyDirectory(outputDirectory) {
  await mkdir(outputDirectory, {recursive: true});
  if ((await readdir(outputDirectory)).length > 0) {
    throw new Error("cloudflare_container_image_output_not_empty");
  }
}

async function defaultBuild({
  definition,
  reference,
  platforms,
  metadataPath,
  buildProxy,
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
  );
  if (buildProxy !== undefined) {
    arguments_.push(
      "--build-arg", `HTTP_PROXY=${buildProxy}`,
      "--build-arg", `HTTPS_PROXY=${buildProxy}`,
      "--build-arg", `http_proxy=${buildProxy}`,
      "--build-arg", `https_proxy=${buildProxy}`,
    );
  }
  arguments_.push(repositoryRoot);
  await execute("docker", arguments_, {cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024});
  return JSON.parse(await readFile(metadataPath, "utf8"));
}

export async function buildCloudflareContainerImages({
  repository,
  sourceRevision,
  outputDirectory,
  platforms = ["linux/amd64"],
  buildProxy,
  sourceRepositoryUrl,
  runBuild = defaultBuild,
}) {
  validateInput(repository, sourceRevision, platforms, buildProxy, sourceRepositoryUrl);
  const absoluteOutput = resolve(outputDirectory);
  await requireEmptyDirectory(absoluteOutput);
  const scratch = await mkdtemp(resolve(tmpdir(), "shareslices-cloudflare-container-images-"));
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
        buildProxy,
        sourceRepositoryUrl,
      });
      const digest = metadata?.["containerimage.digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
        throw new Error(`cloudflare_container_image_digest_unconfirmed:${definition.name}`);
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
      schemaVersion: "shareslices.cloudflare-container-images/v1",
      sourceRevision,
      repository,
      ...(sourceRepositoryUrl === undefined ? {} : {sourceRepositoryUrl}),
      images: Object.freeze(images),
    });
    const manifest = Object.freeze({...body, manifestDigest: sha256Digest(body)});
    await writeFile(
      resolve(absoluteOutput, "cloudflare-container-images-manifest.json"),
      canonicalBytes(manifest),
      {flag: "wx"},
    );
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
    if (!name?.startsWith("--") || value === undefined) {
      throw new TypeError("Expected --name value arguments.");
    }
    options[name.slice(2)] = value;
  }
  return {
    repository: options.repository,
    sourceRevision: options["source-revision"],
    outputDirectory: options.output,
    platforms: options.platforms?.split(",") ?? ["linux/amd64"],
    buildProxy: options["build-proxy"],
    sourceRepositoryUrl: options["source-repository-url"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildCloudflareContainerImages(parseArguments(process.argv.slice(2)));
}
