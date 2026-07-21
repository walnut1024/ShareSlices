import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOwnedTestResources,
  createTestOwnership,
  ownershipEnvironmentContents,
  ownershipLabels,
  recoverOwnedTestProject,
} from "./test-ownership.mjs";

const ownership = Object.freeze({
  repository: "repository-id",
  topology: "topology-id",
  endpoint: "endpoint-id",
  engine: "engine-id",
  project: "shareslices-test",
});

function resource(kind, name, labels = ownershipLabels(ownership)) {
  return { kind, name, labels };
}

test("creates stable ownership from repository, topology, endpoint, Engine, and project", () => {
  const first = createTestOwnership({
    repositoryRoot: new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""),
    endpoint: "unix:///var/run/docker.sock",
    engineId: "engine-a",
  });
  const second = createTestOwnership({
    repositoryRoot: new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""),
    endpoint: "unix:///var/run/docker.sock",
    engineId: "engine-a",
  });
  assert.deepEqual(first, second);
  assert.match(ownershipEnvironmentContents(first), /SHARESLICES_TEST_ENGINE_ID=[a-f0-9]{64}/);
});

test("accepts only resources carrying every exact ownership marker", () => {
  assert.doesNotThrow(() => assertOwnedTestResources([
    resource("container", "api"),
    resource("network", "default"),
    resource("volume", "postgres"),
  ], ownership));

  const missing = { ...ownershipLabels(ownership) };
  delete missing["com.shareslices.test.engine"];
  assert.throws(
    () => assertOwnedTestResources([resource("container", "api", missing)], ownership),
    /missing ownership marker.*engine/,
  );

  const mismatched = {
    ...ownershipLabels(ownership),
    "com.shareslices.test.topology": "other",
  };
  assert.throws(
    () => assertOwnedTestResources([resource("volume", "postgres", mismatched)], ownership),
    /mismatched ownership marker.*topology/,
  );
});

test("cleans only positively owned stale resources and verifies their removal", () => {
  let inspection = 0;
  let cleanupCount = 0;
  const executeCommand = (_command, args) => {
    if (args.includes("inspect")) {
      return JSON.stringify([{
        Name: "/stale-api",
        Config: { Labels: ownershipLabels(ownership) },
      }]);
    }
    inspection += 1;
    return inspection === 1 ? "container-id" : "";
  };
  assert.equal(recoverOwnedTestProject({
    connectionArgs: ["--host", "unix:///var/run/docker.sock"],
    environment: {},
    executeCommand,
    ownership,
    cleanup: () => { cleanupCount += 1; },
  }), true);
  assert.equal(cleanupCount, 1);
});

test("does not run cleanup when no stale project exists", () => {
  let cleaned = false;
  const recovered = recoverOwnedTestProject({
    connectionArgs: [],
    environment: {},
    executeCommand: () => "",
    ownership,
    cleanup: () => { cleaned = true; },
  });
  assert.equal(recovered, false);
  assert.equal(cleaned, false);
});

test("fails closed without cleanup when a stale resource ownership marker mismatches", () => {
  let cleanupCount = 0;
  const mismatchedLabels = {
    ...ownershipLabels(ownership),
    "com.shareslices.test.endpoint": "another-endpoint",
  };
  const executeCommand = (_command, args) => {
    if (args.includes("inspect")) {
      return JSON.stringify([{
        Name: "/foreign-api",
        Config: { Labels: mismatchedLabels },
      }]);
    }
    return "container-id";
  };

  assert.throws(
    () => recoverOwnedTestProject({
      connectionArgs: ["--host", "unix:///var/run/docker.sock"],
      environment: {},
      executeCommand,
      ownership,
      cleanup: () => { cleanupCount += 1; },
    }),
    /foreign-api.*mismatched ownership marker.*endpoint/,
  );
  assert.equal(cleanupCount, 0);
});

test("reports the exact resources left after owned stale cleanup", () => {
  let inspection = 0;
  const executeCommand = (_command, args) => {
    if (args.includes("inspect")) {
      const identifier = args.at(-1);
      if (identifier === "container-id") {
        return JSON.stringify([{
          Name: "/stale-api",
          Config: { Labels: ownershipLabels(ownership) },
        }]);
      }
      return JSON.stringify([{
        Name: "shareslices-test_default",
        Labels: ownershipLabels(ownership),
      }]);
    }
    inspection += 1;
    if (inspection === 1) return "container-id";
    if (inspection === 5) return "network-id";
    return "";
  };

  assert.throws(
    () => recoverOwnedTestProject({
      connectionArgs: [],
      environment: {},
      executeCommand,
      ownership,
      cleanup: () => {},
    }),
    /left project resources behind: network:shareslices-test_default/,
  );
});
