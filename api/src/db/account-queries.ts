import { pool } from "./client.js";

export async function userExistsByEmail(email: string): Promise<boolean> {
  const result = await pool.query('select 1 from "user" where email = $1 limit 1', [email]);
  return (result.rowCount ?? 0) > 0;
}

export async function findUserByEmail(email: string): Promise<{ id: string; emailVerified: boolean } | null> {
  const result = await pool.query<{ id: string; email_verified: boolean }>(
    'select id, email_verified from "user" where email = $1 limit 1',
    [email]
  );
  const value = result.rows[0];
  return value ? { id: value.id, emailVerified: value.email_verified } : null;
}

export async function userExistsById(userId: string): Promise<boolean> {
  const result = await pool.query('select 1 from "user" where id = $1 limit 1', [userId]);
  return (result.rowCount ?? 0) > 0;
}
