import { Hono } from "hono";
import { requestId } from "./http-error.js";

export type SystemRouteDependencies = {
  checkDatabase(): Promise<void>;
};

export function systemRoutes(dependencies: SystemRouteDependencies): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId(c));
    return c.json({ status: "ok", service: "shareslices-api" });
  });

  app.get("/ready", async (c) => {
    const id = requestId(c);
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", id);

    try {
      await dependencies.checkDatabase();
      return c.json({ status: "ready", checks: { database: { status: "pass" } } });
    } catch {
      return c.json(
        {
          status: "not_ready",
          checks: {
            database: {
              status: "fail",
              message: "Database is not reachable."
            }
          }
        },
        503
      );
    }
  });

  return app;
}
