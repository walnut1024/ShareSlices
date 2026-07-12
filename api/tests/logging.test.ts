import { describe, expect, it, vi } from "vitest";
import {
  createApiLogger,
  createLogRecord,
  exceptionAttributes,
  parseTraceParent,
  severityNumbers
} from "../src/logging/index.js";

describe("API structured logging", () => {
  it("builds the OpenTelemetry-compatible logical record", () => {
    const record = createLogRecord(
      {
        severity: "INFO",
        body: "API started.",
        eventName: "shareslices.api.server.listening",
        attributes: { "server.port": 7456 },
        trace: {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331"
        }
      },
      {
        serviceName: "shareslices-api",
        serviceVersion: "0.0.1",
        deploymentEnvironment: "test"
      },
      () => new Date("2026-07-10T08:00:00.000Z")
    );

    expect(record).toEqual({
      timestamp: "2026-07-10T08:00:00.000Z",
      severityText: "INFO",
      severityNumber: 9,
      body: "API started.",
      eventName: "shareslices.api.server.listening",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      resource: {
        "service.name": "shareslices-api",
        "service.version": "0.0.1",
        "deployment.environment.name": "test"
      },
      attributes: { "server.port": 7456 }
    });
    expect(severityNumbers).toEqual({ TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 });
  });

  it("parses valid W3C trace context and rejects invalid context", () => {
    expect(parseTraceParent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331"
    });
    expect(parseTraceParent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeUndefined();
    expect(parseTraceParent("not-a-trace-parent")).toBeUndefined();
  });

  it("sanitizes exception evidence and its cause chain", () => {
    const cause = new Error("GET /a/secret-share-slug/ failed for ada@example.com with token=private-token");
    const error = new Error("Authorization: Bearer abc.def.ghi; cookie=session=secret; smtp://user:pass@smtp.example.com:587", { cause });
    error.stack = "Error: Authorization: Bearer abc.def.ghi\n at /a/secret-share-slug/index.js";

    expect(exceptionAttributes(error)).toEqual({
      "exception.type": "Error",
      "exception.message": "Authorization: [REDACTED]; cookie=[REDACTED]; smtp://[REDACTED]",
      "exception.stacktrace": "Error: Authorization: [REDACTED]\n at /a/[REDACTED]/index.js",
      "exception.cause_chain": ["Error: GET /a/[REDACTED]/ failed for [REDACTED_EMAIL] with token=[REDACTED]"]
    });
  });

  it("emits exactly one JSON line to the severity-appropriate stream", () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const logger = createApiLogger({
      serviceVersion: "0.0.1",
      deploymentEnvironment: "test",
      stdout,
      stderr,
      now: () => new Date("2026-07-10T08:00:00.000Z")
    });

    logger.emit({
      severity: "WARN",
      body: "Request failed.",
      eventName: "shareslices.api.http.request_failed",
      attributes: { "shareslices.request.id": "req_1" }
    });

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
    const line = stderr.mock.calls[0]?.[0];
    expect(line).toMatch(/\n$/);
    expect(JSON.parse(line)).toMatchObject({
      severityText: "WARN",
      severityNumber: 13,
      eventName: "shareslices.api.http.request_failed",
      resource: { "service.name": "shareslices-api" },
      attributes: { "shareslices.request.id": "req_1" }
    });
  });
});
