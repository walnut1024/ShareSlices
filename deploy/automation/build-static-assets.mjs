import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical.mjs";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cacheProjectionPath = fileURLToPath(
  new URL("../contract/cache-projection.json", import.meta.url),
);

function fileDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function filesBelow(directory) {
  const pending = [directory];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error("static_assets_non_regular_entry");
    }
  }
  return files.sort();
}

async function requireEmptyDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  if ((await readdir(outputDirectory)).length > 0) {
    throw new Error("static_assets_output_not_empty");
  }
}

export async function buildStaticAssets(outputDirectory, manifestOutput) {
  const absoluteOutput = resolve(outputDirectory);
  const absoluteManifestOutput = resolve(manifestOutput);
  const manifestRelativeToAssets = relative(
    absoluteOutput,
    absoluteManifestOutput,
  );
  if (
    manifestRelativeToAssets === "" ||
    (!manifestRelativeToAssets.startsWith(`..${sep}`) &&
      manifestRelativeToAssets !== "..")
  ) {
    throw new Error("static_assets_manifest_must_be_private");
  }
  await requireEmptyDirectory(absoluteOutput);
  await execute(
    "pnpm",
    ["--dir", "web", "run", "build", "--outDir", absoluteOutput],
    { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  const cacheProjection = JSON.parse(await readFile(cacheProjectionPath, "utf8"));
  const staticPolicy = cacheProjection.policies.find(
    ({ id }) => id === "web-static-immutable",
  );
  if (
    !staticPolicy?.enabled ||
    !staticPolicy.contentHashRequired ||
    typeof staticPolicy.outwardCacheControl !== "string"
  ) {
    throw new Error("static_assets_cache_policy_invalid");
  }
  const builtFiles = await filesBelow(absoluteOutput);
  for (const path of builtFiles) {
    const assetPath = relative(absoluteOutput, path).split(sep).join("/");
    if (
      assetPath.startsWith("assets/") &&
      !/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(assetPath)
    ) {
      throw new Error("static_assets_content_hash_required");
    }
  }
  await writeFile(
    resolve(absoluteOutput, "_headers"),
    [
      "/assets/*",
      `  Cache-Control: ${staticPolicy.outwardCacheControl}`,
      "",
      "/",
      "  Cache-Control: public, max-age=0, must-revalidate",
      "",
      "/index.html",
      "  Cache-Control: public, max-age=0, must-revalidate",
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  const entries = [];
  for (const path of await filesBelow(absoluteOutput)) {
    const bytes = await readFile(path);
    entries.push({
      path: relative(absoluteOutput, path).split(sep).join("/"),
      bytes: (await stat(path)).size,
      contentDigest: fileDigest(bytes),
    });
  }
  const manifest = {
    schemaVersion: "shareslices.static-assets/v1",
    artifactName: "static-assets",
    entries,
    contentDigest: sha256Digest(entries),
  };
  await mkdir(dirname(absoluteManifestOutput), { recursive: true });
  await writeFile(
    absoluteManifestOutput,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}

async function main() {
  const outputFlag = process.argv.indexOf("--output");
  const outputDirectory = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
  const manifestOutputFlag = process.argv.indexOf("--manifest-output");
  const manifestOutput =
    manifestOutputFlag >= 0 ? process.argv[manifestOutputFlag + 1] : null;
  if (!outputDirectory) throw new Error("static_assets_output_required");
  if (!manifestOutput) throw new Error("static_assets_manifest_output_required");
  process.stdout.write(
    `${JSON.stringify(await buildStaticAssets(outputDirectory, manifestOutput))}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
