import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  dockerEnvironment,
  rejectConflictingDockerControls,
  resolveDockerSnapshot,
  runPinnedReadOnly,
  withDockerMutationController,
} from "./docker-controller.mjs";

test("resolves a context once into an explicit immutable endpoint snapshot", () => {
  const calls = [];
  const snapshot = resolveDockerSnapshot({
    environment: { HOME: "/tmp/home", PATH: "/bin" },
    workingDirectory: "/tmp/work",
    executeCommand(command, args) {
      calls.push([command, args]);
      if (args[0] === "context" && args[1] === "show") return "local";
      return JSON.stringify({
        Endpoints: { docker: { Host: "unix:///tmp/docker.sock", SkipTLSVerify: false } },
        Storage: { TLSPath: "/tmp/no-tls-needed-for-unix" },
      });
    },
  });
  assert.deepEqual(calls, [
    ["docker", ["context", "show"]],
    ["docker", ["context", "inspect", "local", "--format", "{{json .}}"]],
  ]);
  assert.deepEqual(snapshot.connectionArgs, ["--host", "unix:///tmp/docker.sock"]);
  assert.equal(snapshot.dockerConfig, "/tmp/home/.docker");
  assert.equal(Object.isFrozen(snapshot), true);
});

test("rejects conflicting or incomplete caller connection controls", () => {
  assert.throws(
    () => rejectConflictingDockerControls({ DOCKER_CONTEXT: "a", DOCKER_HOST: "unix:///b" }),
    /cannot both select/,
  );
  assert.throws(
    () => rejectConflictingDockerControls({ DOCKER_TLS_VERIFY: "1" }),
    /require an explicit DOCKER_HOST/,
  );
});

test("freezes explicit TLS paths and resolves client configuration before later operations", () => {
  const root = mkdtempSync(join(tmpdir(), "shareslices-docker-tls-test-"));
  const certificates = join(root, "certificates");
  mkdirSync(certificates);
  for (const name of ["ca.pem", "cert.pem", "key.pem"]) writeFileSync(join(certificates, name), name);
  try {
    const snapshot = resolveDockerSnapshot({
      environment: {
        DOCKER_CERT_PATH: "certificates",
        DOCKER_CONFIG: "client-config",
        DOCKER_HOST: "tcp://docker.example.test:2376",
        DOCKER_TLS_VERIFY: "1",
        PATH: "/bin",
      },
      workingDirectory: root,
    });
    assert.equal(snapshot.dockerConfig, join(root, "client-config"));
    assert.deepEqual(snapshot.connectionArgs, [
      "--host", "tcp://docker.example.test:2376",
      "--tlsverify",
      "--tlscacert", join(certificates, "ca.pem"),
      "--tlscert", join(certificates, "cert.pem"),
      "--tlskey", join(certificates, "key.pem"),
    ]);
    assert.equal(Object.isFrozen(snapshot.connectionArgs), true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("Docker children receive the frozen client configuration without mutable aliases", () => {
  const environment = dockerEnvironment(
    { dockerConfig: "/tmp/frozen-config" },
    { PATH: "/usr/bin", DOCKER_CONTEXT: "mutable", DOCKER_HOST: "tcp://mutable" },
  );
  assert.deepEqual(environment, { DOCKER_CONFIG: "/tmp/frozen-config", PATH: "/usr/bin" });
});

test("mutations are bracketed by the observed Engine identity", () => {
  const calls = [];
  const snapshot = { connectionArgs: ["--host", "unix:///tmp/docker.sock"], host: "unix:///tmp/docker.sock" };
  withDockerMutationController(snapshot, `test-${process.pid}-${Date.now()}`, ({ runMutation }) => {
    runMutation("docker", ["compose", "up"]);
  }, {
    executeCommand(command, args) {
      calls.push([command, args]);
      return args.includes("info") ? JSON.stringify("engine-a") : "";
    },
  });
  assert.deepEqual(calls.map(([, args]) => args.includes("info") ? "identity" : "mutation"), [
    "identity",
    "identity",
    "identity",
    "mutation",
    "identity",
    "identity",
  ]);
});

test("Engine identity changes make mutation and read-only results indeterminate", () => {
  const snapshot = { connectionArgs: ["--host", "unix:///tmp/docker.sock"], host: "unix:///tmp/docker.sock" };
  let observations = 0;
  assert.throws(
    () => withDockerMutationController(snapshot, `change-${process.pid}-${Date.now()}`, ({ runMutation }) => {
      runMutation("docker", ["compose", "up"]);
    }, {
      executeCommand(_command, args) {
        if (!args.includes("info")) return "";
        observations += 1;
        return JSON.stringify(observations < 3 ? "engine-a" : "engine-b");
      },
    }),
    /identity changed.*indeterminate/,
  );

  observations = 0;
  assert.throws(
    () => runPinnedReadOnly(snapshot, "docker", ["compose", "ps"], {
      executeCommand(_command, args) {
        if (!args.includes("info")) return "result";
        observations += 1;
        return JSON.stringify(observations === 1 ? "engine-a" : "engine-b");
      },
    }),
    /read-only operation.*indeterminate/,
  );
});

test("Engine reset before, during, and after mutation always fails closed", () => {
  const snapshot = { connectionArgs: ["--host", "unix:///tmp/docker.sock"], host: "unix:///tmp/docker.sock" };
  for (const [name, resetAt, expectedMutations] of [
    ["before", 2, 0],
    ["during", 4, 1],
    ["after", 5, 1],
  ]) {
    let observations = 0;
    let mutations = 0;
    assert.throws(
      () => withDockerMutationController(
        snapshot,
        `reset-${name}-${process.pid}-${Date.now()}`,
        ({ runMutation }) => runMutation("docker", ["compose", "up"]),
        {
          executeCommand(_command, args) {
            if (!args.includes("info")) {
              mutations += 1;
              return "";
            }
            observations += 1;
            return JSON.stringify(observations < resetAt ? "engine-a" : "engine-b");
          },
        },
      ),
      /identity changed.*indeterminate/,
      name,
    );
    assert.equal(mutations, expectedMutations, name);
  }
});

test("a replacement Engine can acquire fresh locks only after stale-controller failure releases them", () => {
  const root = mkdtempSync(join(tmpdir(), "shareslices-replacement-engine-test-"));
  const snapshot = { connectionArgs: ["--host", "unix:///tmp/docker.sock"], host: "unix:///tmp/docker.sock" };
  const project = `replacement-${process.pid}-${Date.now()}`;
  let observations = 0;
  assert.throws(
    () => withDockerMutationController(snapshot, project, () => {}, {
      lockRoot: root,
      executeCommand() {
        observations += 1;
        return JSON.stringify(observations === 1 ? "engine-a" : "engine-b");
      },
    }),
    /identity changed.*indeterminate/,
  );
  assert.deepEqual(readdirSync(root), []);

  let mutated = false;
  withDockerMutationController(snapshot, project, ({ runMutation }) => {
    runMutation("docker", ["compose", "up"]);
    mutated = true;
  }, {
    lockRoot: root,
    executeCommand(_command, args) {
      return args.includes("info") ? JSON.stringify("engine-b") : "";
    },
  });
  assert.equal(mutated, true);
  assert.deepEqual(readdirSync(root), []);
  rmSync(root, { recursive: true });
});

test("endpoint aliases coalesce on the Engine/project lock and a second controller fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "shareslices-engine-alias-test-"));
  const project = `alias-${process.pid}-${Date.now()}`;
  const engine = () => JSON.stringify("engine-a");
  try {
    withDockerMutationController(
      { connectionArgs: ["--host", "unix:///tmp/alias-a.sock"], host: "unix:///tmp/alias-a.sock" },
      project,
      () => {
        assert.throws(
          () => withDockerMutationController(
            { connectionArgs: ["--host", "unix:///tmp/alias-b.sock"], host: "unix:///tmp/alias-b.sock" },
            project,
            () => {},
            { executeCommand: engine, lockRoot: root, timeoutMs: 0 },
          ),
          new RegExp(`Timed out waiting for engine/${project} Docker lock`),
        );
      },
      { executeCommand: engine, lockRoot: root },
    );
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("a dead owner cannot permanently block endpoint or Engine mutations", () => {
  const root = mkdtempSync(join(tmpdir(), "shareslices-stale-lock-test-"));
  const project = `stale-${process.pid}-${Date.now()}`;
  const host = "unix:///tmp/docker.sock";
  const engineId = "engine-a";
  for (const [kind, identity] of [["endpoint", host], ["engine", engineId]]) {
    const name = createHash("sha256")
      .update(`${kind}\0${identity}\0${project}`)
      .digest("hex");
    const path = join(root, name);
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(path, "owner.json"), `${JSON.stringify({ pid: 999_999_999, project })}\n`);
  }

  let mutated = false;
  withDockerMutationController(
    { connectionArgs: ["--host", host], host },
    project,
    ({ runMutation }) => {
      runMutation("docker", ["compose", "up"]);
      mutated = true;
    },
    {
      lockRoot: root,
      isProcessAlive: () => false,
      executeCommand(_command, args) {
        return args.includes("info") ? JSON.stringify(engineId) : "";
      },
    },
  );
  assert.equal(mutated, true);
  assert.deepEqual(readdirSync(root), []);
  rmSync(root, { recursive: true });
});
