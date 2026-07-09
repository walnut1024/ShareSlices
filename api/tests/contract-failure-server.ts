import { serve } from "@hono/node-server";
import { buildApp } from "../src/http/app.js";

const dependencyFailure = () => Promise.reject(new Error("contract fixture dependency failure"));

const app = buildApp({
  account: {
    authApi: {
      signUpEmail: dependencyFailure,
      signInEmail: dependencyFailure,
      getSession: dependencyFailure
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
