import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commandsForApiTests,
  dockerChildEnvironment,
  prepareIsolatedDockerConfig,
  processChildEnvironment,
  repositoryRoot,
  testComposeArgs,
  testEnvironmentFile,
  testStackEnvironment,
} from "./api-tests.mjs";

test("API contracts use a dedicated Compose project and non-development ports", () => {
  assert.deepEqual(testComposeArgs.slice(testComposeArgs.indexOf("-p"), testComposeArgs.indexOf("-p") + 2), [
    "-p",
    "shareslices-test",
  ]);
  assert.notEqual(testStackEnvironment.POSTGRES_PORT, "5432");
  assert.notEqual(testStackEnvironment.API_PORT, "7456");
  assert.notEqual(testStackEnvironment.WEB_PORT, "5173");
});

test("API contracts clean only their dedicated project before provisioning", () => {
  assert.deepEqual(commandsForApiTests()[0], [
    "docker", [...testComposeArgs, "down", "--volumes", "--remove-orphans"],
  ]);
});

test("every test Compose invocation uses the fixed project, files, project directory, and env fixture", () => {
  for (const [command, args] of commandsForApiTests()) {
    assert.equal(command, "docker");
    assert.deepEqual(args.slice(0, testComposeArgs.length), testComposeArgs);
  }
  assert.deepEqual(testComposeArgs, [
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
  ]);
  assert.equal(testComposeArgs.includes(".env"), false);
});

test("Docker children inherit only the isolated config and executable path because the endpoint is an explicit argument", () => {
  const environment = dockerChildEnvironment({
    dockerConfig: "/tmp/isolated-docker-config",
    dockerHost: "unix:///var/run/docker.sock",
  });
  assert.deepEqual(Object.keys(environment).sort(), ["DOCKER_CONFIG", "PATH"]);
  assert.equal(environment.DOCKER_HOST, undefined);
  assert.equal(environment.DOCKER_CONFIG, "/tmp/isolated-docker-config");
  for (const forbidden of [
    "CI",
    "CLOUDFLARE_API_TOKEN",
    "COMPOSE_FILE",
    "COMPOSE_PROJECT_NAME",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "RESEND_API_KEY",
  ]) {
    assert.equal(Object.hasOwn(environment, forbidden), false, forbidden);
  }
});

test("test processes exclude caller application, provider, CI, and agent variables", () => {
  const environment = processChildEnvironment("/tmp/shareslices-test-root", {
    HOME: "/tmp/test-home",
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
    CI: "true",
    CLOUDFLARE_API_TOKEN: "caller-provider-secret",
    COMPOSE_FILE: "caller-compose.yaml",
    DATABASE_URL: "postgres://caller-secret",
    RESEND_API_KEY: "caller-resend-secret",
    CODEX_THREAD_ID: "caller-agent-state",
  });

  assert.equal(environment.HOME, "/tmp/test-home");
  assert.equal(environment.DATABASE_URL, testStackEnvironment.SHARESLICES_TEST_DATABASE_URL);
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.COMPOSE_FILE, undefined);
  assert.equal(environment.RESEND_API_KEY, undefined);
  assert.equal(environment.CI, undefined);
  assert.equal(environment.CODEX_THREAD_ID, undefined);
});

test("checked test fixture freezes expected endpoints without caller Compose controls", () => {
  assert.equal(testStackEnvironment.POSTGRES_PORT, "55432");
  assert.equal(testStackEnvironment.API_PORT, "57456");
  assert.equal(testStackEnvironment.WEB_PORT, "55173");
  for (const forbidden of ["COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "DOCKER_HOST"]) {
    assert.equal(Object.hasOwn(testStackEnvironment, forbidden), false, forbidden);
  }
});

test("isolated Docker configuration carries only an empty config and required executables", () => {
  const root = mkdtempSync(join(tmpdir(), "shareslices-docker-config-test-"));
  const dockerConfig = join(root, "docker-config");
  const plugins = {
    buildx: join(root, "docker-buildx"),
    compose: join(root, "docker-compose"),
  };
  mkdirSync(dockerConfig);
  for (const plugin of Object.values(plugins)) writeFileSync(plugin, "test executable");
  try {
    prepareIsolatedDockerConfig(dockerConfig, plugins);
    assert.equal(readFileSync(join(dockerConfig, "config.json"), "utf8"), "{}\n");
    for (const [pluginName, pluginPath] of Object.entries(plugins)) {
      assert.equal(
        readlinkSync(join(dockerConfig, `cli-plugins/docker-${pluginName}`)),
        pluginPath,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
