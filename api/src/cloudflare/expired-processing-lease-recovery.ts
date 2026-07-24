import type {DatabaseClientSource} from "../db/connection.js";

type ExpiredLease = Readonly<{
  id: string;
  upload_session_id: string;
  attempt_count: number;
  max_attempts: number;
}>;

export async function recoverExpiredCloudflareProcessingLeases(input: Readonly<{
  databaseClients: DatabaseClientSource;
  expiredBefore: Date;
  limit: number;
}>): Promise<number> {
  if (Number.isNaN(input.expiredBefore.getTime())) {
    throw new Error("invalid_cloudflare_processing_lease_cutoff");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 1_000) {
    throw new Error("invalid_cloudflare_processing_lease_recovery_limit");
  }
  return input.databaseClients.withClient(async (client) => {
    await client.query("begin");
    try {
      const expired = await client.query<ExpiredLease>(
        `select id, upload_session_id, attempt_count, max_attempts
         from artifact_processing_job
         where state = 'running' and lease_expires_at <= $1
         order by lease_expires_at, id
         for update skip locked limit $2`,
        [input.expiredBefore, input.limit],
      );
      for (const job of expired.rows) {
        const attempt = await client.query(
          `update artifact_processing_attempt
           set state = 'failed', reason_code = 'processing_lease_expired', finished_at = now()
           where job_id = $1 and attempt_number = $2 and state = 'running'`,
          [job.id, job.attempt_count],
        );
        if (attempt.rowCount !== 1) {
          throw new Error("cloudflare_expired_processing_attempt_missing");
        }
        if (job.attempt_count < job.max_attempts) {
          await client.query(
            `update artifact_processing_job
             set state = 'queued', available_at = now(), lease_owner = null,
                 lease_expires_at = null, heartbeat_at = null, updated_at = now()
             where id = $1`,
            [job.id],
          );
          continue;
        }
        await client.query(
          `update artifact_processing_job
           set state = 'failed', lease_owner = null, lease_expires_at = null,
               heartbeat_at = null, updated_at = now()
           where id = $1`,
          [job.id],
        );
        await client.query(
          `update artifact_upload_session
           set state = 'failed', failure_reason_code = 'processing_lease_expired',
               failure_summary = 'Processing was interrupted.', retryable = true,
               updated_at = now()
           where id = $1`,
          [job.upload_session_id],
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
