import { spawnSync } from "node:child_process";
import net from "node:net";
import { pathToFileURL } from "node:url";

export const composeArgs = ["compose", "-f", "compose.yaml", "-f", "compose.gallery-local.yaml"];
export const localEndpoints = {
  api: "http://app.localhost:5173/ready",
  content: "http://content.localhost:7460/ready",
  mailpit: "http://127.0.0.1:8025/readyz",
  web: "http://app.localhost:5173/web-health",
};

export function commandFor(action, extraArgs = []) {
  switch (action) {
    case "up":
      return [...composeArgs, "up", "-d", "--build", "--force-recreate", "--wait"];
    case "down":
      return [...composeArgs, "down"];
    case "status":
      return [...composeArgs, "ps"];
    case "logs":
      return [...composeArgs, "logs", "--follow", ...extraArgs];
    default:
      throw new Error(`Unknown local stack action: ${action}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function checkHttp(name, url) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  console.log(`ready  ${name.padEnd(15)} ${url}`);
}

function checkTcp(name, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      console.log(`ready  ${name.padEnd(15)} ${host}:${port}`);
      resolve();
    });
    socket.once("timeout", () => socket.destroy(new Error(`${name} timed out`)));
    socket.once("error", reject);
  });
}

export async function verifyLocalStack() {
  await checkHttp("Web", localEndpoints.web);
  await checkHttp("API", localEndpoints.api);
  await checkHttp("Gallery content", localEndpoints.content);
  await checkHttp("Mailpit", localEndpoints.mailpit);
  await checkTcp("SMTP", "127.0.0.1", 1025);
}

async function main() {
  const [action = "up", ...extraArgs] = process.argv.slice(2);
  if (action === "up") {
    run("node", ["tools/check-gallery-local-config.mjs"]);
    run("docker", commandFor(action));
    await verifyLocalStack();
    console.log("\nShareSlices: http://app.localhost:5173");
    console.log("Mailpit:     http://127.0.0.1:8025");
    console.log("Gallery admin: mise run ops-gallery-bootstrap -- --administrator-user-id <user-id>");
    return;
  }
  run("docker", commandFor(action, extraArgs));
  if (action === "status") await verifyLocalStack();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
