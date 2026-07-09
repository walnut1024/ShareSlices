import { Hono } from "hono";
import { checkDatabase } from "../db/system-queries.js";
import { requestId } from "./http-error.js";

export type SystemRouteDependencies = {
  checkDatabase: typeof checkDatabase;
};

export function systemRoutes(overrides: Partial<SystemRouteDependencies> = {}): Hono {
  const dependencies: SystemRouteDependencies = { checkDatabase, ...overrides };
  const app = new Hono();

  app.get("/health", (c) => {
    c.header("X-Request-Id", requestId(c));
    return c.json({ status: "ok", service: "shareslices-api" });
  });

  app.get("/ready", async (c) => {
    const id = requestId(c);
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
