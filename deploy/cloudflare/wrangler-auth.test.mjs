import assert from "node:assert/strict";
import test from "node:test";

import {createWranglerApiCredentialScope} from "./wrangler-auth.mjs";

test("scopes a Wrangler OAuth or API Token to one callback", async () => {
  const calls = [];
  const withCredential = createWranglerApiCredentialScope({
    runCommand: (_executable, arguments_) => {
      calls.push(arguments_);
      return {
        status: 0,
        stdout: `wrangler warning\n${JSON.stringify({
          type: "oauth",
          token: "temporary-oauth-token",
        })}`,
        stderr: "",
      };
    },
  });
  assert.equal(
    await withCredential(async (token) => token === "temporary-oauth-token"),
    true,
  );
  assert.deepEqual(calls, [["auth", "token", "--json"]]);
});

test("rejects Global API keys and redacts a credential-bearing failure", async () => {
  const globalKey = createWranglerApiCredentialScope({
    runCommand: () => ({
      status: 0,
      stdout: JSON.stringify({
        type: "api_key",
        key: "global-key",
        email: "operator@example.test",
      }),
      stderr: "",
    }),
  });
  await assert.rejects(globalKey(async () => true), /credential_unavailable/);

  const withCredential = createWranglerApiCredentialScope({
    runCommand: () => ({
      status: 0,
      stdout: JSON.stringify({
        type: "api_token",
        token: "sensitive-provider-token",
      }),
      stderr: "",
    }),
  });
  await assert.rejects(
    withCredential(async (token) => {
      throw new Error(`provider rejected ${token}`);
    }),
    (error) => (
      error.message === "cloudflare_wrangler_scoped_operation_failed" &&
      !error.message.includes("sensitive-provider-token") &&
      !error.stack.includes("sensitive-provider-token")
    ),
  );
});
