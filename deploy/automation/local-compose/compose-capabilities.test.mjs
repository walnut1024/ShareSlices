import assert from "node:assert/strict";
import test from "node:test";

import {
  assertResidentServicesReady,
  composeFeatureBaseline,
  parseComposePsJson,
  verifyComposeCapabilities,
} from "./compose-capabilities.mjs";

test("records a bounded capability-based Compose baseline", () => {
  assert.equal(composeFeatureBaseline.schemaVersion, 1);
  assert.equal(composeFeatureBaseline.waitTimeoutSeconds, 120);
  assert.deepEqual(composeFeatureBaseline.upOptions, ["--wait", "--wait-timeout"]);
  assert.deepEqual(
    composeFeatureBaseline.dependencyConditions,
    ["service_healthy", "service_completed_successfully"],
  );
});

test("checks required features and the selected model before mutation", () => {
  const calls = [];
  const result = verifyComposeCapabilities({
    connectionArgs: ["--host", "unix:///docker.sock"],
    composeArgs: ["compose", "-p", "shareslices", "-f", "compose.yaml"],
    environment: { PATH: "/bin" },
    executeCommand(args) {
      calls.push(args);
      if (args.includes("version")) return "5.1.2";
      if (args.includes("--help") && args.includes("up")) return "--wait\n--wait-timeout int";
      if (args.includes("--help") && args.includes("ps")) return "--format string";
      if (args.includes("--format")) return '{"Service":"api","State":"running","Health":"healthy"}';
      return "";
    },
  });
  assert.equal(result.version, "5.1.2");
  assert.equal(calls.some((args) => args.at(-2) === "config" && args.at(-1) === "--quiet"), true);
  assert.equal(calls.some((args) => args.includes("up") && !args.includes("--help")), false);
});

test("fails capability checks before any model command when a required option is absent", () => {
  const calls = [];
  assert.throws(
    () => verifyComposeCapabilities({
      connectionArgs: [],
      composeArgs: ["compose", "-p", "shareslices"],
      executeCommand(args) {
        calls.push(args);
        if (args.includes("version")) return "2.0.0";
        if (args.includes("up")) return "--wait";
        return "";
      },
    }),
    /required option --wait-timeout/,
  );
  assert.equal(calls.some((args) => args.includes("config")), false);
});

test("parses array and newline-delimited Compose ps JSON", () => {
  assert.equal(parseComposePsJson('[{"Service":"api"}]').length, 1);
  assert.equal(
    parseComposePsJson('{"Service":"api"}\n{"Service":"worker"}').at(1).Service,
    "worker",
  );
});

test("requires every resident service to be running and healthy when health is reported", () => {
  assert.doesNotThrow(() => assertResidentServicesReady([
    { Service: "api", State: "running", Health: "healthy" },
    { Service: "worker", State: "running", Health: "" },
  ], ["api", "worker"]));
  assert.throws(
    () => assertResidentServicesReady(
      [{ Service: "api", State: "running", Health: "starting" }],
      ["api", "worker"],
    ),
    /health is starting/,
  );
});
