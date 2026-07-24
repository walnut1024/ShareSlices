import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const wranglerPath = fileURLToPath(
  new URL("../../node_modules/.bin/wrangler", import.meta.url),
);

function defaultCommand(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
  return Object.freeze({
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

function parseJson(value) {
  const start = value.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(value.slice(start));
  } catch {
    return null;
  }
}

export function createWranglerApiCredentialScope({
  runCommand = defaultCommand,
  executable = wranglerPath,
} = {}) {
  return async function withCredential(operation) {
    if (typeof operation !== "function") {
      throw new TypeError("A scoped Cloudflare credential operation is required.");
    }
    const result = runCommand(executable, ["auth", "token", "--json"]);
    const credential = parseJson(result.stdout);
    if (
      result.status !== 0 ||
      !credential ||
      !["oauth", "api_token"].includes(credential.type) ||
      typeof credential.token !== "string" ||
      credential.token.length === 0
    ) {
      throw new Error("cloudflare_wrangler_scoped_credential_unavailable");
    }
    try {
      return await operation(credential.token);
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.includes(credential.token) ||
          error.stack?.includes(credential.token)
        )
      ) {
        throw new Error("cloudflare_wrangler_scoped_operation_failed");
      }
      throw error;
    } finally {
      credential.token = "";
    }
  };
}
