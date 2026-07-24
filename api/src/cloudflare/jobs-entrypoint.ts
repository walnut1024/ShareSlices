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
import {
  drainCloudflareJobOutbox,
  recoverLostCloudflareJobWakes,
  type CloudflareWakeQueue,
} from "./job-outbox.js";
import { createCloudflareAuthenticationEmailHandler, createCloudflareJobsDrains } from "./jobs.js";
import { createCloudflareJobsEntrypoint } from "./jobs-runtime.js";
import { createCloudflareLogger } from "./logger.js";
import {createScheduledExecutionGate} from "./scheduled-execution-gate.js";
import {recoverExpiredCloudflareProcessingLeases} from "./expired-processing-lease-recovery.js";
import {
  createCloudflareThumbnailExecutionRepository,
  type PreparedThumbnailExecution,
} from "./thumbnail-execution-repository.js";
import {recoverExpiredCloudflareThumbnailLeases} from "./expired-thumbnail-lease-recovery.js";
import {
  createJobsReleaseVerificationFetch,
  type JobsReleaseVerificationBindings,
} from "./jobs-release-verification.js";

export type CloudflareJobsBindings = CloudflareAuthenticationEmailBindings &
  ContainerSlotBindings &
  JobsReleaseVerificationBindings & Readonly<{
  JOB_WAKE_QUEUE: CloudflareWakeQueue;
  JOB_OUTBOX_MAX_MESSAGES: string;
  JOB_OUTBOX_LEASE_SECONDS: string;
  JOB_OUTBOX_RETRY_DELAY_SECONDS: string;
  JOB_OUTBOX_LOST_WAKE_AFTER_SECONDS: string;
  THUMBNAIL_BOOTSTRAP_LIFETIME_SECONDS: string;
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
  const thumbnailContainerHandoff = async (
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
      const handoffs = createContainerHandoffRepository(connection);
      const executions = createCloudflareThumbnailExecutionRepository(connection);
      let authorization: AuthorizedContainerWake | undefined;
      let execution: PreparedThumbnailExecution | undefined;
      await handoffContainerWake({
        bindings,
        wake,
        async authorizeWake(candidate) {
          authorization = await handoffs.authorizeWake(candidate);
          execution = await executions.prepare(candidate, {
            leaseSeconds: positiveInteger(
              "thumbnail_maximum_wall_time_seconds",
              bindings.THUMBNAIL_MAXIMUM_WALL_TIME_SECONDS,
            ),
            bootstrapLifetimeSeconds: positiveInteger(
              "thumbnail_bootstrap_lifetime_seconds",
              bindings.THUMBNAIL_BOOTSTRAP_LIFETIME_SECONDS,
            ),
          });
          if (execution.outboxFence !== authorization.outboxFence) {
            throw new Error("thumbnail_execution_outbox_fence_mismatch");
          }
          return {bootstrapGrant: execution.bootstrapGrant};
        },
        async recordHandoff(handoff) {
          if (!authorization || !execution) {
            throw new Error("container_wake_not_authorized");
          }
          await handoffs.recordHandoff(authorization, handoff);
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
      thumbnail: thumbnailContainerHandoff,
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
          const recoveredThumbnailLeaseCount =
            await recoverExpiredCloudflareThumbnailLeases({
              databaseClients: connection,
              expiredBefore: new Date(),
              limit: positiveInteger(
                "job_outbox_max_messages",
                bindings.JOB_OUTBOX_MAX_MESSAGES,
              ),
            });
          const recoveredWakeCount = await recoverLostCloudflareJobWakes({
            databaseClients: connection,
            acceptedLanes: ["authentication-email", "artifact-processing", "thumbnail"],
            lostAfterSeconds: positiveInteger(
              "job_outbox_lost_wake_after_seconds",
              bindings.JOB_OUTBOX_LOST_WAKE_AFTER_SECONDS,
            ),
            maxMessages: positiveInteger(
              "job_outbox_max_messages",
              bindings.JOB_OUTBOX_MAX_MESSAGES,
            ),
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
              "shareslices.thumbnail.recovered_lease_count":
                recoveredThumbnailLeaseCount,
              "shareslices.job_outbox.recovered_wake_count": recoveredWakeCount,
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
  }), createJobsReleaseVerificationFetch());
}

export default createCloudflareJobsWorker();
