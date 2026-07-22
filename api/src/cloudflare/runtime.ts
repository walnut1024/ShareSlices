import type { Hono } from "hono";
import {
  buildTrustedHttpApp,
  type TrustedHttpAppInput,
} from "../http/trusted-app.js";
import {
  buildGalleryContentApp,
  type GalleryContentDependencies,
} from "../content/app.js";

/** The request-scoped capabilities supplied by a Cloudflare Worker invocation. */
export type CloudflareExecutionContext = Readonly<{
  readonly props: unknown;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}>;

export type CloudflareFetchHandler<Bindings> = Readonly<{
  fetch(
    request: Request,
    bindings: Bindings,
    context: CloudflareExecutionContext,
  ): Response | Promise<Response>;
}>;

export type CloudflareQueueMessage<Body> = Readonly<{
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  readonly attempts: number;
  ack(): void;
  retry(options?: Readonly<{ delaySeconds?: number }>): void;
}>;

export type CloudflareQueueBatch<Body> = Readonly<{
  readonly queue: string;
  readonly messages: readonly CloudflareQueueMessage<Body>[];
  readonly metadata: Readonly<{
    metrics: Readonly<{
      backlogCount: number;
      backlogBytes: number;
      oldestMessageTimestamp?: Date;
    }>;
  }>;
  ackAll(): void;
  retryAll(options?: Readonly<{ delaySeconds?: number }>): void;
}>;

export type CloudflareScheduledController = Readonly<{
  readonly scheduledTime: number;
  readonly cron: string;
  noRetry(): void;
}>;

export type CloudflareJobsHandler<Bindings, Wake> = Readonly<{
  queue(
    batch: CloudflareQueueBatch<Wake>,
    bindings: Bindings,
    context: CloudflareExecutionContext,
  ): void | Promise<void>;
  scheduled(
    controller: CloudflareScheduledController,
    bindings: Bindings,
    context: CloudflareExecutionContext,
  ): void | Promise<void>;
}>;

type HonoFactory<Bindings> = (bindings: Bindings) => Hono;

function createFetchHandler<Bindings>(build: HonoFactory<Bindings>): CloudflareFetchHandler<Bindings> {
  return {
    fetch(request, bindings, context) {
      const app = build(bindings);
      return app.fetch(request, bindings, context);
    },
  };
}

/**
 * Composes the trusted Worker from bindings for each invocation. The supplied
 * composition must remain capability-only and must not retain request state.
 */
export function createCloudflareTrustedEntrypoint<Bindings>(
  compose: (bindings: Bindings) => TrustedHttpAppInput,
): CloudflareFetchHandler<Bindings> {
  return createFetchHandler((bindings) => buildTrustedHttpApp(compose(bindings)));
}

/** Composes the authority-reduced content Worker from the shared content builder. */
export function createCloudflareContentEntrypoint<Bindings>(
  compose: (bindings: Bindings) => GalleryContentDependencies,
): CloudflareFetchHandler<Bindings> {
  return createFetchHandler((bindings) => buildGalleryContentApp(compose(bindings)));
}

export type CloudflareJobsDrains<Bindings, Wake> = Readonly<{
  drainQueue(input: Readonly<{
    batch: CloudflareQueueBatch<Wake>;
    bindings: Bindings;
    context: CloudflareExecutionContext;
  }>): void | Promise<void>;
  drainScheduled(input: Readonly<{
    controller: CloudflareScheduledController;
    bindings: Bindings;
    context: CloudflareExecutionContext;
  }>): void | Promise<void>;
}>;

export { createCloudflareJobsEntrypoint } from "./jobs-runtime.js";
