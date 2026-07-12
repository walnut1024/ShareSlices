import { serve } from "@hono/node-server";
import { startAuthenticationEmailDispatcher } from "./application/accounts/authentication-email-dispatcher.js";
import { startReconciliationDispatcher } from "./runtime/reconciliation-dispatcher.js";
import { env } from "./env.js";
import { buildApp } from "./http/app.js";
import { apiLogger } from "./logging/index.js";

const app = buildApp();
startAuthenticationEmailDispatcher();
startReconciliationDispatcher();

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    apiLogger.emit({
      severity: "INFO",
      body: "API listening.",
      eventName: "shareslices.api.server.listening",
      attributes: {
        "server.address": "127.0.0.1",
        "server.port": info.port
      }
    });
  }
);
