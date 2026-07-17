import assert from "node:assert/strict";
import test from "node:test";

import { commandsForApiTests, testStackEnvironment } from "./run-api-tests.mjs";

test("API contracts use a dedicated Compose project and non-development ports", () => {
  assert.equal(testStackEnvironment.COMPOSE_PROJECT_NAME, "shareslices-test");
  assert.notEqual(testStackEnvironment.POSTGRES_PORT, "5432");
  assert.notEqual(testStackEnvironment.API_PORT, "7456");
  assert.notEqual(testStackEnvironment.WEB_PORT, "5173");
});

test("API contracts clean only their dedicated project before provisioning", () => {
  assert.deepEqual(commandsForApiTests()[0], [
    "docker", ["compose", "down", "--volumes", "--remove-orphans"],
  ]);
});
