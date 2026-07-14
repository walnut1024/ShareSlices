import { spawn, spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const defaults = {
  DATABASE_URL: "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices",
  BETTER_AUTH_SECRET: "local-development-secret-at-least-32-bytes",
  BETTER_AUTH_URL: "http://127.0.0.1:7456",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  API_ORIGIN: "http://127.0.0.1:7456",
  VIEWER_ORIGIN: "http://127.0.0.1:7456",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "shareslices-artifacts",
  S3_ACCESS_KEY_ID: "shareslices",
  S3_SECRET_ACCESS_KEY: "shareslices-local-secret",
  S3_FORCE_PATH_STYLE: "true",
  WORKER_JOB_POLL_INTERVAL_MS: "1000",
  WORKER_JOB_LEASE_SECONDS: "30",
  WORKER_JOB_HEARTBEAT_SECONDS: "10",
  WORKER_JOB_MAX_ATTEMPTS: "3",
  MINIMUM_CLI_VERSION: "0.1.0",
  REQUIRE_EMAIL_VERIFICATION: "true",
  AUTH_EMAIL_ENCRYPTION_KEY: "local-email-encryption-secret-at-least-32-bytes",
  AUTH_EMAIL_SMTP_URL: "smtp://127.0.0.1:1025",
  AUTH_EMAIL_FROM: "ShareSlices <no-reply@shareslices.local>",
  PORT: "7456",
  NODE_ENV: "development"
};

const env = { ...defaults, ...process.env };
const compose = ["compose", "-f", "compose.yaml", "-f", "compose.dev.yaml"];

function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 1}.`);
  }
}

try {
  run("docker", [...compose, "stop", "web", "api", "worker"]);
  run("docker", [
    ...compose,
    "up",
    "-d",
    "--force-recreate",
    "--wait",
    "postgres",
    "object-storage",
    "mailpit"
  ]);
  run("docker", [...compose, "run", "--rm", "object-storage-init"]);
  run("docker", [...compose, "run", "--rm", "--build", "migrate"]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const services = [
  ["Web", "pnpm", ["--dir", "web", "dev"]],
  ["API", "pnpm", ["--dir", "api", "dev"]]
];

const children = new Set();
let stopping = false;

function stop(exitCode) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  spawnSync("docker", [...compose, "stop", "worker"], { env, stdio: "inherit" });
  process.exitCode = exitCode;
}

for (const [name, command, args] of services) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${name} failed to start:`, error);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} stopped (${signal ?? `exit ${code ?? 1}`}); stopping local development.`);
      stop(code ?? 1);
    }
  });
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:7456/health");
      if (response.ok) {
        return;
      }
    } catch {
      // The local API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local API did not become healthy within 15 seconds.");
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

try {
  await waitForApi();
  if (!stopping) {
    run("docker", [...compose, "up", "-d", "--no-deps", "--wait", "worker"]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
