import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("usage: mise run ops-authentication-email-reconcile -- <authorization.json>");
  }
  const result = spawnSync(
    process.execPath,
    [
      resolve("api/node_modules/tsx/dist/cli.mjs"),
      resolve("api/src/operations/authentication-email-reconcile.ts"),
      resolve(argv[0]),
    ],
    { env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "account_maintenance_failed"}\n`);
    process.exitCode = 1;
  }
}
