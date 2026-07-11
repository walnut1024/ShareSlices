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
  PORT: "7456",
  NODE_ENV: "development"
};

const env = { ...defaults, ...process.env };

function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("docker", ["compose", "stop", "web", "api", "worker"]);
run("docker", [
  "compose",
  "up",
  "-d",
  "--wait",
  "postgres",
  "object-storage"
]);
run("docker", ["compose", "run", "--rm", "object-storage-init"]);
run("pnpm", ["--dir", "api", "db:migrate"]);

const services = [
  ["Web", "pnpm", ["--dir", "web", "dev"]],
  ["API", "pnpm", ["--dir", "api", "dev"]],
  ["Worker", "cargo", ["run", "-p", "shareslices-worker"]]
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

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
