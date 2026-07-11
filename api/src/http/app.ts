// cspell:ignore traceparent
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../env.js";
import { apiLogger, exceptionAttributes, parseTraceParent } from "../logging/index.js";
import { accountRoutes, type AccountRouteDependencies } from "./account-routes.js";
import {
  checkCliCompatibility,
  cliAuthRoutes,
  type CliAuthDependencies
} from "./cli-auth-routes.js";
import { artifactRoutes, type ArtifactRouteDependencies } from "./artifact-routes.js";
import { errorJson, requestId } from "./http-error.js";
import {
  publicationViewerRoutes,
  type PublicationViewerRouteDependencies
} from "./publication-viewer-routes.js";
import { systemRoutes, type SystemRouteDependencies } from "./system-routes.js";

export type AppDependencies = {
  account?: Partial<AccountRouteDependencies>;
  cliAuth?: Partial<CliAuthDependencies>;
  artifact?: Partial<ArtifactRouteDependencies>;
  publicationViewer?: Partial<PublicationViewerRouteDependencies>;
  system?: Partial<SystemRouteDependencies>;
};

export function buildApp(dependencies: AppDependencies = {}): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    const id = requestId(c);
    const trace = parseTraceParent(c.req.header("traceparent"));
    apiLogger.emit({
      severity: "ERROR",
      body: "HTTP request failed.",
      eventName: "shareslices.api.http.request_failed",
      attributes: {
        "shareslices.request.id": id,
        "http.request.method": c.req.method,
        "url.path": new URL(c.req.url).pathname,
        ...exceptionAttributes(error)
      },
      ...(trace ? { trace } : {})
    });
    return errorJson(c, 500, "internal_error");
  });

  app.use(
    "*",
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "Traceparent", "X-Request-Id"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    })
  );

  app.use("/api/*", async (c, next) => {
    if (c.req.header("authorization")?.toLowerCase().startsWith("bearer ")) {
      const incompatible = checkCliCompatibility(c, dependencies.cliAuth?.minimumCliVersion ?? env.MINIMUM_CLI_VERSION);
      if (incompatible) return incompatible;
    }
    await next();
  });

  app.route("/", systemRoutes(dependencies.system));
  app.route("/", accountRoutes(dependencies.account));
  app.route("/", cliAuthRoutes(dependencies.cliAuth));
  app.route("/", artifactRoutes(dependencies.artifact));
  app.route("/", publicationViewerRoutes(dependencies.publicationViewer));

  return app;
}
