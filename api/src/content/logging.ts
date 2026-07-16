import type { MiddlewareHandler } from "hono";
import { createLogRecord } from "../logging/log-record.js";
import { httpRouteTemplate } from "../logging/http-route-template.js";

export const contentAccessLog: MiddlewareHandler = async (c, next) => {
  await next();
  const record = createLogRecord({
    severity: c.res.status >= 500 ? "WARN" : "INFO",
    body: "Gallery content request completed.",
    eventName: "shareslices.gallery_content.http.completed",
    attributes: {
      "http.request.method": c.req.method,
      "http.route": httpRouteTemplate(new URL(c.req.url).pathname),
      "http.response.status_code": c.res.status
    }
  }, {
    serviceName: "shareslices-gallery-content",
    serviceVersion: "0.0.1",
    deploymentEnvironment: process.env.NODE_ENV ?? "development"
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
};
