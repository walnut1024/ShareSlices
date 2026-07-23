import type { MiddlewareHandler } from "hono";
import { createLogRecord } from "../logging/log-record.js";
import { httpRouteTemplate } from "../logging/http-route-template.js";

export function createContentAccessLog(input: Readonly<{
  serviceVersion: string;
  deploymentEnvironment: string;
  emit(line: string): void;
}>): MiddlewareHandler {
  return async (c, next) => {
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
      serviceVersion: input.serviceVersion,
      deploymentEnvironment: input.deploymentEnvironment
    });
    input.emit(JSON.stringify(record));
  };
}
