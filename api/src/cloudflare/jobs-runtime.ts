import type { CloudflareJobsDrains, CloudflareJobsHandler } from "./runtime.js";

/**
 * Adapts finite Queue and Cron invocations to bounded one-shot drains without
 * importing either trusted or content-only HTTP composition.
 */
export function createCloudflareJobsEntrypoint<Bindings, Wake>(
  drains: CloudflareJobsDrains<Bindings, Wake>,
): CloudflareJobsHandler<Bindings, Wake> {
  return {
    queue(batch, bindings, context) {
      return drains.drainQueue({ batch, bindings, context });
    },
    scheduled(controller, bindings, context) {
      return drains.drainScheduled({ controller, bindings, context });
    },
  };
}
