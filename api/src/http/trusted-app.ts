// cspell:ignore traceparent
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  exceptionAttributes,
  parseTraceParent,
  type LogRecordInput,
} from "../logging/log-record.js";
import { checkCliCompatibility } from "./cli-compatibility.js";
import { errorJson, requestId } from "./http-error.js";
import { httpRouteTemplate } from "../logging/http-route-template.js";
import {
  trustedIngressMiddleware,
  type TrustedIngressResolver,
} from "./trusted-ingress.js";

export type TrustedHttpConfiguration = Readonly<{
  webOrigin: string;
  minimumCliVersion: string;
}>;

export type TrustedHttpLogger = Readonly<{
  emit(input: LogRecordInput): void;
}>;

export type TrustedHttpRoutes = Readonly<{
  system: Hono;
  account: Hono;
  cliAuth: Hono;
  artifact: Hono;
  publicationViewer: Hono;
  gallery: Hono;
}>;

export type TrustedHttpAppInput = Readonly<{
  configuration: TrustedHttpConfiguration;
  logger: TrustedHttpLogger;
  routes: TrustedHttpRoutes;
  trustedIngress: TrustedIngressResolver;
}>;

export function buildTrustedHttpApp(input: TrustedHttpAppInput): Hono {
  const app = new Hono();

  app.use("*", trustedIngressMiddleware(input.trustedIngress));

  app.use("*", async (context, next) => {
    await next();
    if (!context.res.headers.has("Cache-Control")) {
      context.header("Cache-Control", "no-store");
    }
  });

  app.onError((error, c) => {
    const id = requestId(c);
    const trace = parseTraceParent(c.req.header("traceparent"));
    input.logger.emit({
      severity: "ERROR",
      body: "HTTP request failed.",
      eventName: "shareslices.api.http.request_failed",
      attributes: {
        "shareslices.request.id": id,
        "http.request.method": c.req.method,
        "url.path": httpRouteTemplate(new URL(c.req.url).pathname),
        ...exceptionAttributes(error),
      },
      ...(trace ? { trace } : {}),
    });
    return errorJson(c, 500, "internal_error");
  });

  app.use(
    "*",
    cors({
      origin: input.configuration.webOrigin,
      credentials: true,
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "If-Match",
        "Traceparent",
        "X-Request-Id",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use("/api/*", async (c, next) => {
    if (c.req.header("authorization")?.toLowerCase().startsWith("bearer ")) {
      const incompatible = checkCliCompatibility(
        c,
        input.configuration.minimumCliVersion,
      );
      if (incompatible) return incompatible;
    }
    await next();
  });

  app.route("/", input.routes.system);
  app.route("/", input.routes.account);
  app.route("/", input.routes.cliAuth);
  app.route("/", input.routes.artifact);
  app.route("/", input.routes.publicationViewer);
  app.route("/", input.routes.gallery);

  return app;
}
