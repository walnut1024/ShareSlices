import { describe, expect, it, vi } from "vitest";
import { createWebLogger, exceptionAttributes, severityNumbers } from "./index";

describe("Web structured logging", () => {
  it("passes the shared logical record to the matching browser console level", () => {
    const browserConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const logger = createWebLogger({
      serviceVersion: "0.0.1",
      deploymentEnvironment: "test",
      console: browserConsole,
      now: () => new Date("2026-07-10T08:00:00.000Z")
    });

    logger.emit({
      severity: "ERROR",
      body: "Account request failed.",
      eventName: "shareslices.web.account.request_failed",
      attributes: { "shareslices.request.id": "req_1" },
      trace: {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331"
      }
    });

    expect(browserConsole.error).toHaveBeenCalledWith({
      timestamp: "2026-07-10T08:00:00.000Z",
      severityText: "ERROR",
      severityNumber: 17,
      body: "Account request failed.",
      eventName: "shareslices.web.account.request_failed",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      resource: {
        "service.name": "shareslices-web",
        "service.version": "0.0.1",
        "deployment.environment.name": "test"
      },
      attributes: { "shareslices.request.id": "req_1" }
    });
    expect(severityNumbers).toEqual({ TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 });
  });

  it.each([
    ["TRACE", "debug"],
    ["DEBUG", "debug"],
    ["INFO", "info"],
    ["WARN", "warn"],
    ["ERROR", "error"],
    ["FATAL", "error"]
  ] as const)("maps %s to console.%s", (severity, method) => {
    const browserConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const logger = createWebLogger({
      serviceVersion: "0.0.1",
      deploymentEnvironment: "test",
      console: browserConsole
    });

    logger.emit({ severity, body: "Diagnostic.", eventName: "shareslices.web.test.diagnostic" });

    expect(browserConsole[method]).toHaveBeenCalledOnce();
  });

  it("uses the same sanitized exception field contract", () => {
    const error = new Error("password=hunter2 at /a/shared-secret/");

    expect(exceptionAttributes(error)).toMatchObject({
      "exception.type": "Error",
      "exception.message": "password=[REDACTED] at /a/[REDACTED]/"
    });
  });
});
