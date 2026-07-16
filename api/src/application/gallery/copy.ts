import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
export type GalleryCopyOutcome = Readonly<{
  id: string;
  state:
    | "accepted"
    | "processing"
    | "ready"
    | "failed"
    | "cancelled"
    | "indeterminate";
  sourceListingId: string;
  sourceListingRevision: number;
  sourceVersionId: string;
  destinationArtifactId: string | null;
  quotaState: "held" | "committed" | "released";
}>;
export class GalleryCopyError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "gone"
      | "rate_limited"
      | "artifact_quota_unavailable"
      | "storage_quota_unavailable"
      | "idempotency_conflict",
  ) {
    super(code);
  }
}
export class GalleryCopyService {
  constructor(
    private readonly pool: Pool,
    private readonly maxAttempts = 3,
  ) {}
  async accept(
    input: Readonly<{
      copierUserId: string;
      slug: string;
      title: string;
      idempotencyKey: string;
    }>,
  ): Promise<GalleryCopyOutcome> {
    const title = input.title.trim();
    if (!title || title.length > 200) throw new GalleryCopyError("not_found");
    const keyDigest = hash(input.idempotencyKey);
    const fingerprint = hash(JSON.stringify({ slug: input.slug, title }));
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const previous = (
        await client.query(
          "select job.*,reservation.state quota_state from gallery_copy_job job join artifact_storage_quota_reservation reservation on reservation.id=job.quota_reservation_id where job.copier_user_id=$1 and job.idempotency_key_digest=$2 for update",
          [input.copierUserId, keyDigest],
        )
      ).rows[0];
      if (previous) {
        if (previous.input_fingerprint !== fingerprint)
          throw new GalleryCopyError("idempotency_conflict");
        await client.query("commit");
        return outcome(previous);
      }
      const listing = (
        await client.query(
          `select listing.id,listing.lifecycle_state,listing.review_state,listing.listing_revision,listing.artifact_id,listing.creator_profile_id,revision.version_id,manifest.total_size_bytes
    from gallery_listing listing left join gallery_listing_revision revision on revision.id=listing.current_revision_id left join artifact_version version on version.id=revision.version_id left join content_bundle_manifest manifest on manifest.bundle_id=version.content_bundle_id where listing.opaque_slug=$1 for update of listing`,
          [input.slug],
        )
      ).rows[0];
      if (!listing) throw new GalleryCopyError("not_found");
      if (listing.lifecycle_state === "withdrawn")
        throw new GalleryCopyError("gone");
      const blocked =
        (
          await client.query(
            `select exists(select 1 from gallery_public_sharing_restriction where artifact_id=$1 and state='active') or exists(select 1 from gallery_artifact_takedown where artifact_id=$1 and state='active') blocked`,
            [listing.artifact_id],
          )
        ).rows[0]?.blocked === true;
      if (
        listing.lifecycle_state !== "listed" ||
        !["clear", "reviewing"].includes(listing.review_state) ||
        blocked
      )
        throw new GalleryCopyError("not_found");
      const policy = (
        await client.query(
          "select * from artifact_storage_quota_policy where active for share",
        )
      ).rows[0];
      if (!policy) throw new Error("quota_policy_unavailable");
      const windowStart = new Date(
        Date.now() - Number(policy.copy_rate_window_seconds) * 1000,
      );
      const rate = Number(
        (
          await client.query(
            "select count(*) count from gallery_copy_rate_evidence where copier_user_id=$1 and consumed_at>$2",
            [input.copierUserId, windowStart],
          )
        ).rows[0]?.count ?? 0,
      );
      if (rate >= Number(policy.copy_rate_limit))
        throw new GalleryCopyError("rate_limited");
      await client.query(
        "insert into artifact_storage_quota_account(user_id,policy_revision) values($1,$2) on conflict(user_id) do nothing",
        [input.copierUserId, policy.revision],
      );
      const account = (
        await client.query(
          "select * from artifact_storage_quota_account where user_id=$1 for update",
          [input.copierUserId],
        )
      ).rows[0];
      const bytes = Number(listing.total_size_bytes);
      if (
        Number(account.artifact_usage) + Number(account.artifact_reserved) + 1 >
        Number(policy.artifact_limit)
      )
        throw new GalleryCopyError("artifact_quota_unavailable");
      if (
        Number(account.storage_bytes_usage) +
          Number(account.storage_bytes_reserved) +
          bytes >
        Number(policy.storage_bytes_limit)
      )
        throw new GalleryCopyError("storage_quota_unavailable");
      const id = `gcopy_${randomUUID()}`,
        artifactId = `artifact_${randomUUID()}`,
        versionId = `version_${randomUUID()}`,
        reservationId = `gquota_${randomUUID()}`,
        retentionId = `gretain_${randomUUID()}`;
      const snapshot = {
        listingId: listing.id,
        listingRevision: Number(listing.listing_revision),
        versionId: listing.version_id,
        objectLayoutRevision: "gallery-objects/v1",
        policyRevision: policy.revision,
        destinationOwnerUserId: input.copierUserId,
        destinationArtifactId: artifactId,
        reservedArtifactCount: 1,
        reservedStorageBytes: bytes,
        sourceRetentionReferenceId: retentionId,
      };
      await client.query(
        "insert into artifact_storage_quota_reservation(id,user_id,policy_revision,artifact_count,storage_bytes,expires_at) values($1,$2,$3,1,$4,now()+interval '1 hour')",
        [reservationId, input.copierUserId, policy.revision, bytes],
      );
      await client.query(
        "update artifact_storage_quota_account set artifact_reserved=artifact_reserved+1,storage_bytes_reserved=storage_bytes_reserved+$2,revision=revision+1,updated_at=now() where user_id=$1",
        [input.copierUserId, bytes],
      );
      await client.query(
        `insert into gallery_copy_job(id,copier_user_id,source_listing_id,source_listing_revision,source_version_id,destination_artifact_id,destination_version_id,destination_title,quota_reservation_id,contract_version,input_snapshot,input_snapshot_digest,idempotency_key_digest,input_fingerprint,max_attempts)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'gallery-job/v1',$10,$11,$12,$13,$14)`,
        [
          id,
          input.copierUserId,
          listing.id,
          listing.listing_revision,
          listing.version_id,
          artifactId,
          versionId,
          title,
          reservationId,
          snapshot,
          hash(JSON.stringify(snapshot)),
          keyDigest,
          fingerprint,
          this.maxAttempts,
        ],
      );
      await client.query(
        "insert into gallery_copy_source_retention(id,job_id,source_listing_id,source_version_id) values($1,$2,$3,$4)",
        [retentionId, id, listing.id, listing.version_id],
      );
      await client.query(
        "insert into gallery_copy_rate_evidence(id,copier_user_id,policy_revision,window_started_at,privacy_delete_after,operation_id) values($1,$2,$3,$4,now()+interval '30 days',$5)",
        [
          `gcrate_${randomUUID()}`,
          input.copierUserId,
          policy.revision,
          windowStart,
          id,
        ],
      );
      await client.query("commit");
      return {
        id,
        state: "accepted",
        sourceListingId: listing.id,
        sourceListingRevision: Number(listing.listing_revision),
        sourceVersionId: listing.version_id,
        destinationArtifactId: null,
        quotaState: "held",
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  async recover(
    userId: string,
    slug: string,
    title: string,
    key: string,
  ): Promise<GalleryCopyOutcome | null> {
    const row = (
      await this.pool.query(
        "select job.*,reservation.state quota_state from gallery_copy_job job join artifact_storage_quota_reservation reservation on reservation.id=job.quota_reservation_id where job.copier_user_id=$1 and job.idempotency_key_digest=$2",
        [userId, hash(key)],
      )
    ).rows[0];
    if (!row) return null;
    if (
      row.input_fingerprint !==
      hash(JSON.stringify({ slug, title: title.trim() }))
    )
      throw new GalleryCopyError("idempotency_conflict");
    return outcome(row);
  }
  async get(userId: string, id: string): Promise<GalleryCopyOutcome | null> {
    const row = (
      await this.pool.query(
        "select job.*,reservation.state quota_state from gallery_copy_job job join artifact_storage_quota_reservation reservation on reservation.id=job.quota_reservation_id where job.id=$1 and job.copier_user_id=$2",
        [id, userId],
      )
    ).rows[0];
    return row ? outcome(row) : null;
  }
}
function outcome(row: any): GalleryCopyOutcome {
  return {
    id: row.id,
    state: row.state,
    sourceListingId: row.source_listing_id,
    sourceListingRevision: Number(row.source_listing_revision),
    sourceVersionId: row.source_version_id,
    destinationArtifactId:
      row.state === "ready" ? row.destination_artifact_id : null,
    quotaState: row.quota_state,
  };
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
