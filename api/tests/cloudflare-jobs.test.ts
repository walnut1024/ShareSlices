import { describe, expect, it, vi } from "vitest";
import { createCloudflareAuthenticationEmailHandler, createCloudflareJobsDrains } from "../src/cloudflare/jobs.js";
import { createCloudflareJobWake } from "../src/cloudflare/job-wake.js";
import type { CloudflareExecutionContext, CloudflareQueueBatch, CloudflareScheduledController } from "../src/cloudflare/runtime.js";

const context: CloudflareExecutionContext = {
  props: undefined,
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
};

function batch(...bodies: unknown[]): CloudflareQueueBatch<unknown> {
  return {
    queue: "shareslices-jobs",
    metadata: { metrics: { backlogCount: bodies.length, backlogBytes: 0 } },
    messages: bodies.map((body, index) => ({
      id: `message-${index}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    })),
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
}

const scheduled: CloudflareScheduledController = {
  scheduledTime: Date.parse("2026-07-22T01:00:00.000Z"),
  cron: "*/5 * * * *",
  noRetry: vi.fn(),
};

describe("Cloudflare bounded Jobs drains", () => {
  it("acknowledges a wake only after the lane handler completes", async () => {
    const dispatch = vi.fn(async () => true);
    const compose = vi.fn(() => ({}) as never);
    const wake = createCloudflareJobWake({ lane: "authentication-email" });
    const queue = batch(wake);
    const handler = createCloudflareAuthenticationEmailHandler({ compose, dispatch });
    const drains = createCloudflareJobsDrains({ handlers: { "authentication-email": handler }, scheduled: [] });

    await drains.drainQueue({ batch: queue, bindings: { database: "binding" }, context });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(compose).toHaveBeenCalledWith({ database: "binding" }, wake);
    expect(queue.messages[0]!.ack).toHaveBeenCalledOnce();
    expect(queue.messages[0]!.retry).not.toHaveBeenCalled();
  });

  it("retries failed and unhandled lanes without acknowledging them", async () => {
    const failed = vi.fn(async () => { throw new Error("bounded failure"); });
    const queue = batch(
      createCloudflareJobWake({ lane: "authentication-email" }),
      createCloudflareJobWake({ lane: "thumbnail" }),
    );
    const drains = createCloudflareJobsDrains({
      handlers: { "authentication-email": failed },
      scheduled: [],
      retryDelaySeconds: 17,
    });

    await drains.drainQueue({ batch: queue, bindings: {}, context });

    for (const message of queue.messages) {
      expect(message.ack).not.toHaveBeenCalled();
      expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 17 });
    }
  });

  it("acknowledges invalid poison messages without exposing their body to a handler", async () => {
    const handler = vi.fn(async () => undefined);
    const queue = batch({ apiKey: "must-not-propagate", payload: { email: "person@example.com" } });
    const drains = createCloudflareJobsDrains({ handlers: { "authentication-email": handler }, scheduled: [] });

    await drains.drainQueue({ batch: queue, bindings: {}, context });

    expect(handler).not.toHaveBeenCalled();
    expect(queue.messages[0]!.ack).toHaveBeenCalledOnce();
  });

  it("runs scheduled recovery drains once without starting a resident loop", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const drains = createCloudflareJobsDrains({ handlers: {}, scheduled: [first, second] });

    await drains.drainScheduled({ controller: scheduled, bindings: { gate: "open" }, context });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledWith(scheduled, { gate: "open" }, context);
  });
});
