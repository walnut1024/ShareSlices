import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { buildApp } from "./http/app.js";

const app = buildApp();

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    console.log(
      JSON.stringify({
        level: "info",
        event: "api_listening",
        service: "shareslices-api",
        host: "127.0.0.1",
        port: info.port
      })
    );
  }
);
