import type { PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import { runMigrations, type Migration } from "../src/db/migrate.js";

function result<Row extends Record<string, unknown>>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function clientWithApplied(names: string[] = []): {
  client: Pick<PoolClient, "query">;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (text: string) => {
    if (text === "select name from shareslices_migration") {
      return result(names.map((name) => ({ name })));
    }
    return result();
  });
  return { client: { query } as unknown as Pick<PoolClient, "query">, query };
}

const migrations: readonly Migration[] = [
  { name: "0001_first.sql", sql: "select 'first'" },
  { name: "0002_second.sql", sql: "select 'second'" },
];

describe("migration runner", () => {
  it("holds the advisory lock and every transaction on one checked-out client", async () => {
    const { client, query } = clientWithApplied(["0001_first.sql"]);

    await runMigrations(client, migrations);

    expect(query.mock.calls.map(([text]) => text)).toEqual([
      "select pg_advisory_lock(hashtext('shareslices_migrations'))",
      expect.stringContaining("create table if not exists shareslices_migration"),
      "select name from shareslices_migration",
      "begin",
      "select 'second'",
      "insert into shareslices_migration (name) values ($1)",
      "commit",
      "select pg_advisory_unlock(hashtext('shareslices_migrations'))",
    ]);
    expect(query.mock.calls[5]?.[1]).toEqual(["0002_second.sql"]);
  });

  it("rolls back the file transaction and unlocks through that same client", async () => {
    const { client, query } = clientWithApplied();
    query.mockImplementation(async (text: string) => {
      if (text === "select name from shareslices_migration") return result();
      if (text === "select 'first'") throw new Error("migration failed");
      return result();
    });

    await expect(runMigrations(client, migrations)).rejects.toThrow("migration failed");

    expect(query.mock.calls.map(([text]) => text)).toEqual([
      "select pg_advisory_lock(hashtext('shareslices_migrations'))",
      expect.stringContaining("create table if not exists shareslices_migration"),
      "select name from shareslices_migration",
      "begin",
      "select 'first'",
      "rollback",
      "select pg_advisory_unlock(hashtext('shareslices_migrations'))",
    ]);
  });
});
