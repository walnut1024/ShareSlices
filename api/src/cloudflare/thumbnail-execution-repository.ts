import {createHash, randomBytes, randomUUID} from "node:crypto";

import type {DatabaseClientSource} from "../db/connection.js";
import type {CloudflareJobWake} from "./job-wake.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export type PreparedThumbnailExecution = Readonly<{
  wakeId: string;
  durableJobId: string;
  outboxFence: number;
  attemptId: string;
  bootstrapGrant: string;
}>;

export function createCloudflareThumbnailExecutionRepository(
  databaseClients: DatabaseClientSource,
) {
  return Object.freeze({
    async prepare(
      wake: CloudflareJobWake,
      input: Readonly<{
        leaseSeconds: number;
        bootstrapLifetimeSeconds: number;
      }>,
    ): Promise<PreparedThumbnailExecution> {
      if (
        wake.lane !== "thumbnail" ||
        !wake.durableJobId ||
        !Number.isSafeInteger(input.leaseSeconds) ||
        input.leaseSeconds <= 0 ||
        !Number.isSafeInteger(input.bootstrapLifetimeSeconds) ||
        input.bootstrapLifetimeSeconds <= 0
      ) {
        throw new Error("thumbnail_execution_wake_invalid");
      }
      const durableJobId = wake.durableJobId;
      return databaseClients.withClient(async (client) => {
        await client.query("begin");
        try {
          const outbox = await client.query<{fence: string | number}>(
            `select fence
             from cloudflare_job_dispatch_outbox
             where lane = 'thumbnail' and durable_job_id = $1
               and wake_id = $2 and state = 'published'
             for share`,
            [durableJobId, wake.wakeId],
          );
          const outboxFence = Number(outbox.rows[0]?.fence);
          if (!Number.isSafeInteger(outboxFence) || outboxFence <= 0) {
            throw new Error("container_wake_not_authorized");
          }

          const owner = `cloudflare-thumbnail:${wake.wakeId}`;
          const job = await client.query<{
            id: string;
            bundle_id: string;
            owner_user_id: string;
            renderer_revision: string;
            state: string;
            lease_owner: string | null;
            attempt_count: number;
            max_attempts: number;
          }>(
            `select id, bundle_id, owner_user_id, renderer_revision, state,
                    lease_owner, attempt_count, max_attempts
             from content_bundle_thumbnail_job
             where id = $1
             for update`,
            [durableJobId],
          );
          const row = job.rows[0];
          if (!row) throw new Error("thumbnail_execution_job_missing");

          let attemptId: string;
          if (row.state === "running" && row.lease_owner === owner) {
            const attempt = await client.query<{id: string}>(
              `select id
               from content_bundle_thumbnail_attempt
               where job_id = $1 and state = 'running'
               order by attempt_number desc
               limit 1
               for update`,
              [durableJobId],
            );
            const existing = attempt.rows[0];
            if (!existing) throw new Error("thumbnail_execution_attempt_missing");
            attemptId = existing.id;
          } else {
            if (
              row.state !== "queued" ||
              row.attempt_count >= row.max_attempts
            ) {
              throw new Error("thumbnail_execution_job_not_claimable");
            }
            const version = await client.query<{id: string}>(
              `select id
               from artifact_version
               where content_bundle_id = $1 and owner_user_id = $2
                 and renderer_revision = $3 and state = 'ready'
               order by ready_at, id
               limit 1`,
              [row.bundle_id, row.owner_user_id, row.renderer_revision],
            );
            const versionId = version.rows[0]?.id;
            if (!versionId) {
              throw new Error("thumbnail_execution_no_live_version");
            }
            const attemptNumber = row.attempt_count + 1;
            const claimed = await client.query(
              `update content_bundle_thumbnail_job
               set state = 'running', lease_owner = $2,
                   lease_expires_at = now() + make_interval(secs => $3),
                   heartbeat_at = now(), attempt_count = $4, updated_at = now()
               where id = $1 and state = 'queued' and available_at <= now()`,
              [durableJobId, owner, input.leaseSeconds, attemptNumber],
            );
            if (claimed.rowCount !== 1) {
              throw new Error("thumbnail_execution_job_not_claimable");
            }
            attemptId = randomUUID();
            const objectKey =
              `content-bundles/${row.bundle_id}/thumbnails/` +
              `${row.renderer_revision}/${attemptId}.webp`;
            await client.query(
              `insert into content_bundle_thumbnail_attempt(
                 id, job_id, attempt_number, capture_version_id, object_key,
                 lease_expires_at, write_deadline_at
               ) values(
                 $1, $2, $3, $4, $5,
                 now() + make_interval(secs => $6),
                 now() + make_interval(secs => $6)
               )`,
              [
                attemptId,
                durableJobId,
                attemptNumber,
                versionId,
                objectKey,
                input.leaseSeconds,
              ],
            );
          }

          await client.query(
            `update cloudflare_thumbnail_execution_grant
             set revoked_at = now()
             where attempt_id = $1 and revoked_at is null`,
            [attemptId],
          );
          const bootstrapGrant = randomBytes(32).toString("base64url");
          await client.query(
            `insert into cloudflare_thumbnail_execution_grant(
               id, attempt_id, bootstrap_token_hash, expires_at
             ) values(
               $1, $2, $3,
               now() + make_interval(secs => $4)
             )`,
            [
              randomUUID(),
              attemptId,
              hash(bootstrapGrant),
              input.bootstrapLifetimeSeconds,
            ],
          );
          await client.query("commit");
          return {
            wakeId: wake.wakeId,
            durableJobId,
            outboxFence,
            attemptId,
            bootstrapGrant,
          };
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
    },
  });
}
