import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { buildApp } from "./http/app.js";
import { apiLogger } from "./logging/index.js";

const app = buildApp();

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
