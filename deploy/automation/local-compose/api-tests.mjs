import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  dockerEnvironment,
  withDockerMutationController,
} from "./docker-controller.mjs";
import {
  composeFeatureBaseline,
  inspectComposeServices,
  verifyComposeCapabilities,
} from "./compose-capabilities.mjs";
import { loadAndValidateTestComposeModel } from "./test-topology-policy.mjs";
import {
  assertEndpointLayerUnchanged,
  freezeTestEndpoints,
  runtimeEnvironmentContents,
} from "./test-endpoints.mjs";
import {
  createTestOwnership,
  ownershipEnvironmentContents,
  recoverOwnedTestProject,
} from "./test-ownership.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const testEnvironmentFile = fileURLToPath(
  new URL("../../compose/test.env", import.meta.url),
);
export const testComposeArgs = [
  "compose",
  "--project-directory",
  repositoryRoot,
  "--env-file",
  testEnvironmentFile,
  "-p",
  "shareslices-test",
  "-f",
  "deploy/compose/compose.yaml",
  "-f",
  "deploy/compose/compose.test.yaml",
];

export function testComposeArgsWithOwnership(ownershipEnvironmentFile) {
  return [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    testEnvironmentFile,
    "--env-file",
    ownershipEnvironmentFile,
    "-p",
    "shareslices-test",
    "-f",
    "deploy/compose/compose.yaml",
    "-f",
    "deploy/compose/compose.test.yaml",
  ];
}

export function testComposeArgsWithRuntime(ownershipEnvironmentFile, runtimeEnvironmentFile) {
  const args = testComposeArgsWithOwnership(ownershipEnvironmentFile);
  args.splice(args.indexOf("-p"), 0, "--env-file", runtimeEnvironmentFile);
  return args;
}

function parseEnvironmentFixture(contents) {
  return Object.fromEntries(
    contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator <= 0) throw new Error(`Invalid test environment entry: ${line}`);
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

export const testStackEnvironment = Object.freeze(
  parseEnvironmentFixture(readFileSync(testEnvironmentFile, "utf8")),
);

function existingSocket(path) {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

export function resolveLocalDockerHost() {
  const candidates = ["/var/run/docker.sock", join(homedir(), ".docker/run/docker.sock")];
  const socket = candidates.find(existingSocket);
  if (!socket) {
    throw new Error(
      `No supported local Docker socket found (${candidates.join(", ")}); remote and caller-selected Docker endpoints are refused.`,
    );
  }
  return `unix://${socket}`;
}

export function dockerChildEnvironment({ dockerConfig, dockerHost }) {
  return dockerEnvironment({ dockerConfig, host: dockerHost });
}

function resolveDockerPlugin(pluginName) {
  const executableName = `docker-${pluginName}`;
  const candidates = [
    join(homedir(), `.docker/cli-plugins/${executableName}`),
    `/Applications/Docker.app/Contents/Resources/cli-plugins/${executableName}`,
    `/opt/homebrew/lib/docker/cli-plugins/${executableName}`,
    `/usr/local/lib/docker/cli-plugins/${executableName}`,
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed local plugin locations.
    }
  }
  throw new Error(`Docker ${pluginName} plugin not found (${candidates.join(", ")})`);
}

export function resolveDockerPlugins() {
  return Object.freeze({
    buildx: resolveDockerPlugin("buildx"),
    compose: resolveDockerPlugin("compose"),
  });
}

export function prepareIsolatedDockerConfig(dockerConfig, plugins) {
  const pluginDirectory = join(dockerConfig, "cli-plugins");
  mkdirSync(pluginDirectory, { mode: 0o700, recursive: true });
  writeFileSync(join(dockerConfig, "config.json"), "{}\n", { mode: 0o600 });
  for (const [pluginName, pluginPath] of Object.entries(plugins)) {
    symlinkSync(pluginPath, join(pluginDirectory, `docker-${pluginName}`));
  }
}

export function commandsForApiTests() {
  return [
    [
      "docker",
      [
        ...testComposeArgs,
        "up", "-d", "--build", "--wait", "--wait-timeout",
        String(composeFeatureBaseline.waitTimeoutSeconds),
        "postgres", "object-storage", "mailpit", "test-ingress",
      ],
    ],
    ["docker", [...testComposeArgs, "run", "--rm", "object-storage-init"]],
    [
      "docker",
      [
        ...testComposeArgs,
        "exec",
        "-T",
        "postgres",
        "dropdb",
        "--if-exists",
        "--force",
        "-U",
        "shareslices",
        "shareslices_test",
      ],
    ],
    [
      "docker",
      [
        ...testComposeArgs,
        "exec",
        "-T",
        "postgres",
        "createdb",
        "-U",
        "shareslices",
        "shareslices_test",
      ],
    ],
  ];
}

export function cleanupCommand(composeArgs) {
  return ["docker", [...composeArgs, "down", "--volumes", "--remove-orphans"]];
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const signal = result.signal ? ` after ${result.signal}` : "";
    throw new Error(`${command} exited with ${result.status ?? "no status"}${signal}`);
  }
}

function executeDockerModel(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no diagnostic output";
    throw new Error(`docker ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

export function processChildEnvironment(testRoot, endpoints, ambientEnvironment = process.env) {
  const {
    API_ORIGIN: _apiOrigin,
    BETTER_AUTH_URL: _betterAuthUrl,
    VIEWER_ORIGIN: _viewerOrigin,
    WEB_CANONICAL_HOST: _webCanonicalHost,
    WEB_ORIGIN: _webOrigin,
    ...processFixture
  } = testStackEnvironment;
  const minimalProcessInputs = Object.fromEntries(
    ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]
      .filter((name) => ambientEnvironment[name] !== undefined)
      .map((name) => [name, ambientEnvironment[name]]),
  );
  return {
    ...minimalProcessInputs,
    ...processFixture,
    AUTH_EMAIL_SMTP_URL: `smtp://${endpoints.smtp.host}:${endpoints.smtp.port}`,
    DATABASE_URL: `postgres://shareslices:shareslices@${endpoints.database.host}:${endpoints.database.port}/shareslices_test`,
    NODE_ENV: "test",
    S3_ENDPOINT: `http://${endpoints.objectStorage.host}:${endpoints.objectStorage.port}`,
    S3_FORCE_PATH_STYLE: "true",
    UV_CACHE_DIR: join(testRoot, "uv-cache"),
  };
}

export function combineErrors(primaryError, cleanupError) {
  if (primaryError && cleanupError) {
    return new AggregateError([primaryError, cleanupError], "API tests and isolated cleanup failed");
  }
  return primaryError ?? cleanupError;
}

export async function runApiTests() {
  const testRoot = mkdtempSync(join(tmpdir(), "shareslices-api-tests-"));
  const dockerConfig = join(testRoot, "docker-config");
  const runtimeEnvironmentFile = join(testRoot, "runtime.env");
  const ownershipEnvironmentFile = join(testRoot, "ownership.env");
  mkdirSync(dockerConfig, { mode: 0o700 });
  prepareIsolatedDockerConfig(dockerConfig, resolveDockerPlugins());
  const dockerEnv = dockerChildEnvironment({
    dockerConfig,
    dockerHost: resolveLocalDockerHost(),
  });
  const dockerSnapshot = Object.freeze({
    connectionArgs: Object.freeze(["--host", resolveLocalDockerHost()]),
    dockerConfig,
    host: resolveLocalDockerHost(),
  });
  let interruptedSignal;
  const recordSigint = () => {
    interruptedSignal ??= "SIGINT";
  };
  const recordSigterm = () => {
    interruptedSignal ??= "SIGTERM";
  };
  process.on("SIGINT", recordSigint);
  process.on("SIGTERM", recordSigterm);

  let primaryError;
  let cleanupError;
  try {
    verifyComposeCapabilities({
      connectionArgs: dockerSnapshot.connectionArgs,
      composeArgs: testComposeArgs,
      environment: dockerEnv,
    });
    loadAndValidateTestComposeModel({
      connectionArgs: dockerSnapshot.connectionArgs,
      composeArgs: testComposeArgs,
      environment: dockerEnv,
      executeCommand: executeDockerModel,
    });
    withDockerMutationController(dockerSnapshot, "shareslices-test", ({ engineId, runMutation }) => {
      const mutateDocker = (args) => runMutation(
        "docker",
        [...dockerSnapshot.connectionArgs, ...args],
        { cwd: repositoryRoot, env: dockerEnv, stdio: "inherit" },
      );
      const ownership = createTestOwnership({
        repositoryRoot,
        endpoint: dockerSnapshot.host,
        engineId,
      });
      writeFileSync(ownershipEnvironmentFile, ownershipEnvironmentContents(ownership), {
        mode: 0o600,
      });
      const ownedComposeArgs = testComposeArgsWithOwnership(ownershipEnvironmentFile);
      const cleanup = cleanupCommand(ownedComposeArgs);
      try {
        recoverOwnedTestProject({
          connectionArgs: dockerSnapshot.connectionArgs,
          environment: dockerEnv,
          executeCommand(command, args, options) {
            if (command !== "docker") throw new Error(`Unexpected recovery command ${command}`);
            return executeDockerModel(args, options);
          },
          ownership,
          cleanup: () => mutateDocker(cleanup[1]),
        });
        const [command, baseArgs] = commandsForApiTests()[0];
        const args = [...ownedComposeArgs, ...baseArgs.slice(testComposeArgs.length)];
        {
          if (command === "docker") mutateDocker(args);
          else run(command, args, dockerEnv);
          if (interruptedSignal) throw new Error(`API tests interrupted by ${interruptedSignal}`);
        }
        const endpointRecords = inspectComposeServices({
          connectionArgs: dockerSnapshot.connectionArgs,
          composeArgs: ownedComposeArgs,
          environment: dockerEnv,
          executeCommand: executeDockerModel,
        });
        const endpoints = freezeTestEndpoints(endpointRecords);
        writeFileSync(runtimeEnvironmentFile, runtimeEnvironmentContents(endpoints), {
          mode: 0o600,
        });
        const runtimeComposeArgs = testComposeArgsWithRuntime(
          ownershipEnvironmentFile,
          runtimeEnvironmentFile,
        );
        loadAndValidateTestComposeModel({
          connectionArgs: dockerSnapshot.connectionArgs,
          composeArgs: runtimeComposeArgs,
          environment: dockerEnv,
          executeCommand: executeDockerModel,
        });
        const processEnv = processChildEnvironment(testRoot, endpoints);
        const migrationEnv = {
          ...processEnv,
          API_ORIGIN: endpoints.apiOrigin,
          BETTER_AUTH_URL: endpoints.webOrigin,
          VIEWER_ORIGIN: endpoints.webOrigin,
          WEB_ORIGIN: endpoints.webOrigin,
        };
        const contractProcessEnv = {
          ...processEnv,
          SHARESLICES_ARTIFACT_FLOW_URL: endpoints.apiTestOrigin,
          SHARESLICES_TEST_DATABASE_URL: processEnv.DATABASE_URL,
          SHARESLICES_TEST_MAILPIT_URL: `http://${endpoints.mailpit.host}:${endpoints.mailpit.port}`,
          SHARESLICES_TEST_S3_ENDPOINT: processEnv.S3_ENDPOINT,
          SHARESLICES_TEST_SMTP_URL: processEnv.AUTH_EMAIL_SMTP_URL,
          SHARESLICES_TEST_WEB_ORIGIN: endpoints.webOrigin,
        };
        for (const [command, baseArgs] of commandsForApiTests().slice(1)) {
          const args = command === "docker"
            ? [...ownedComposeArgs, ...baseArgs.slice(testComposeArgs.length)]
            : baseArgs;
          if (command === "docker") mutateDocker(args);
          else run(command, args, dockerEnv);
          if (interruptedSignal) throw new Error(`API tests interrupted by ${interruptedSignal}`);
        }
        run(
          "node",
          ["api/node_modules/tsx/dist/cli.mjs", "api/src/db/migrate.ts"],
          migrationEnv,
        );
        mutateDocker([
          ...runtimeComposeArgs,
          "exec", "-T", "postgres", "psql", "-U", "shareslices", "-d", "shareslices_test",
          "-c",
          "delete from authentication_email_delivery; delete from password_reset_grant; delete from email_verification_attempt; update authentication_email_circuit_breaker set state = 'closed', reason_code = null, opened_at = null, resume_at = null;",
        ]);
        run("pnpm", ["--dir", "api", "run", "test"], processEnv);
        run(
          "uv",
          ["run", "pytest", "api/tests/test_account_entry_contract.py"],
          contractProcessEnv,
        );
        mutateDocker([
          ...runtimeComposeArgs,
          "up", "-d", "--build", "--wait", "--wait-timeout",
          String(composeFeatureBaseline.waitTimeoutSeconds),
          "api", "maintenance", "worker", "web",
        ]);
        const phaseTwoRecords = inspectComposeServices({
          connectionArgs: dockerSnapshot.connectionArgs,
          composeArgs: runtimeComposeArgs,
          environment: dockerEnv,
          executeCommand: executeDockerModel,
        });
        assertEndpointLayerUnchanged(endpointRecords, phaseTwoRecords);
        run(
          "uv",
          ["run", "pytest", "api/tests/artifact_flow_contract.py"],
          contractProcessEnv,
        );
      } catch (error) {
        primaryError = error;
      } finally {
        try {
          mutateDocker(cleanup[1]);
        } catch (error) {
          cleanupError = error;
        }
      }
    }, { cwd: repositoryRoot, env: dockerEnv });
  } catch (error) {
    primaryError ??= error;
  } finally {
    process.off("SIGINT", recordSigint);
    process.off("SIGTERM", recordSigterm);
    rmSync(testRoot, { recursive: true, force: true });
  }

  const error = combineErrors(primaryError, cleanupError);
  if (error) throw error;
}

export function runApiTestsCli() {
  return runApiTests().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runApiTestsCli();
