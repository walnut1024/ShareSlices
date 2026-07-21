import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  createCloudflareContentEntrypoint,
  createCloudflareJobsEntrypoint,
  createCloudflareTrustedEntrypoint,
  type CloudflareExecutionContext,
  type CloudflareQueueBatch,
  type CloudflareScheduledController,
} from "../src/cloudflare/runtime.js";
import type { TrustedHttpRoutes } from "../src/http/trusted-app.js";

const executionContext: CloudflareExecutionContext = {
  props: undefined,
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

const route = (path: string, body: string): Hono => {
  const app = new Hono();
  app.get(path, (context) => context.text(body));
  return app;
};

function trustedRoutes(): TrustedHttpRoutes {
  return {
    system: route("/health", "trusted"),
    account: new Hono(),
    cliAuth: new Hono(),
    artifact: new Hono(),
    publicationViewer: new Hono(),
    gallery: new Hono(),
  };
}

describe("Cloudflare runtime entrypoints", () => {
  it("builds the trusted fetch graph from invocation bindings", async () => {
    const compose = vi.fn((bindings: { webOrigin: string }) => ({
      configuration: { webOrigin: bindings.webOrigin, minimumCliVersion: "0.1.0" },
      logger: { emit: vi.fn() },
      routes: trustedRoutes(),
      trustedIngress: () => ({ clientIp: "unknown", source: "unknown" as const }),
    }));
    const worker = createCloudflareTrustedEntrypoint(compose);

    const response = await worker.fetch(
      new Request("https://app.example.test/health"),
      { webOrigin: "https://web.example.test" },
      executionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("trusted");
    expect(compose).toHaveBeenCalledOnce();
  });

  it("builds only the content graph for the content fetch entrypoint", async () => {
    const compose = vi.fn(() => ({}));
    const worker = createCloudflareContentEntrypoint(compose);

    const health = await worker.fetch(
      new Request("https://content.example.test/health"),
      {},
      executionContext,
    );
    const management = await worker.fetch(
      new Request("https://content.example.test/api/artifacts"),
      {},
      executionContext,
    );

    expect(health.status).toBe(200);
    expect(management.status).toBe(404);
    expect(compose).toHaveBeenCalledTimes(2);
  });

  it("delegates Queue and scheduled events exactly once to bounded drains", async () => {
    const drainQueue = vi.fn(async () => undefined);
    const drainScheduled = vi.fn(async () => undefined);
    const worker = createCloudflareJobsEntrypoint({ drainQueue, drainScheduled });
    const batch = {
      queue: "shareslices-jobs",
      messages: [],
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } satisfies CloudflareQueueBatch<{ wakeId: string }>;
    const controller = {
      scheduledTime: Date.now(),
      cron: "*/5 * * * *",
      noRetry: vi.fn(),
    } satisfies CloudflareScheduledController;

    await worker.queue(batch, { gate: "open" }, executionContext);
    await worker.scheduled(controller, { gate: "open" }, executionContext);

    expect(drainQueue).toHaveBeenCalledOnce();
    expect(drainQueue).toHaveBeenCalledWith({
      batch,
      bindings: { gate: "open" },
      context: executionContext,
    });
    expect(drainScheduled).toHaveBeenCalledOnce();
    expect(drainScheduled).toHaveBeenCalledWith({
      controller,
      bindings: { gate: "open" },
      context: executionContext,
    });
  });
});
