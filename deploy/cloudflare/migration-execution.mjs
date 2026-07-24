import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

import {sha256Digest} from "../automation/canonical.mjs";
import {withResolvedSecret} from "../automation/secrets.mjs";

const defaultExecute = promisify(execFile);
const defaultRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export class CloudflareMigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CloudflareMigrationError";
    this.code = code;
  }
}

async function verifyMigrationInputs(repositoryRoot, migrationResource) {
  const migrations = migrationResource?.desired?.migrations;
  const schemaHead = migrationResource?.desired?.schemaHead;
  if (
    migrationResource?.phase !== "migration" ||
    migrationResource?.desired?.execution !== "one-shot-direct-postgresql" ||
    !Array.isArray(migrations) ||
    migrations.length === 0 ||
    migrations.at(-1)?.id !== schemaHead
  ) {
    throw new CloudflareMigrationError(
      "cloudflare_migration_resource_invalid",
      "Cloudflare migration execution requires one complete ordered migration resource.",
    );
  }
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    if (
      migration?.order !== index + 1 ||
      typeof migration.id !== "string" ||
      !migration.id.endsWith(".sql") ||
      !/^sha256:[a-f0-9]{64}$/.test(migration.checksum)
    ) {
      throw new CloudflareMigrationError(
        "cloudflare_migration_manifest_invalid",
        "Cloudflare migration execution requires contiguous immutable migration metadata.",
      );
    }
    let bytes;
    try {
      bytes = await readFile(resolve(repositoryRoot, "db/migrations", migration.id));
    } catch {
      throw new CloudflareMigrationError(
        "cloudflare_migration_artifact_missing",
        `Authorized migration ${migration.id} is not packaged.`,
      );
    }
    if (sha256Digest(bytes) !== migration.checksum) {
      throw new CloudflareMigrationError(
        "cloudflare_migration_checksum_mismatch",
        `Authorized migration ${migration.id} does not match its packaged bytes.`,
      );
    }
  }
  return {migrations, schemaHead};
}

export function createCloudflareMigrationExecutor({
  resolvers,
  execute = defaultExecute,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  return async ({config, migrationResource}) => {
    if (config?.target !== "cloudflare") {
      throw new CloudflareMigrationError(
        "cloudflare_target_required",
        "The direct Cloudflare migration path accepts only Cloudflare configurations.",
      );
    }
    const verified = await verifyMigrationInputs(repositoryRoot, migrationResource);
    return withResolvedSecret(config.shared.database, resolvers ?? {}, async (databaseUrl) => {
      await execute(
        process.execPath,
        [
          resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs"),
          resolve(repositoryRoot, "api/src/db/migrate.ts"),
        ],
        {
          cwd: repositoryRoot,
          env: {DATABASE_URL: databaseUrl, NODE_ENV: "production"},
          maxBuffer: 1024 * 1024,
        },
      );
      return Object.freeze({
        outcome: "completed",
        execution: "one-shot-direct-postgresql",
        schemaHead: verified.schemaHead,
        migrationCount: verified.migrations.length,
        manifestDigest: sha256Digest(verified.migrations),
      });
    });
  };
}
