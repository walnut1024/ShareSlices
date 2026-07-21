// cspell:ignore millis
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type Pool, type PoolClient, type PoolConfig } from "pg";
import * as schema from "./schema.js";

const { Pool: PostgresPool } = pg;

export type DatabaseConnectionMode =
  | "node-direct"
  | "hyperdrive"
  | "migration-direct"
  | "processing-direct";

export type DirectDatabaseConnectionMode = Exclude<
  DatabaseConnectionMode,
  "hyperdrive"
>;

export type DatabaseClientSource = Readonly<{
  mode: DatabaseConnectionMode;
  withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T>;
}>;

export type DirectClientSource = DatabaseClientSource & Readonly<{
  mode: DirectDatabaseConnectionMode;
}>;

type DatabaseConnectionBase = Readonly<{
  mode: DatabaseConnectionMode;
  pool: Pool;
  database: ReturnType<typeof drizzle<typeof schema>>;
  close(): Promise<void>;
}>;

export type DirectDatabaseConnection = DatabaseConnectionBase & DirectClientSource;
export type HyperdriveDatabaseConnection = DatabaseConnectionBase & DatabaseClientSource &
  Readonly<{ mode: "hyperdrive" }>;
export type DatabaseConnection =
  | DirectDatabaseConnection
  | HyperdriveDatabaseConnection;

type DatabaseConnectionOptions = Readonly<{
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}>;

export type DatabaseConnectionInput = DatabaseConnectionOptions & (
  | Readonly<{ mode: DirectDatabaseConnectionMode }>
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
  input: DatabaseConnectionOptions & Readonly<{ mode: DirectDatabaseConnectionMode }>,
): DirectDatabaseConnection;
export function createDatabaseConnection(
  input: DatabaseConnectionOptions & Readonly<{ mode: "hyperdrive"; cache: "disabled" }>,
): HyperdriveDatabaseConnection;
export function createDatabaseConnection(input: DatabaseConnectionInput): DatabaseConnection {
  const pool = new PostgresPool(databasePoolConfig(input));
  const database = drizzle(pool, { schema });
  const close = () => pool.end();
  return Object.freeze({
    mode: input.mode,
    pool,
    database,
    close,
    async withClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await operation(client);
      } finally {
        client.release();
      }
    },
  });
}
