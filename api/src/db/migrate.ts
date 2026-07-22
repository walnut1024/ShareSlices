// cspell:ignore conrelid errcode hashtext regclass tgisinternal tgname tgrelid
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { apiLogger, exceptionAttributes } from "../logging/index.js";
import { readMigrationEnv } from "../env.js";
import { createDatabaseConnection } from "./connection.js";

export type Migration = Readonly<{ name: string; sql: string; checksum?: string }>;

type AppliedMigration = Readonly<{
  name: string;
  checksum: string | null;
  migration_order: number | null;
}>;

export class MigrationIntegrityError extends Error {
  constructor(
    readonly code:
      | "migration_input_invalid"
      | "migration_history_not_ancestor"
      | "migration_checksum_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}

export function migrationChecksum(sql: string): string {
  return `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;
}

function normalizedMigrations(migrations: readonly Migration[]): readonly Required<Migration>[] {
  const normalized = migrations.map((migration) => ({
    ...migration,
    checksum: migration.checksum ?? migrationChecksum(migration.sql),
  }));
  for (let index = 0; index < normalized.length; index += 1) {
    const migration = normalized[index];
    const previous = normalized[index - 1];
    if (
      !migration ||
      !/^sha256:[a-f0-9]{64}$/.test(migration.checksum) ||
      migration.checksum !== migrationChecksum(migration.sql) ||
      (previous !== undefined && previous.name >= migration.name)
    ) {
      throw new MigrationIntegrityError(
        "migration_input_invalid",
        "Migration files must be uniquely and strictly ordered and their checksums must match their bytes.",
      );
    }
  }
  return normalized;
}

export async function loadMigrations(
  migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations"),
): Promise<readonly Migration[]> {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(migrationFiles.map(async (name) => {
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    return { name, sql, checksum: migrationChecksum(sql) };
  }));
}

export async function runMigrations(
  client: Pick<PoolClient, "query">,
  migrations: readonly Migration[],
): Promise<void> {
  const orderedMigrations = normalizedMigrations(migrations);
  await client.query("select pg_advisory_lock(hashtext('shareslices_migrations'))");
  try {
    await client.query(`
      create table if not exists shareslices_migration (
        name text primary key,
        checksum text not null,
        migration_order integer not null unique check (migration_order > 0),
        applied_at timestamptz not null default now()
      )
    `);

    await client.query("begin");
    let appliedRows: readonly AppliedMigration[];
    try {
      await client.query("alter table shareslices_migration add column if not exists checksum text");
      await client.query("alter table shareslices_migration add column if not exists migration_order integer");
      const applied = await client.query<AppliedMigration>(
        "select name, checksum, migration_order from shareslices_migration order by migration_order nulls last, name",
      );
      appliedRows = applied.rows;
      if (appliedRows.length > orderedMigrations.length) {
        throw new MigrationIntegrityError(
          "migration_history_not_ancestor",
          "Applied migration history is not an ancestor of the packaged migration sequence.",
        );
      }
      for (let index = 0; index < appliedRows.length; index += 1) {
        const row = appliedRows[index];
        const migration = orderedMigrations[index];
        if (!row || !migration || row.name !== migration.name ||
            (row.migration_order !== null && row.migration_order !== index + 1)) {
          throw new MigrationIntegrityError(
            "migration_history_not_ancestor",
            "Applied migration history is not an ordered prefix of the packaged migration sequence.",
          );
        }
        if (row.checksum !== null && row.checksum !== migration.checksum) {
          throw new MigrationIntegrityError(
            "migration_checksum_mismatch",
            `Applied migration ${row.name} does not match its immutable packaged checksum.`,
          );
        }
        if (row.checksum === null || row.migration_order === null) {
          await client.query(
            "update shareslices_migration set checksum = $2, migration_order = $3 where name = $1 and (checksum is null or migration_order is null)",
            [row.name, migration.checksum, index + 1],
          );
        }
      }
      await client.query("alter table shareslices_migration alter column checksum set not null");
      await client.query("alter table shareslices_migration alter column migration_order set not null");
      await client.query(
        "create unique index if not exists shareslices_migration_order_unique on shareslices_migration (migration_order)",
      );
      await client.query(`
        do $$
        begin
          if not exists (
            select 1 from pg_constraint
             where conrelid = 'shareslices_migration'::regclass
               and conname = 'shareslices_migration_checksum_format'
          ) then
            alter table shareslices_migration
              add constraint shareslices_migration_checksum_format
              check (checksum ~ '^sha256:[a-f0-9]{64}$');
          end if;
        end
        $$
      `);
      await client.query(`
        create or replace function shareslices_reject_migration_history_mutation()
        returns trigger language plpgsql as $$
        begin
          raise exception 'shareslices migration history is immutable' using errcode = '55000';
        end
        $$
      `);
      await client.query(`
        do $$
        begin
          if not exists (
            select 1 from pg_trigger
             where tgrelid = 'shareslices_migration'::regclass
               and tgname = 'shareslices_migration_history_immutable'
               and not tgisinternal
          ) then
            create trigger shareslices_migration_history_immutable
              before update or delete on shareslices_migration
              for each row execute function shareslices_reject_migration_history_mutation();
          end if;
        end
        $$
      `);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    for (let index = appliedRows.length; index < orderedMigrations.length; index += 1) {
      const migration = orderedMigrations[index];
      if (!migration) continue;

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into shareslices_migration (name, checksum, migration_order) values ($1, $2, $3)",
          [migration.name, migration.checksum, index + 1],
        );
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
  try {
    await connection.withClient(async (client) => {
      await runMigrations(client, await loadMigrations());
    });
  } finally {
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
