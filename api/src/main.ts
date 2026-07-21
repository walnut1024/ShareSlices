import { serve } from "@hono/node-server";
import { readApiHttpEnv } from "./env.js";
import { buildApp } from "./http/app.js";
import { createNodeTrustedIngressResolver } from "./http/node-trusted-ingress.js";
import { apiLogger } from "./logging/index.js";

const env = readApiHttpEnv();
const app = buildApp({}, {
  trustedIngress: createNodeTrustedIngressResolver(env.TRUSTED_PROXY_CIDRS),
});

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
