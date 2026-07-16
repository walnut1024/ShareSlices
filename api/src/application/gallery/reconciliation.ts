import type { Pool } from "pg";
import type { ObjectStorage } from "../../storage/object-storage.js";
export class GalleryReconciliation {
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<
      ObjectStorage,
      "removeStagingPrefix" | "deleteObject"
    >,
  ) {}
  async run(limit = 100): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtext('gallery-reconciliation'))",
      );
      await client.query(
        "update gallery_download_source_lease set state='expired',ended_at=now() where state='active' and expires_at<=now()",
      );
      await client.query(
        "update gallery_privacy_retention_record set deleted_at=now(),subject_key='deleted' where deleted_at is null and retained_until<=now()",
      );
      await client.query(
        "delete from gallery_download_rate_evidence where privacy_delete_after<=now()",
      );
      await client.query(
        "update gallery_avatar_upload set state='expired' where state='staged' and expires_at<=now()",
      );
      const terminal = (
        await client.query(
          `select job.id,job.state,job.quota_reservation_id,reservation.user_id,reservation.artifact_count,reservation.storage_bytes,reservation.state reservation_state
    from gallery_copy_job job join artifact_storage_quota_reservation reservation on reservation.id=job.quota_reservation_id where job.state in ('ready','failed','cancelled') and ((job.state='ready' and reservation.state<>'committed') or (job.state<>'ready' and reservation.state<>'released')) for update of job,reservation limit $1`,
          [limit],
        )
      ).rows;
      for (const row of terminal) {
        const commit = row.state === "ready";
        if (row.reservation_state === "held")
          await client.query(
            `update artifact_storage_quota_account set artifact_reserved=artifact_reserved-$2,storage_bytes_reserved=storage_bytes_reserved-$3,artifact_usage=artifact_usage+case when $4 then $2 else 0 end,storage_bytes_usage=storage_bytes_usage+case when $4 then $3 else 0 end,revision=revision+1,updated_at=now() where user_id=$1`,
            [row.user_id, row.artifact_count, row.storage_bytes, commit],
          );
        await client.query(
          "update artifact_storage_quota_reservation set state=$2,committed_at=case when $2='committed' then now() end,released_at=case when $2='released' then now() end where id=$1",
          [row.quota_reservation_id, commit ? "committed" : "released"],
        );
        await client.query(
          "update gallery_copy_source_retention set release_after=coalesce(release_after,now()),released_at=coalesce(released_at,now()) where job_id=$1",
          [row.id],
        );
      }
      const attempts = (
        await client.query(
          `select attempt.object_prefix from gallery_copy_attempt attempt join gallery_copy_job job on job.id=attempt.job_id where job.state in ('ready','failed','cancelled') and attempt.state<>'running' limit $1`,
          [limit],
        )
      ).rows;
      const evidence = (
        await client.query(
          `select hold.id,hold.object_key
           from gallery_governance_evidence_hold hold
           join gallery_governance_case governance_case on governance_case.id=hold.case_id
           where hold.released_at is null and governance_case.state<>'open'
             and governance_case.retention_release_after<=now()
             and not exists(
               select 1 from gallery_governance_decision decision
               where decision.case_id=governance_case.id and decision.appeal_deadline_at>now())
             and not exists(
               select 1 from gallery_governance_case appeal_case
               join gallery_appeal appeal on appeal.case_id=appeal_case.id
               where appeal_case.parent_case_id=governance_case.id and appeal.state='pending')
             and not exists(
               select 1 from gallery_governance_evidence_hold other
               where other.object_key=hold.object_key and other.id<>hold.id and other.released_at is null)
           order by governance_case.retention_release_after,hold.id limit $1
           for update of hold skip locked`,
          [limit],
        )
      ).rows;
      await client.query("commit");
      for (const row of attempts) {
        if (String(row.object_prefix).startsWith("staging/gallery-copy/"))
          await this.storage.removeStagingPrefix(row.object_prefix);
      }
      for (const row of evidence) {
        await this.storage.deleteObject(String(row.object_key));
        await this.pool.query(
          "update gallery_governance_evidence_hold set release_after=coalesce(release_after,now()),released_at=now() where id=$1 and released_at is null",
          [row.id],
        );
      }
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
