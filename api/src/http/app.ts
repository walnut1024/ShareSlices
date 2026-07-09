import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../env.js";
import { accountRoutes, type AccountRouteDependencies } from "./account-routes.js";
import { errorJson, requestId } from "./http-error.js";
import { systemRoutes, type SystemRouteDependencies } from "./system-routes.js";

export type AppDependencies = {
  account?: Partial<AccountRouteDependencies>;
  system?: Partial<SystemRouteDependencies>;
};

export function buildApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    const id = requestId(c);
    console.error(
      JSON.stringify({
        level: "error",
        event: "http_request_failed",
        service: "shareslices-api",
        requestId: id,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        errorName: error.name
      })
    );
    return errorJson(c, 500, "internal_error");
  });

  app.use(
    "*",
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      allowMethods: ["GET", "POST", "OPTIONS"]
    })
  );

  app.route("/", systemRoutes(dependencies.system));
  app.route("/", accountRoutes(dependencies.account));

  return app;
}
