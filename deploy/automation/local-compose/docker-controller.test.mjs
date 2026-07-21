import assert from "node:assert/strict";
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
