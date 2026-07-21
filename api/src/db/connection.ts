// cspell:ignore millis
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type Pool, type PoolConfig } from "pg";
import * as schema from "./schema.js";

const { Pool: PostgresPool } = pg;

export type DatabaseConnectionMode =
  | "node-direct"
  | "hyperdrive"
  | "migration-direct"
  | "processing-direct";

export type DatabaseConnection = Readonly<{
  mode: DatabaseConnectionMode;
  pool: Pool;
  database: ReturnType<typeof drizzle<typeof schema>>;
  close(): Promise<void>;
}>;

type DatabaseConnectionOptions = Readonly<{
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}>;

export type DatabaseConnectionInput = DatabaseConnectionOptions & (
  | Readonly<{ mode: Exclude<DatabaseConnectionMode, "hyperdrive"> }>
  | Readonly<{ mode: "hyperdrive"; cache: "disabled" }>
);

function validateConnectionString(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Database connection must use PostgreSQL.");
  }
  return value;
}

export function databasePoolConfig(input: DatabaseConnectionInput): PoolConfig {
  const config: PoolConfig = {
    connectionString: validateConnectionString(input.connectionString),
  };
  if (input.maxConnections !== undefined) config.max = input.maxConnections;
  if (input.connectionTimeoutMs !== undefined) {
    config.connectionTimeoutMillis = input.connectionTimeoutMs;
  }
  if (input.idleTimeoutMs !== undefined) config.idleTimeoutMillis = input.idleTimeoutMs;
  return config;
}

export function createDatabaseConnection(
  input: DatabaseConnectionInput,
): DatabaseConnection {
  const pool = new PostgresPool(databasePoolConfig(input));
  return Object.freeze({
    mode: input.mode,
    pool,
    database: drizzle(pool, { schema }),
    close: () => pool.end(),
  });
}
