import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = new URL("./toolchain-baseline.json", import.meta.url);
const roles = Object.freeze([
  ["app", "app-worker-bundle", "api/src/cloudflare/app-entrypoint.ts"],
  ["content", "content-worker-bundle", "api/src/cloudflare/content-entrypoint.ts"],
  ["jobs", "jobs-worker-bundle", "api/src/cloudflare/jobs-entrypoint.ts"],
]);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function requireEmptyDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(outputDirectory);
  if (entries.length > 0) {
    throw new Error("cloudflare_worker_output_not_empty");
  }
}

export async function buildCloudflareWorkerBundles(outputDirectory) {
  const absoluteOutput = resolve(outputDirectory);
  await requireEmptyDirectory(absoluteOutput);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const artifacts = [];
  try {
    for (const [role, name, entrypoint] of roles) {
      const scratch = resolve(absoluteOutput, `.${role}-wrangler`);
      await mkdir(scratch);
      await execute(
        resolve(repositoryRoot, "node_modules/.bin/wrangler"),
        [
          "deploy",
          resolve(repositoryRoot, entrypoint),
          "--dry-run",
          "--outdir",
          scratch,
          "--compatibility-date",
          baseline.workersRuntime.compatibilityDate,
          ...baseline.workersRuntime.compatibilityFlags.flatMap((flag) => [
            "--compatibility-flags",
            flag,
          ]),
          "--name",
          `shareslices-${role}-bundle`,
        ],
        { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024 },
      );
      const sourceName = basename(entrypoint).replace(/\.ts$/, ".js");
      const sourcePath = resolve(scratch, sourceName);
      const outputName = `${role}-worker.js`;
      const outputPath = resolve(absoluteOutput, outputName);
      await copyFile(sourcePath, outputPath);
      const bytes = await readFile(outputPath);
      artifacts.push({
        name,
        role,
        entrypoint,
        file: outputName,
        bytes: (await stat(outputPath)).size,
        contentDigest: digest(bytes),
      });
      await rm(scratch, { recursive: true });
    }
    const manifest = {
      schemaVersion: "shareslices.cloudflare-worker-bundles/v1",
      wranglerVersion: baseline.wrangler.version,
      compatibilityDate: baseline.workersRuntime.compatibilityDate,
      compatibilityFlags: baseline.workersRuntime.compatibilityFlags,
      artifacts,
    };
    await writeFile(
      resolve(absoluteOutput, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    return manifest;
  } catch (error) {
    for (const [role] of roles) {
      await rm(resolve(absoluteOutput, `.${role}-wrangler`), {
        recursive: true,
        force: true,
      });
    }
    throw error;
  }
}

async function main() {
  const outputFlag = process.argv.indexOf("--output");
  const outputDirectory = outputFlag >= 0 ? process.argv[outputFlag + 1] : null;
  if (!outputDirectory) throw new Error("cloudflare_worker_output_required");
  const manifest = await buildCloudflareWorkerBundles(outputDirectory);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
