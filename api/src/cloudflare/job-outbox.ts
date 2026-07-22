import type { DatabaseClientSource } from "../db/connection.js";
import { createCloudflareJobWake, type CloudflareJobWake, type CloudflareJobWakeLane } from "./job-wake.js";

export type CloudflareWakeQueue = Readonly<{
  send(message: CloudflareJobWake): Promise<void>;
}>;

type ClaimedDispatch = Readonly<{
  lane: CloudflareJobWakeLane;
  durableJobId: string;
  wakeId: string;
  createdAt: Date;
  fence: number;
}>;

export type CloudflareOutboxDrainResult = Readonly<{
  attempted: number;
  published: number;
  remaining: boolean;
}>;

export async function drainCloudflareJobOutbox(input: Readonly<{
  databaseClients: DatabaseClientSource;
  queue: CloudflareWakeQueue;
  acceptedLanes: readonly CloudflareJobWakeLane[];
  workerId: string;
  maxMessages: number;
  leaseSeconds: number;
  retryDelaySeconds: number;
}>): Promise<CloudflareOutboxDrainResult> {
  if (!Number.isSafeInteger(input.maxMessages) || input.maxMessages <= 0) {
    throw new Error("invalid_cloudflare_outbox_max_messages");
  }
  if (!Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds <= 0) {
    throw new Error("invalid_cloudflare_outbox_lease_seconds");
  }
  if (!Number.isSafeInteger(input.retryDelaySeconds) || input.retryDelaySeconds <= 0) {
    throw new Error("invalid_cloudflare_outbox_retry_delay_seconds");
  }
  if (input.acceptedLanes.length === 0 || new Set(input.acceptedLanes).size !== input.acceptedLanes.length) {
    throw new Error("invalid_cloudflare_outbox_accepted_lanes");
  }

  return input.databaseClients.withClient(async (client) => {
    await client.query(
      `update cloudflare_job_dispatch_outbox
       set state = 'pending', lease_owner = null, lease_expires_at = null,
           available_at = now(), failure_reason_code = 'publish_outcome_unknown', updated_at = now()
       where state = 'publishing' and lease_expires_at <= now()`,
    );
    let attempted = 0;
    let published = 0;
    while (attempted < input.maxMessages) {
      const generatedWakeId = crypto.randomUUID();
      await client.query("begin");
      let claimed: ClaimedDispatch | undefined;
      try {
        const selected = await client.query<{
          lane: CloudflareJobWakeLane;
          durable_job_id: string;
          wake_id: string | null;
          created_at: Date;
          fence: string | number;
        }>(
          `select lane, durable_job_id, wake_id, created_at, fence
           from cloudflare_job_dispatch_outbox
           where state = 'pending' and available_at <= now() and lane = any($1::text[])
           order by created_at, lane, durable_job_id
           for update skip locked limit 1`,
          [input.acceptedLanes],
        );
        const row = selected.rows[0];
        if (!row) {
          await client.query("commit");
          break;
        }
        const nextFence = Number(row.fence) + 1;
        const wakeId = row.wake_id ?? generatedWakeId;
        const updated = await client.query(
          `update cloudflare_job_dispatch_outbox
           set state = 'publishing', wake_id = $3, lease_owner = $4,
               lease_expires_at = now() + ($5 * interval '1 second'),
               fence = $6, attempt_count = attempt_count + 1,
               failure_reason_code = null, updated_at = now()
           where lane = $1 and durable_job_id = $2 and state = 'pending' and fence = $7`,
          [row.lane, row.durable_job_id, wakeId, input.workerId, input.leaseSeconds, nextFence, row.fence],
        );
        if (updated.rowCount !== 1) throw new Error("cloudflare_outbox_claim_lost");
        claimed = {
          lane: row.lane,
          durableJobId: row.durable_job_id,
          wakeId,
          createdAt: row.created_at,
          fence: nextFence,
        };
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }

      attempted += 1;
      const wake = createCloudflareJobWake({
        lane: claimed.lane,
        durableJobId: claimed.durableJobId,
        wakeId: claimed.wakeId,
        now: claimed.createdAt,
      });
      try {
        await input.queue.send(wake);
      } catch {
        const returned = await client.query(
          `update cloudflare_job_dispatch_outbox
           set state = 'pending', available_at = now() + ($6 * interval '1 second'),
               lease_owner = null, lease_expires_at = null,
               failure_reason_code = 'queue_publish_failed', updated_at = now()
           where lane = $1 and durable_job_id = $2 and state = 'publishing'
             and wake_id = $3 and lease_owner = $4 and fence = $5`,
          [
            claimed.lane,
            claimed.durableJobId,
            claimed.wakeId,
            input.workerId,
            claimed.fence,
            input.retryDelaySeconds,
          ],
        );
        if (returned.rowCount !== 1) throw new Error("cloudflare_outbox_publish_outcome_after_lease_lost");
        continue;
      }
      const completed = await client.query(
        `update cloudflare_job_dispatch_outbox
         set state = 'published', published_at = now(), lease_owner = null,
             lease_expires_at = null, failure_reason_code = null, updated_at = now()
         where lane = $1 and durable_job_id = $2 and state = 'publishing'
           and wake_id = $3 and lease_owner = $4 and fence = $5`,
        [claimed.lane, claimed.durableJobId, claimed.wakeId, input.workerId, claimed.fence],
      );
      if (completed.rowCount !== 1) throw new Error("cloudflare_outbox_publish_outcome_after_lease_lost");
      published += 1;
    }
    const remaining = await client.query(
      `select 1 from cloudflare_job_dispatch_outbox
       where state in ('pending', 'publishing') and lane = any($1::text[]) limit 1`,
      [input.acceptedLanes],
    );
    return { attempted, published, remaining: (remaining.rowCount ?? 0) > 0 };
  });
}
