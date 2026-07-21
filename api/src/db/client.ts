import { readDatabaseEnv } from "../env.js";
import { createDatabaseConnection } from "./connection.js";

const connection = createDatabaseConnection({
  mode: "node-direct",
  connectionString: readDatabaseEnv().DATABASE_URL,
});

export const pool = connection.pool;
export const db = connection.database;

export async function closeDb(): Promise<void> {
  await connection.close();
}
