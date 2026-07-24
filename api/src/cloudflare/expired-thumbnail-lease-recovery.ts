import type {DatabaseClientSource} from "../db/connection.js";

type ExpiredThumbnailLease = Readonly<{
  id: string;
  attempt_count: number;
  max_attempts: number;
}>;

export async function recoverExpiredCloudflareThumbnailLeases(input: Readonly<{
  databaseClients: DatabaseClientSource;
  expiredBefore: Date;
  limit: number;
}>): Promise<number> {
  if (Number.isNaN(input.expiredBefore.getTime())) {
    throw new Error("invalid_cloudflare_thumbnail_lease_cutoff");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
    throw new Error("invalid_cloudflare_thumbnail_lease_recovery_limit");
  }
  return input.databaseClients.withClient(async (client) => {
    await client.query("begin");
    try {
      const expired = await client.query<ExpiredThumbnailLease>(
        `select id, attempt_count, max_attempts
         from content_bundle_thumbnail_job
         where state = 'running' and lease_expires_at <= $1
         order by lease_expires_at, id
         for update skip locked limit $2`,
        [input.expiredBefore, input.limit],
      );
      for (const job of expired.rows) {
        const attempt = await client.query<{id: string}>(
          `update content_bundle_thumbnail_attempt
           set state = 'failed', finished_at = now(),
               cleanup_state = 'eligible', cleanup_eligible_at = now()
           where job_id = $1 and attempt_number = $2 and state = 'running'
           returning id`,
          [job.id, job.attempt_count],
        );
        const attemptId = attempt.rows[0]?.id;
        if (!attemptId) {
          throw new Error("cloudflare_expired_thumbnail_attempt_missing");
        }
        await client.query(
          `update cloudflare_thumbnail_execution_grant
           set revoked_at = now()
           where attempt_id = $1 and revoked_at is null`,
          [attemptId],
        );
        await client.query(
          `update content_bundle_thumbnail_job
           set state = case when attempt_count < max_attempts
                            then 'queued' else 'failed' end,
               available_at = now(), lease_owner = null,
               lease_expires_at = null, heartbeat_at = null,
               failure_reason_code = 'thumbnail_lease_expired',
               updated_at = now()
           where id = $1 and state = 'running'`,
          [job.id],
        );
      }
      await client.query("commit");
      return expired.rows.length;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}
