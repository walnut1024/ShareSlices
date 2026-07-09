import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./client.js";

async function main(): Promise<void> {
  const migrationPath = join(process.cwd(), "..", "db", "migrations", "0001_account_entry.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
