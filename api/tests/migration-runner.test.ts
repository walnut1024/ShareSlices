import type { PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  MigrationIntegrityError,
  loadMigrations,
  migrationChecksum,
  runMigrations,
  type Migration,
} from "../src/db/migrate.js";

function result<Row extends Record<string, unknown>>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

const migrations: readonly Migration[] = [
  { name: "0001_first.sql", sql: "select 'first'" },
  { name: "0002_second.sql", sql: "select 'second'" },
  { name: "0003_third.sql", sql: "select 'third'" },
];

type AppliedRow = { name: string; checksum: string | null; migration_order: number | null };

function clientWithApplied(rows: AppliedRow[] = []): {
  client: Pick<PoolClient, "query">;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (text: string) => {
    if (text.startsWith("select name, checksum, migration_order")) return result(rows);
    return result();
  });
  return { client: { query } as unknown as Pick<PoolClient, "query">, query };
}

function appliedPrefix(length: number, sequence = migrations): AppliedRow[] {
  return sequence.slice(0, length).map((migration, index) => ({
    name: migration.name,
    checksum: migrationChecksum(migration.sql),
    migration_order: index + 1,
  }));
}

describe("migration runner", () => {
  it("holds the advisory lock and every transaction on one checked-out client", async () => {
    const { client, query } = clientWithApplied(appliedPrefix(1));

    await runMigrations(client, migrations.slice(0, 2));

    const calls = query.mock.calls.map(([text]) => text as string);
    expect(calls[0]).toBe("select pg_advisory_lock(hashtext('shareslices_migrations'))");
    expect(calls).toContain("select name, checksum, migration_order from shareslices_migration order by migration_order nulls last, name");
    expect(calls).toContain("select 'second'");
    expect(calls).not.toContain("select 'first'");
    expect(calls.at(-1)).toBe("select pg_advisory_unlock(hashtext('shareslices_migrations'))");
    const insert = query.mock.calls.find(([text]) => (text as string).startsWith("insert into shareslices_migration"));
    expect(insert?.[1]).toEqual(["0002_second.sql", migrationChecksum("select 'second'"), 2]);
  });

  it("rolls back the file transaction and unlocks through that same client", async () => {
    const { client, query } = clientWithApplied();
    query.mockImplementation(async (text: string) => {
      if (text.startsWith("select name, checksum, migration_order")) return result();
      if (text === "select 'first'") throw new Error("migration failed");
      return result();
    });

    await expect(runMigrations(client, migrations)).rejects.toThrow("migration failed");

    const calls = query.mock.calls.map(([text]) => text as string);
    expect(calls.slice(-3)).toEqual([
      "select 'first'",
      "rollback",
      "select pg_advisory_unlock(hashtext('shareslices_migrations'))",
    ]);
  });

  it("backfills legacy rows once while preserving their ordered prefix", async () => {
    const { client, query } = clientWithApplied([
      { name: migrations[0]!.name, checksum: null, migration_order: null },
    ]);

    await runMigrations(client, migrations.slice(0, 1));

    const update = query.mock.calls.find(([text]) => (text as string).startsWith("update shareslices_migration"));
    expect(update?.[1]).toEqual([migrations[0]!.name, migrationChecksum(migrations[0]!.sql), 1]);
  });

  it("refuses modified, reordered, missing, or unknown applied ancestry", async () => {
    const cases: AppliedRow[][] = [
      [{ ...appliedPrefix(1)[0]!, checksum: migrationChecksum("changed") }],
      [{ ...appliedPrefix(1)[0]!, migration_order: 2 }],
      [appliedPrefix(2)[1]!],
      [{ name: "0000_unknown.sql", checksum: migrationChecksum("unknown"), migration_order: 1 }],
    ];

    for (const rows of cases) {
      const { client } = clientWithApplied(rows);
      await expect(runMigrations(client, migrations)).rejects.toBeInstanceOf(MigrationIntegrityError);
    }
  });

  it("refuses unordered inputs and caller-supplied checksums that do not match the SQL bytes", async () => {
    const { client } = clientWithApplied();
    await expect(runMigrations(client, [migrations[1]!, migrations[0]!])).rejects.toMatchObject({
      code: "migration_input_invalid",
    });
    await expect(runMigrations(client, [{
      ...migrations[0]!,
      checksum: migrationChecksum("different bytes"),
    }])).rejects.toMatchObject({ code: "migration_input_invalid" });
  });

  it("fails safely after every committed prefix and resumes without repeating it", async () => {
    const packagedMigrations = await loadMigrations();
    for (let prefixLength = 0; prefixLength < packagedMigrations.length; prefixLength += 1) {
      const rows = appliedPrefix(prefixLength, packagedMigrations);
      let pendingInsert: AppliedRow | undefined;
      let failSql: string | undefined = packagedMigrations[prefixLength]!.sql;
      const query = vi.fn(async (text: string, values?: unknown[]) => {
        if (text.startsWith("select name, checksum, migration_order")) return result([...rows]);
        if (text === failSql) throw new Error(`failure after prefix ${prefixLength}`);
        if (text.startsWith("insert into shareslices_migration")) {
          pendingInsert = {
            name: values?.[0] as string,
            checksum: values?.[1] as string,
            migration_order: values?.[2] as number,
          };
        } else if (text === "commit" && pendingInsert) {
          rows.push(pendingInsert);
          pendingInsert = undefined;
        } else if (text === "rollback") {
          pendingInsert = undefined;
        }
        return result();
      });
      const client = { query } as unknown as Pick<PoolClient, "query">;

      await expect(runMigrations(client, packagedMigrations)).rejects.toThrow(`failure after prefix ${prefixLength}`);
      expect(rows).toEqual(appliedPrefix(prefixLength, packagedMigrations));

      failSql = undefined;
      query.mockClear();
      await runMigrations(client, packagedMigrations);
      expect(rows).toEqual(appliedPrefix(packagedMigrations.length, packagedMigrations));
      for (const migration of packagedMigrations.slice(0, prefixLength)) {
        expect(query.mock.calls.some(([text]) => text === migration.sql)).toBe(false);
      }
    }
  });
});
