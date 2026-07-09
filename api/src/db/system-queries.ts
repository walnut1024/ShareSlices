import { pool } from "./client.js";

export async function checkDatabase(): Promise<void> {
  await pool.query("select 1");
}
