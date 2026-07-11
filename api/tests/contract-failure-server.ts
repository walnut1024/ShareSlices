import { serve } from "@hono/node-server";
import { buildApp } from "../src/http/app.js";

const dependencyFailure = () => Promise.reject(new Error("contract fixture dependency failure"));

const app = buildApp({
  account: {
    authApi: {
      signUpEmail: dependencyFailure,
      signInEmail: dependencyFailure,
      getSession: ({ headers }: { headers: Headers }) =>
        headers.get("x-contract-fixture") === "sign-out-revoke-failure"
          ? Promise.resolve({
              session: { token: "contract-fixture-session-token" },
              user: { id: "contract-fixture-user", name: "Failure Fixture", email: "failure@example.com" }
            })
          : dependencyFailure(),
      revokeSession: dependencyFailure,
      signOut: dependencyFailure
    } as never,
    userExistsByEmail: dependencyFailure,
    userExistsById: dependencyFailure
  },
  system: {
    checkDatabase: dependencyFailure
  }
});

serve({
  fetch: app.fetch,
  port: 7457
});
