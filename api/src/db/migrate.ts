// cspell:ignore hashtext
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { pool } from "./client.js";

async function main(): Promise<void> {
  const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
  const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

  await pool.query("select pg_advisory_lock(hashtext('shareslices_migrations'))");
  try {
    await pool.query(`
      create table if not exists shareslices_migration (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = await pool.query<{ name: string }>("select name from shareslices_migration");
    const appliedNames = new Set(applied.rows.map((row) => row.name));

    for (const migrationFile of migrationFiles) {
      if (appliedNames.has(migrationFile)) {
        continue;
      }

      await pool.query("begin");
      try {
        await pool.query(await readFile(resolve(migrationsDirectory, migrationFile), "utf8"));
        await pool.query("insert into shareslices_migration (name) values ($1)", [migrationFile]);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
    }
  } finally {
    await pool.query("select pg_advisory_unlock(hashtext('shareslices_migrations'))");
    await pool.end();
  }
}

main().catch((error) => {
  apiLogger.emit({
    severity: "FATAL",
    body: "Database migration failed.",
    eventName: "shareslices.api.database.migration_failed",
    attributes: exceptionAttributes(error)
  });
  process.exitCode = 1;
});
