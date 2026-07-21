// cspell:ignore millis
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseConnection,
  databasePoolConfig,
} from "../src/db/connection.js";

describe("database connection composition", () => {
  it.each([
    "node-direct",
    "hyperdrive",
    "migration-direct",
    "processing-direct",
  ] as const)("creates the %s Adapter without reading process environment", async (mode) => {
    const options = {
      connectionString: "postgres://user:password@database.example.test:5432/shareslices?sslmode=verify-full",
      maxConnections: mode === "hyperdrive" ? 5 : 10,
      connectionTimeoutMs: 3_000,
      idleTimeoutMs: 5_000,
    };
    const connection = mode === "hyperdrive"
      ? createDatabaseConnection({ ...options, mode, cache: "disabled" })
      : createDatabaseConnection({ ...options, mode });
    expect(connection.mode).toBe(mode);
    expect(connection.pool.options.max).toBe(mode === "hyperdrive" ? 5 : 10);
    expect(connection.pool.options.connectionTimeoutMillis).toBe(3_000);
    expect(connection.pool.options.idleTimeoutMillis).toBe(5_000);
    expect("withClient" in connection).toBe(true);
    await connection.close();
  });

  it("rejects a non-PostgreSQL endpoint before creating a client", () => {
    expect(() => databasePoolConfig({
      mode: "node-direct",
      connectionString: "mysql://database.example.test/shareslices",
    })).toThrow("must use PostgreSQL");
  });

  it("preserves explicit TLS identity parameters for the selected Adapter", () => {
    const connectionString = "postgres://database.example.test/shareslices?sslmode=verify-full";
    expect(databasePoolConfig({ mode: "processing-direct", connectionString }))
      .toMatchObject({ connectionString });
  });

  it("requires the Hyperdrive Adapter to declare cache-disabled configuration", () => {
    const connection = createDatabaseConnection({
      mode: "hyperdrive",
      cache: "disabled",
      connectionString: "postgres://user:password@hyperdrive.example.test/shareslices",
    });
    expect(connection.mode).toBe("hyperdrive");
    expect("withClient" in connection).toBe(true);
  });

  it.each(["success", "failure"] as const)(
    "holds one checked-out direct client for the whole %s operation and always releases it",
    async (outcome) => {
      const client = { query: vi.fn(), release: vi.fn() };
      const connect = vi.spyOn(pg.Pool.prototype, "connect")
        .mockResolvedValue(client as never);
      const connection = createDatabaseConnection({
        mode: "node-direct",
        connectionString: "postgres://user:password@database.example.test/shareslices",
      });
      const operation = vi.fn(async (selectedClient: typeof client) => {
        expect(selectedClient).toBe(client);
        if (outcome === "failure") throw new Error("operation failed");
        return "complete";
      });

      if (outcome === "failure") {
        await expect(connection.withClient(operation as never)).rejects.toThrow(
          "operation failed",
        );
      } else {
        await expect(connection.withClient(operation as never)).resolves.toBe("complete");
      }

      expect(connect).toHaveBeenCalledOnce();
      expect(operation).toHaveBeenCalledOnce();
      expect(client.release).toHaveBeenCalledOnce();
      connect.mockRestore();
      await connection.close();
    },
  );
});
