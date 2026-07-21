// cspell:ignore hashtext
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { readMigrationEnv } from "../env.js";
import { createDatabaseConnection } from "./connection.js";

export type Migration = Readonly<{ name: string; sql: string }>;

export async function loadMigrations(
  migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations"),
): Promise<readonly Migration[]> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(migrationFiles.map(async (name) => ({
    name,
    sql: await readFile(resolve(migrationsDirectory, name), "utf8"),
  })));
}

export async function runMigrations(
  client: Pick<PoolClient, "query">,
  migrations: readonly Migration[],
): Promise<void> {
  await client.query("select pg_advisory_lock(hashtext('shareslices_migrations'))");
  try {
    await client.query(`
      create table if not exists shareslices_migration (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = await client.query<{ name: string }>("select name from shareslices_migration");
    const appliedNames = new Set(applied.rows.map((row) => row.name));

    for (const migration of migrations) {
      if (appliedNames.has(migration.name)) {
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query("insert into shareslices_migration (name) values ($1)", [migration.name]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('shareslices_migrations'))");
  }
}

export async function main(): Promise<void> {
  const env = readMigrationEnv();
  const connection = createDatabaseConnection({
    mode: "migration-direct",
    connectionString: env.DATABASE_URL,
    maxConnections: 1,
  });
  let client: PoolClient | undefined;
  try {
    client = await connection.pool.connect();
    await runMigrations(client, await loadMigrations());
  } finally {
    client?.release();
    await connection.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    apiLogger.emit({
      severity: "FATAL",
      body: "Database migration failed.",
      eventName: "shareslices.api.database.migration_failed",
      attributes: exceptionAttributes(error)
    });
    process.exitCode = 1;
  });
}
