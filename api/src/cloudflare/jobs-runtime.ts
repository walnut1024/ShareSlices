import type { CloudflareJobsDrains, CloudflareJobsHandler } from "./runtime.js";

/**
 * Adapts finite Queue and Cron invocations to bounded one-shot drains without
 * importing either trusted or content-only HTTP composition.
 */
export function createCloudflareJobsEntrypoint<Bindings, Wake>(
  drains: CloudflareJobsDrains<Bindings, Wake>,
  fetch: (
    request: Request,
    bindings: Bindings,
    context: Parameters<CloudflareJobsHandler<Bindings, Wake>["fetch"]>[2],
  ) => Response | Promise<Response> = () => new Response(null, {
    status: 404,
    headers: {"Cache-Control": "no-store"},
  }),
): CloudflareJobsHandler<Bindings, Wake> {
  return {
    fetch,
    queue(batch, bindings, context) {
      return drains.drainQueue({ batch, bindings, context });
    },
    scheduled(controller, bindings, context) {
      return drains.drainScheduled({ controller, bindings, context });
    },
  };
}
