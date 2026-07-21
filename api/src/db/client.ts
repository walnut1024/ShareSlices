import { readDatabaseEnv } from "../env.js";
import { createDatabaseConnection } from "./connection.js";

export const directConnection = createDatabaseConnection({
  mode: "node-direct",
  connectionString: readDatabaseEnv().DATABASE_URL,
});

export const pool = directConnection.pool;
export const db = directConnection.database;

export async function closeDb(): Promise<void> {
  await directConnection.close();
}
