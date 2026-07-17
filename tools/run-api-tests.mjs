import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const testStackEnvironment = {
  COMPOSE_PROJECT_NAME: "shareslices-test",
  POSTGRES_PORT: "55432",
  OBJECT_STORAGE_PORT: "59000",
  OBJECT_STORAGE_CONSOLE_PORT: "59001",
  SMTP_PORT: "51025",
  MAILPIT_HTTP_PORT: "58025",
  API_PORT: "57456",
  GALLERY_CONTENT_PUBLISHED_PORT: "57460",
  WEB_PORT: "55173",
  BETTER_AUTH_URL: "http://127.0.0.1:55173",
  WEB_ORIGIN: "http://127.0.0.1:55173",
  API_ORIGIN: "http://127.0.0.1:57456",
  VIEWER_ORIGIN: "http://127.0.0.1:55173",
  WEB_CANONICAL_HOST: "127.0.0.1",
  SHARESLICES_TEST_DATABASE_URL: "postgres://shareslices:shareslices@127.0.0.1:55432/shareslices_test",
  SHARESLICES_TEST_S3_ENDPOINT: "http://127.0.0.1:59000",
  SHARESLICES_TEST_SMTP_URL: "smtp://127.0.0.1:51025",
  SHARESLICES_TEST_MAILPIT_URL: "http://127.0.0.1:58025",
  SHARESLICES_TEST_WEB_ORIGIN: "http://127.0.0.1:55173",
  SHARESLICES_ARTIFACT_FLOW_URL: "http://127.0.0.1:57456",
  SHARESLICES_ACCOUNT_DEFAULT_URL: "http://127.0.0.1:57610",
  SHARESLICES_ACCOUNT_FAILURE_URL: "http://127.0.0.1:57611",
  SHARESLICES_ACCOUNT_SMTP_URL: "http://127.0.0.1:57612",
};

function run(command, args, env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

export function commandsForApiTests() {
  return [
    ["docker", ["compose", "down", "--volumes", "--remove-orphans"]],
    ["docker", ["compose", "up", "-d", "--wait", "postgres", "object-storage", "mailpit"]],
    ["docker", ["compose", "run", "--rm", "object-storage-init"]],
    ["docker", ["compose", "exec", "-T", "postgres", "dropdb", "--if-exists", "--force", "-U", "shareslices", "shareslices_test"]],
    ["docker", ["compose", "exec", "-T", "postgres", "createdb", "-U", "shareslices", "shareslices_test"]],
  ];
}

async function main() {
  const {
    API_ORIGIN: _apiOrigin,
    BETTER_AUTH_URL: _betterAuthUrl,
    VIEWER_ORIGIN: _viewerOrigin,
    WEB_CANONICAL_HOST: _webCanonicalHost,
    WEB_ORIGIN: _webOrigin,
    ...testProcessEnvironment
  } = testStackEnvironment;
  const env = {
    ...process.env,
    ...testProcessEnvironment,
    DATABASE_URL: testStackEnvironment.SHARESLICES_TEST_DATABASE_URL,
  };
  const composeEnv = { ...env, ...testStackEnvironment };
  const cleanup = commandsForApiTests()[0];
  try {
    for (const [command, args] of commandsForApiTests()) run(command, args, composeEnv);
    run("node", ["--env-file=.env.example", "--env-file-if-exists=.env", "api/node_modules/tsx/dist/cli.mjs", "api/src/db/migrate.ts"], env);
    run("pnpm", ["--dir", "api", "run", "test"], env);
    run("uv", ["run", "pytest", "api/tests/test_account_entry_contract.py"], env);
    run("docker", ["compose", "up", "-d", "--build", "--wait", "api", "worker", "web"], composeEnv);
    run("uv", ["run", "pytest", "api/tests/artifact_flow_contract.py"], env);
  } finally {
    run(cleanup[0], cleanup[1], composeEnv);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
