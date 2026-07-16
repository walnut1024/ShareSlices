import type { Pool } from "pg";
import type {
  GalleryCopyRepository,
  GalleryCoverQueue,
  GalleryDiscoveryCard,
  GalleryDiscoveryRepository,
  GalleryGovernanceCaseRecord,
  GalleryGovernanceRepository,
  GalleryGrantEvidenceRecord,
  GalleryListingRepository,
  GalleryNotificationRecord,
  GalleryNotificationRepository,
  GalleryProfileRecord,
  GalleryRetentionRepository
} from "../application/gallery/repositories.js";
import type { GalleryCopyProjection, GalleryListingProjection } from "../application/gallery/domain.js";

type Row = Record<string, unknown>;
const integer = (value: unknown): number => Number(value);

function listingProjection(row: Row): GalleryListingProjection {
  return {
    id: String(row.id), artifactId: String(row.artifact_id),
    lifecycle: row.lifecycle_state as GalleryListingProjection["lifecycle"],
    reviewState: row.review_state as GalleryListingProjection["reviewState"],
    closureReason: row.closure_reason as GalleryListingProjection["closureReason"],
    listingRevision: integer(row.listing_revision), committed: null, proposal: null,
    effectiveAccess: { accessible: false, restrictions: ["not_listed"] }
  };
}

export class PostgresGalleryListingRepository implements GalleryListingRepository {
  constructor(private readonly pool: Pool) {}
  async findOwnerListing(ownerUserId: string, artifactId: string): Promise<GalleryListingProjection | null> {
    const result = await this.pool.query("select * from gallery_listing where owner_user_id = $1 and artifact_id = $2 order by created_at desc limit 1", [ownerUserId, artifactId]);
    return result.rows[0] ? listingProjection(result.rows[0]) : null;
  }
  async findByIdForUpdate(listingId: string): Promise<GalleryListingProjection | null> {
    const result = await this.pool.query("select * from gallery_listing where id = $1 for update", [listingId]);
    return result.rows[0] ? listingProjection(result.rows[0]) : null;
  }
  async findProfileByUser(userId: string): Promise<GalleryProfileRecord | null> {
    const { rows } = await this.pool.query("select * from gallery_creator_profile where user_id = $1", [userId]);
    const row = rows[0] as Row | undefined;
    return row ? { id: String(row.id), userId: String(row.user_id), opaqueSlug: String(row.opaque_slug), displayName: String(row.display_name), biography: row.biography as string | null,
      avatar: row.avatar_object_key ? {objectKey: String(row.avatar_object_key), contentType: row.avatar_content_type as "image/png" | "image/jpeg" | "image/webp", width: integer(row.avatar_width), height: integer(row.avatar_height)} : null,
      revision: integer(row.revision), publicAt: row.public_at as Date | null, retiredAt: row.retired_at as Date | null } : null;
  }
  async findGrantEvidence(listingId: string): Promise<GalleryGrantEvidenceRecord[]> {
    const { rows } = await this.pool.query("select * from gallery_permission_grant_acceptance where listing_id = $1 order by accepted_at", [listingId]);
    return rows.map((row: Row) => ({ id: String(row.id), userId: String(row.user_id), listingId: String(row.listing_id), grantVersion: String(row.grant_version), grantTextDigest: String(row.grant_text_digest), acceptedAt: row.accepted_at as Date }));
  }
  async incrementEngagement(listingId: string, kind: "view" | "download" | "copy"): Promise<void> {
    const column = ({ view: "view_count", download: "download_count", copy: "copy_count" } as const)[kind];
    await this.pool.query(`insert into gallery_listing_engagement (listing_id, ${column}) values ($1, 1) on conflict (listing_id) do update set ${column} = gallery_listing_engagement.${column} + 1, updated_at = now()`, [listingId]);
  }
}

export class PostgresGalleryCoverQueue implements GalleryCoverQueue {
  constructor(private readonly pool: Pool) {}
  async enqueue(versionId: string, rendererRevision: string): Promise<Readonly<{coverId: string; state: "pending" | "ready" | "failed"}>> {
    const id = `gcover_${crypto.randomUUID()}`;
    const { rows } = await this.pool.query(`insert into gallery_cover (id, version_id, renderer_revision)
      values ($1, $2, $3) on conflict (version_id, renderer_revision) do update
      set version_id = excluded.version_id returning id, state`, [id, versionId, rendererRevision]);
    await this.pool.query(`insert into gallery_cover_job(id,cover_id,version_id,contract_version,renderer_revision,object_layout_revision)
      values($1,$2,$3,'gallery-job/v1',$4,'gallery-objects/v1') on conflict(cover_id) do nothing`,[`gcoverjob_${crypto.randomUUID()}`,rows[0]?.id,versionId,rendererRevision]);
    return {coverId: String(rows[0]?.id), state: rows[0]?.state};
  }
}

export class PostgresGalleryDiscoveryRepository implements GalleryDiscoveryRepository {
  constructor(private readonly pool: Pool) {}
  async listEligible(input: Parameters<GalleryDiscoveryRepository["listEligible"]>[0]): Promise<GalleryDiscoveryCard[]> {
    const values: unknown[] = [input.limit];
    let filter = "";
    if (input.mode === "search") { values.push(`%${input.query ?? ""}%`); filter = `and (revision.public_title ilike $2 or revision.public_description ilike $2 or profile.display_name ilike $2)`; }
    if (input.mode === "tag") { values.push(input.query ?? ""); filter = "and $2 = any(revision.tags)"; }
    if (input.mode === "creator") { values.push(input.query ?? ""); filter = "and profile.opaque_slug = $2"; }
    const { rows } = await this.pool.query(`select listing.id as listing_id, listing.opaque_slug, revision.public_title, revision.public_description, revision.tags, profile.opaque_slug as creator_slug, profile.display_name, listing.created_at from gallery_listing listing join gallery_listing_revision revision on revision.id = listing.current_revision_id join gallery_creator_profile profile on profile.id = listing.creator_profile_id where listing.lifecycle_state = 'listed' and listing.review_state <> 'restricted' and profile.retired_at is null ${filter} order by listing.created_at desc, listing.id desc limit $1`, values);
    return rows.map((row: Row) => ({ listingId: String(row.listing_id), opaqueSlug: String(row.opaque_slug), title: String(row.public_title), description: row.public_description as string | null, tags: row.tags as string[], creatorSlug: String(row.creator_slug), creatorDisplayName: String(row.display_name), createdAt: row.created_at as Date }));
  }
}

export class PostgresGalleryGovernanceRepository implements GalleryGovernanceRepository {
  constructor(private readonly pool: Pool) {}
  async findCase(caseId: string): Promise<GalleryGovernanceCaseRecord | null> {
    const { rows } = await this.pool.query("select id, case_kind, state, evidence_snapshot, evidence_digest from gallery_governance_case where id = $1", [caseId]);
    const row = rows[0] as Row | undefined;
    return row ? { id: String(row.id), kind: String(row.case_kind), state: row.state as GalleryGovernanceCaseRecord["state"], evidenceSnapshot: row.evidence_snapshot as Record<string, unknown>, evidenceDigest: String(row.evidence_digest) } : null;
  }
  async hasActiveAdministratorAuthority(userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("select 1 from gallery_administrator_authority where user_id = $1 and revoked_at is null", [userId]);
    return rowCount === 1;
  }
  async hasEffectiveBlock(artifactId: string): Promise<boolean> {
    const { rows } = await this.pool.query("select exists(select 1 from gallery_public_sharing_restriction where artifact_id = $1 and state = 'active') or exists(select 1 from gallery_artifact_takedown where artifact_id = $1 and state = 'active') as blocked", [artifactId]);
    return rows[0]?.blocked === true;
  }
}

export class PostgresGalleryCopyRepository implements GalleryCopyRepository {
  constructor(private readonly pool: Pool) {}
  async findOperation(copierUserId: string, operationId: string): Promise<GalleryCopyProjection | null> {
    const { rows } = await this.pool.query("select job.*, reservation.state as quota_state from gallery_copy_job job join artifact_storage_quota_reservation reservation on reservation.id = job.quota_reservation_id where job.id = $1 and job.copier_user_id = $2", [operationId, copierUserId]);
    const row = rows[0] as Row | undefined;
    return row ? { id: String(row.id), state: row.state as GalleryCopyProjection["state"], sourceListingId: String(row.source_listing_id), sourceListingRevision: integer(row.source_listing_revision), sourceVersionId: String(row.source_version_id), destinationArtifactId: row.state === "ready" ? String(row.destination_artifact_id) : null, quotaState: row.quota_state as GalleryCopyProjection["quotaState"] } : null;
  }
  async hasLiveSourceReference(versionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("select 1 from gallery_copy_source_retention where source_version_id = $1 and released_at is null limit 1", [versionId]);
    return rowCount === 1;
  }
  async findRootProvenance(artifactId: string): Promise<Readonly<Record<string, unknown>> | null> {
    const { rows } = await this.pool.query("select * from artifact_gallery_provenance where artifact_id = $1", [artifactId]);
    return rows[0] ?? null;
  }
}

export class PostgresGalleryNotificationRepository implements GalleryNotificationRepository {
  constructor(private readonly pool: Pool) {}
  async listForRecipient(userId: string, limit: number): Promise<GalleryNotificationRecord[]> {
    const { rows } = await this.pool.query("select id, category, rule_code, current_effect, created_at from gallery_notification where recipient_user_id = $1 order by created_at desc, id desc limit $2", [userId, limit]);
    return rows.map((row: Row) => ({ id: String(row.id), category: String(row.category), ruleCode: String(row.rule_code), currentEffect: String(row.current_effect), createdAt: row.created_at as Date }));
  }
}

export class PostgresGalleryRetentionRepository implements GalleryRetentionRepository {
  constructor(private readonly pool: Pool) {}
  async hasLiveDownloadLease(versionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("select 1 from gallery_download_source_lease where version_id = $1 and state = 'active' and expires_at > now() limit 1", [versionId]);
    return rowCount === 1;
  }
  async listExpiredPrivacyRecords(limit: number): Promise<readonly string[]> {
    const { rows } = await this.pool.query("select id from gallery_privacy_retention_record where deleted_at is null and retained_until <= now() order by retained_until limit $1", [limit]);
    return rows.map((row: Row) => String(row.id));
  }
}
