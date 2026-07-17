import assert from "node:assert/strict";
import test from "node:test";

import { commandFor, localEndpoints } from "./local-stack.mjs";

test("reports stable trusted and isolated local origins", () => {
  assert.equal(new URL(localEndpoints.web).host, "app.localhost:5173");
  assert.equal(new URL(localEndpoints.api).host, "app.localhost:5173");
  assert.equal(new URL(localEndpoints.content).host, "content.localhost:7460");
});

test("up always uses the canonical Gallery-enabled Compose stack", () => {
  assert.deepEqual(commandFor("up"), [
    "compose", "-f", "compose.yaml", "-f", "compose.gallery-local.yaml",
    "up", "-d", "--build", "--force-recreate", "--wait",
  ]);
});

test("down targets the same canonical Compose stack", () => {
  assert.deepEqual(commandFor("down"), [
    "compose", "-f", "compose.yaml", "-f", "compose.gallery-local.yaml", "down",
  ]);
});

test("logs passes service filters after follow", () => {
  assert.deepEqual(commandFor("logs", ["api", "worker"]), [
    "compose", "-f", "compose.yaml", "-f", "compose.gallery-local.yaml",
    "logs", "--follow", "api", "worker",
  ]);
});

test("unknown actions fail instead of targeting an implicit stack", () => {
  assert.throws(() => commandFor("bootstrap"), /Unknown local stack action/);
});
