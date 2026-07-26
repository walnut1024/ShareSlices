import assert from "node:assert/strict";
// cspell:words libexec userconfig
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  combineErrors,
  commandsForApiTests,
  cleanupCommand,
  dockerChildEnvironment,
  prepareIsolatedDockerConfig,
  processChildEnvironment,
  repositoryRoot,
  resolveDockerPlugin,
  resolveLocalDockerHost,
  testComposeArgs,
  testComposeArgsWithOwnership,
  testComposeArgsWithRuntime,
  testEnvironmentFile,
  testStackEnvironment,
  webE2eEnvironment,
} from "./api-tests.mjs";

const testEndpoints = Object.freeze({
  database: { host: "127.0.0.1", port: 49101 },
  mailpit: { host: "127.0.0.1", port: 49102 },
  objectStorage: { host: "127.0.0.1", port: 49103 },
  smtp: { host: "127.0.0.1", port: 49104 },
  webOrigin: "http://app.localhost:49105",
});

test("API contracts use a dedicated Compose project and request Engine-assigned ports", () => {
  assert.deepEqual(testComposeArgs.slice(testComposeArgs.indexOf("-p"), testComposeArgs.indexOf("-p") + 2), [
    "-p",
    "shareslices-test",
  ]);
  for (const name of [
    "POSTGRES_PORT",
    "OBJECT_STORAGE_PORT",
    "MAILPIT_HTTP_PORT",
    "SMTP_PORT",
    "API_PORT",
    "GALLERY_CONTENT_PUBLISHED_PORT",
    "WEB_PORT",
  ]) {
    assert.equal(testStackEnvironment[name], "0", name);
  }
});

test("API contracts do not clean before provisioning", () => {
  assert.equal(commandsForApiTests().some(([, args]) => args.includes("down")), false);
  assert.deepEqual(cleanupCommand(testComposeArgsWithOwnership("/tmp/ownership.env")), [
    "docker",
    [
      ...testComposeArgsWithOwnership("/tmp/ownership.env"),
      "down", "--volumes", "--remove-orphans",
    ],
  ]);
});

test("cleanup failure is reported without masking the primary failure", () => {
  const primary = new Error("primary contract failure");
  const cleanup = new Error("isolated cleanup failure");
  const combined = combineErrors(primary, cleanup);
  assert.equal(combined instanceof AggregateError, true);
  assert.deepEqual(combined.errors, [primary, cleanup]);
  assert.match(combined.message, /Tests and isolated cleanup failed/);
  assert.equal(combineErrors(primary, undefined), primary);
  assert.equal(combineErrors(undefined, cleanup), cleanup);
});

test("API infrastructure startup has a bounded Compose wait", () => {
  const startup = commandsForApiTests()[0][1];
  assert.deepEqual(
    startup.slice(startup.indexOf("--wait"), startup.indexOf("--wait") + 3),
    ["--wait", "--wait-timeout", "120"],
  );
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

test("runtime Compose arguments add only ownership and frozen endpoint fixtures", () => {
  assert.deepEqual(testComposeArgsWithRuntime("/tmp/ownership.env", "/tmp/runtime.env"), [
    "compose",
    "--project-directory",
    repositoryRoot,
    "--env-file",
    testEnvironmentFile,
    "--env-file",
    "/tmp/ownership.env",
    "--env-file",
    "/tmp/runtime.env",
    "-p",
    "shareslices-test",
    "-f",
    "deploy/compose/compose.yaml",
    "-f",
    "deploy/compose/compose.test.yaml",
  ]);
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

test("automated tests accept only an explicitly discovered local Docker socket", () => {
  assert.equal(resolveLocalDockerHost({
    candidates: ["/tmp/not-a-socket", "/tmp/local.sock"],
    isSocket: (path) => path.endsWith("local.sock"),
    resolveSocket: (path) => path,
  }), "unix:///tmp/local.sock");
  assert.equal(resolveLocalDockerHost({
    candidates: ["/var/run/docker.sock"],
    isSocket: () => true,
    resolveSocket: () => "/Users/test/.orbstack/run/docker.sock",
  }), "unix:///Users/test/.orbstack/run/docker.sock");
  assert.throws(
    () => resolveLocalDockerHost({
      candidates: ["tcp://remote.example.test:2376"],
      isSocket: () => false,
    }),
    /remote and caller-selected Docker endpoints are refused/,
  );
});

test("Docker plugin discovery supports Linux system plugin directories", () => {
  const checked = [];
  const path = resolveDockerPlugin("buildx", {
    candidates: [
      "/usr/local/lib/docker/cli-plugins",
      "/usr/libexec/docker/cli-plugins",
    ],
    assertExecutable(candidate) {
      checked.push(candidate);
      if (candidate !== "/usr/libexec/docker/cli-plugins/docker-buildx") {
        throw new Error("not executable");
      }
    },
  });

  assert.equal(path, "/usr/libexec/docker/cli-plugins/docker-buildx");
  assert.deepEqual(checked, [
    "/usr/local/lib/docker/cli-plugins/docker-buildx",
    "/usr/libexec/docker/cli-plugins/docker-buildx",
  ]);
});

test("test processes use a fixed CI mode and exclude caller application, provider, and agent variables", () => {
  const environment = processChildEnvironment("/tmp/shareslices-test-root", testEndpoints, {
    HOME: "/tmp/test-home",
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
    CI: "true",
    CLOUDFLARE_API_TOKEN: "caller-provider-secret",
    COMPOSE_FILE: "caller-compose.yaml",
    DATABASE_URL: "postgres://caller-secret",
    RESEND_API_KEY: "caller-resend-secret",
    CODEX_THREAD_ID: "caller-agent-state",
    NODE_OPTIONS: "--require=/tmp/caller-shell-override.cjs",
    npm_config_userconfig: "/tmp/caller-npmrc",
    UNRELATED_DEPLOY_SECRET: "caller-unrelated-secret",
  });

  assert.equal(environment.HOME, "/tmp/test-home");
  assert.equal(
    environment.DATABASE_URL,
    "postgres://shareslices:shareslices@127.0.0.1:49101/shareslices_test",
  );
  assert.equal(environment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(environment.COMPOSE_FILE, undefined);
  assert.equal(environment.RESEND_API_KEY, undefined);
  assert.equal(environment.CI, "true");
  assert.equal(environment.CODEX_THREAD_ID, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.npm_config_userconfig, undefined);
  assert.equal(environment.UNRELATED_DEPLOY_SECRET, undefined);
  assert.equal(environment.S3_BUCKET, "shareslices-test-artifacts");
  assert.equal(environment.AUTH_EMAIL_FROM, "ShareSlices Test <no-reply@shareslices.local>");
  assert.equal(environment.AUTH_EMAIL_SMTP_ENDPOINT_IDENTITY, "127.0.0.1:49104");
});

test("Web E2E receives only frozen isolated Web, API, and Mailpit endpoints", () => {
  const environment = webE2eEnvironment({ PATH: "/usr/bin" }, {
    ...testEndpoints,
    apiTestOrigin: "http://127.0.0.1:49106",
  });
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    SHARESLICES_API_URL: "http://127.0.0.1:49106",
    SHARESLICES_MAILPIT_URL: "http://127.0.0.1:49102",
    SHARESLICES_WEB_URL: "http://app.localhost:49105",
  });
  assert.equal(Object.values(environment).some((value) => String(value).includes(":7456")), false);
  assert.equal(Object.values(environment).some((value) => String(value).includes(":8025")), false);
});

test("checked test fixture contains no preselected endpoint", () => {
  assert.equal(testStackEnvironment.POSTGRES_PORT, "0");
  assert.equal(testStackEnvironment.API_ORIGIN, "http://app.localhost.invalid");
  assert.equal(testStackEnvironment.WEB_ORIGIN, "http://app.localhost.invalid");
  for (const name of [
    "SHARESLICES_ARTIFACT_FLOW_URL",
    "SHARESLICES_TEST_DATABASE_URL",
    "SHARESLICES_TEST_MAILPIT_URL",
    "SHARESLICES_TEST_S3_ENDPOINT",
    "SHARESLICES_TEST_SMTP_URL",
    "SHARESLICES_TEST_WEB_ORIGIN",
  ]) {
    assert.equal(testStackEnvironment[name], undefined, name);
  }
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
