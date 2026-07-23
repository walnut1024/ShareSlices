import assert from "node:assert/strict";
import test from "node:test";

import { main } from "./authentication-email-reconcile.mjs";

test("keeps account maintenance outside deployment lifecycle invocation", () => {
  assert.throws(
    () => main([]),
    /usage: mise run ops-authentication-email-reconcile/,
  );
});
