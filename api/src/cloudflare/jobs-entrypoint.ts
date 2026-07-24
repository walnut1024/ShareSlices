import { createDatabaseConnection } from "../db/connection.js";
import { createCloudflareAuthenticationEmailComposition, type CloudflareAuthenticationEmailBindings } from "./authentication-email-composition.js";
import {
  createContainerHandoffRepository,
  type AuthorizedContainerWake,
} from "./container-handoff-repository.js";
import {
  handoffContainerWake,
  type ContainerSlotBindings,
} from "./container-slot-controller.js";
import { drainCloudflareJobOutbox, type CloudflareWakeQueue } from "./job-outbox.js";
import { createCloudflareAuthenticationEmailHandler, createCloudflareJobsDrains } from "./jobs.js";
import { createCloudflareJobsEntrypoint } from "./jobs-runtime.js";
import { createCloudflareLogger } from "./logger.js";
import {createScheduledExecutionGate} from "./scheduled-execution-gate.js";
import {recoverExpiredCloudflareProcessingLeases} from "./expired-processing-lease-recovery.js";

export type CloudflareJobsBindings = CloudflareAuthenticationEmailBindings & ContainerSlotBindings & Readonly<{
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
  const containerHandoff = async (
    wake: Parameters<typeof handoffContainerWake>[0]["wake"],
    bindings: CloudflareJobsBindings,
  ) => {
    const connection = createDatabaseConnection({
      mode: "hyperdrive",
      cache: "disabled",
      connectionString: bindings.HYPERDRIVE.connectionString,
      maxConnections: 1,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 1_000,
    });
    try {
      const repository = createContainerHandoffRepository(connection);
      let authorization: AuthorizedContainerWake | undefined;
      await handoffContainerWake({
        bindings,
        wake,
        async authorizeWake(candidate) {
          authorization = await repository.authorizeWake(candidate);
        },
        async recordHandoff(handoff) {
          if (!authorization) throw new Error("container_wake_not_authorized");
          await repository.recordHandoff(authorization, handoff);
        },
      });
    } finally {
      await connection.close();
    }
  };
  return createCloudflareJobsEntrypoint(createCloudflareJobsDrains<CloudflareJobsBindings>({
    handlers: {
      "authentication-email": authenticationEmail,
      "artifact-processing": containerHandoff,
      thumbnail: containerHandoff,
    },
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
        const gate = createScheduledExecutionGate(connection);
        const claim = await gate.claim(controller);
        if (!claim.accepted) {
          loggerFor(bindings).emit({
            severity: "INFO",
            body: "Cloudflare scheduled invocation fenced.",
            eventName: "shareslices.cloudflare.scheduled.fenced",
            attributes: {
              "shareslices.scheduled.reason_code": claim.reasonCode,
            },
          });
          return;
        }
        let completed = false;
        try {
          const recoveredLeaseCount = await recoverExpiredCloudflareProcessingLeases({
            databaseClients: connection,
            expiredBefore: new Date(),
            limit: positiveInteger("job_outbox_max_messages", bindings.JOB_OUTBOX_MAX_MESSAGES),
          });
          const result = await drainCloudflareJobOutbox({
            databaseClients: connection,
            queue: bindings.JOB_WAKE_QUEUE,
            acceptedLanes: ["authentication-email", "artifact-processing", "thumbnail"],
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
              "shareslices.processing.recovered_lease_count": recoveredLeaseCount,
            },
          });
          await gate.complete(claim, {state: "completed"});
          completed = true;
        } finally {
          if (!completed) {
            await gate.complete(claim, {
              state: "failed",
              reasonCode: "scheduled_recovery_failed",
            });
          }
        }
      } finally {
        await connection.close();
      }
    }],
  }));
}

export default createCloudflareJobsWorker();
