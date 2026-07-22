import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  migrationChecksum,
  runMigrations,
  type Migration,
} from "../src/db/migrate.js";

const { Client } = pg;

describe("migration runner PostgreSQL history", () => {
  const schemaName = `test_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const migrations: readonly Migration[] = [
    { name: "0001_first.sql", sql: "create table first_table (id integer primary key)" },
    { name: "0002_second.sql", sql: "create table second_table (id integer primary key)" },
    { name: "0003_third.sql", sql: "create table third_table (id integer primary key)" },
  ];

  beforeAll(async () => {
    await client.connect();
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}"`);
  });

  afterAll(async () => {
    await client.query(`drop schema if exists "${schemaName}" cascade`);
    await client.end();
  });

  it("upgrades a legacy prefix and records immutable, ordered history", async () => {
    await client.query(migrations[0]!.sql);
    await client.query(`
      create table shareslices_migration (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("insert into shareslices_migration (name) values ($1)", [migrations[0]!.name]);

    await runMigrations(client, migrations);

    const history = await client.query<{
      name: string;
      checksum: string;
      migration_order: number;
    }>("select name, checksum, migration_order from shareslices_migration order by migration_order");
    expect(history.rows).toEqual(migrations.map((migration, index) => ({
      name: migration.name,
      checksum: migrationChecksum(migration.sql),
      migration_order: index + 1,
    })));

    await expect(client.query(
      "update shareslices_migration set checksum = null where migration_order = 1",
    )).rejects.toThrow(/immutable/i);
    await expect(client.query(
      "update shareslices_migration set migration_order = 2 where migration_order = 1",
    )).rejects.toThrow(/immutable/i);
    await expect(client.query(
      "delete from shareslices_migration where migration_order = 1",
    )).rejects.toThrow(/immutable/i);
  });

  it("refuses packaged bytes that differ from an applied checksum", async () => {
    await expect(runMigrations(client, [
      {...migrations[0]!, sql: "select 'modified'"},
      ...migrations.slice(1),
    ])).rejects.toMatchObject({
      code: "migration_checksum_mismatch",
    });
  });
});
