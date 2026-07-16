import type { Pool } from "pg";
import type { ObjectStorage } from "../../storage/object-storage.js";

/**
 * Fences expanding Gallery work after runtime disablement without mutating a
 * listing lifecycle, completed copy, governance record, or active Download.
 */
export class GalleryRollbackCoordinator {
  constructor(private readonly pool: Pick<Pool, "connect">, private readonly storage?: Pick<ObjectStorage, "removeStagingPrefix">) {}

  async reconcileDisabled(): Promise<void> {
    const client = await this.pool.connect();
    let attemptPrefixes: string[] = [];
    let committed = false;
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext('gallery-rollback'))",
      );
      for (const table of ["gallery_safety_job", "gallery_cover_job"]) {
        await client.query(
          `update ${table} set state='queued', lease_owner=null, lease_expires_at=null, heartbeat_at=null, fence_token=fence_token+1 where state='running'`,
        );
      }
      await client.query(
        `update gallery_copy_job set state='cancelled', terminal_failure_code='gallery_unavailable',
         lease_owner=null, lease_expires_at=null, fence_token=fence_token+1, finished_at=now()
         where state in ('accepted','processing')`,
      );
      await client.query(
        `update gallery_copy_attempt attempt set state='failed', failure_code='gallery_unavailable', finished_at=now()
         from gallery_copy_job job where attempt.job_id=job.id and job.state='cancelled' and attempt.state='running'`,
      );
      attemptPrefixes = (await client.query(
        `select distinct attempt.object_prefix from gallery_copy_attempt attempt
         join gallery_copy_job job on job.id=attempt.job_id
         where job.state='cancelled' and attempt.state='failed' and attempt.object_prefix is not null`,
      )).rows.map((row) => String(row.object_prefix));
      await client.query(
        `update artifact_storage_quota_account account set
         artifact_reserved=artifact_reserved-reservation.artifact_count,
         storage_bytes_reserved=storage_bytes_reserved-reservation.storage_bytes,
         revision=revision+1, updated_at=now()
         from artifact_storage_quota_reservation reservation join gallery_copy_job job
         on job.quota_reservation_id=reservation.id
         where account.user_id=reservation.user_id and job.state='cancelled' and reservation.state='held'`,
      );
      await client.query(
        `update artifact_storage_quota_reservation reservation set state='released', released_at=now()
         from gallery_copy_job job where job.quota_reservation_id=reservation.id
         and job.state='cancelled' and reservation.state='held'`,
      );
      await client.query(
        `update gallery_copy_source_retention retention set release_after=coalesce(release_after,now()), released_at=coalesce(released_at,now())
         from gallery_copy_job job where retention.job_id=job.id and job.state='cancelled'`,
      );
      await client.query("commit");
      committed = true;
    } catch (error) {
      if (!committed) await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    if (this.storage) await Promise.all(attemptPrefixes.filter((prefix) => prefix.startsWith("staging/gallery-copy/")).map((prefix) => this.storage!.removeStagingPrefix(prefix)));
  }
}
