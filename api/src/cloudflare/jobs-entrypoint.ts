import { createDatabaseConnection } from "../db/connection.js";
import { createCloudflareAuthenticationEmailComposition, type CloudflareAuthenticationEmailBindings } from "./authentication-email-composition.js";
import { drainCloudflareJobOutbox, type CloudflareWakeQueue } from "./job-outbox.js";
import { createCloudflareAuthenticationEmailHandler, createCloudflareJobsDrains } from "./jobs.js";
import { createCloudflareJobsEntrypoint } from "./jobs-runtime.js";
import { createCloudflareLogger } from "./logger.js";

export type CloudflareJobsBindings = CloudflareAuthenticationEmailBindings & Readonly<{
  JOB_WAKE_QUEUE: CloudflareWakeQueue;
  JOB_OUTBOX_MAX_MESSAGES: string;
  JOB_OUTBOX_LEASE_SECONDS: string;
  JOB_OUTBOX_RETRY_DELAY_SECONDS: string;
  SERVICE_VERSION: string;
  DEPLOYMENT_ENVIRONMENT: string;
}>;

function positiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid_cloudflare_binding_${name}`);
  return parsed;
}

export function createCloudflareJobsWorker() {
  const loggerFor = (bindings: CloudflareJobsBindings) => createCloudflareLogger({
    serviceVersion: bindings.SERVICE_VERSION,
    deploymentEnvironment: bindings.DEPLOYMENT_ENVIRONMENT,
  });
  const authenticationEmail = createCloudflareAuthenticationEmailHandler<CloudflareJobsBindings>({
    compose(bindings, wake) {
      return createCloudflareAuthenticationEmailComposition({ logger: loggerFor(bindings) })(bindings, wake);
    },
  });
  return createCloudflareJobsEntrypoint(createCloudflareJobsDrains<CloudflareJobsBindings>({
    handlers: { "authentication-email": authenticationEmail },
    scheduled: [async (controller, bindings) => {
      const connection = createDatabaseConnection({
        mode: "hyperdrive",
        cache: "disabled",
        connectionString: bindings.HYPERDRIVE.connectionString,
        maxConnections: 1,
        connectionTimeoutMs: 5_000,
        idleTimeoutMs: 1_000,
      });
      try {
        const result = await drainCloudflareJobOutbox({
          databaseClients: connection,
          queue: bindings.JOB_WAKE_QUEUE,
          workerId: `cloudflare-scheduled:${controller.scheduledTime}`,
          maxMessages: positiveInteger("job_outbox_max_messages", bindings.JOB_OUTBOX_MAX_MESSAGES),
          leaseSeconds: positiveInteger("job_outbox_lease_seconds", bindings.JOB_OUTBOX_LEASE_SECONDS),
          retryDelaySeconds: positiveInteger(
            "job_outbox_retry_delay_seconds",
            bindings.JOB_OUTBOX_RETRY_DELAY_SECONDS,
          ),
        });
        loggerFor(bindings).emit({
          severity: "INFO",
          body: "Cloudflare job outbox drain completed.",
          eventName: "shareslices.cloudflare.job_outbox.drain_completed",
          attributes: {
            "shareslices.job_outbox.attempted": result.attempted,
            "shareslices.job_outbox.published": result.published,
            "shareslices.job_outbox.remaining": result.remaining,
          },
        });
      } finally {
        await connection.close();
      }
    }],
  }));
}

export default createCloudflareJobsWorker();
