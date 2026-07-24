import assert from "node:assert/strict";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {sha256Digest} from "../automation/canonical.mjs";
import {
  CloudflareMigrationError,
  createCloudflareMigrationExecutor,
} from "./migration-execution.mjs";

async function harness() {
  const root = await mkdtemp(resolve(tmpdir(), "shareslices-cloudflare-migration-"));
  await mkdir(resolve(root, "db/migrations"), {recursive: true});
  const sql = Buffer.from("select 1;\n");
  await writeFile(resolve(root, "db/migrations/0001_foundation.sql"), sql);
  const migration = {
    order: 1,
    id: "0001_foundation.sql",
    checksum: sha256Digest(sql),
  };
  return {
    root,
    config: {
      target: "cloudflare",
      shared: {database: {ref: "secret://postgres/migration", revision: "7"}},
    },
    migrationResource: {
      phase: "migration",
      desired: {
        execution: "one-shot-direct-postgresql",
        schemaHead: migration.id,
        migrations: [migration],
      },
    },
  };
}

test("executes the checked direct migration entrypoint without returning its Secret", async () => {
  const input = await harness();
  const calls = [];
  const executeMigration = createCloudflareMigrationExecutor({
    repositoryRoot: input.root,
    resolvers: {secret: async () => "postgresql://migration-secret"},
    execute: async (...args) => calls.push(args),
  });
  const result = await executeMigration(input);
  assert.equal(result.outcome, "completed");
  assert.equal(result.schemaHead, "0001_foundation.sql");
  assert.equal(result.migrationCount, 1);
  assert.match(result.manifestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("migration-secret"), false);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [
    resolve(input.root, "node_modules/tsx/dist/cli.mjs"),
    resolve(input.root, "api/src/db/migrate.ts"),
  ]);
  assert.deepEqual(calls[0][2].env, {
    DATABASE_URL: "postgresql://migration-secret",
    NODE_ENV: "production",
  });
});

test("refuses checksum drift before resolving or connecting to PostgreSQL", async () => {
  const input = await harness();
  input.migrationResource.desired.migrations[0].checksum = `sha256:${"f".repeat(64)}`;
  let resolved = false;
  let executed = false;
  const executeMigration = createCloudflareMigrationExecutor({
    repositoryRoot: input.root,
    resolvers: {secret: async () => {
      resolved = true;
      return "postgresql://must-not-be-used";
    }},
    execute: async () => {
      executed = true;
    },
  });
  await assert.rejects(
    executeMigration(input),
    (error) => error instanceof CloudflareMigrationError &&
      error.code === "cloudflare_migration_checksum_mismatch",
  );
  assert.equal(resolved, false);
  assert.equal(executed, false);
});

test("requires one contiguous manifest ending at the declared schema head", async () => {
  const input = await harness();
  input.migrationResource.desired.schemaHead = "0002_missing.sql";
  await assert.rejects(
    createCloudflareMigrationExecutor({
      repositoryRoot: input.root,
      resolvers: {secret: async () => "postgresql://unused"},
    })(input),
    (error) => error instanceof CloudflareMigrationError &&
      error.code === "cloudflare_migration_resource_invalid",
  );
});
