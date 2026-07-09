import { pool } from "./client.js";

export async function userExistsByEmail(email: string): Promise<boolean> {
  const result = await pool.query('select 1 from "user" where email = $1 limit 1', [email]);
  return (result.rowCount ?? 0) > 0;
}

export async function userExistsById(userId: string): Promise<boolean> {
  const result = await pool.query('select 1 from "user" where id = $1 limit 1', [userId]);
  return (result.rowCount ?? 0) > 0;
}
