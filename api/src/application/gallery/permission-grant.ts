import { createHash } from "node:crypto";
import type { Pool } from "pg";

export const galleryPermissionBundle = ["view", "gallery_download", "save_a_copy"] as const;

export type GalleryPermissionGrantRecord = Readonly<{
  version: string;
  exactText: string;
  textDigest: string;
  permissions: typeof galleryPermissionBundle;
  requiresRenewalOnNextProposal: boolean;
}>;

export type GalleryPermissionAcceptanceInput = Readonly<{
  acceptanceId: string;
  userId: string;
  listingId: string;
  versionId: string;
  grantVersion: string;
  accepted: true;
  permissions?: readonly string[];
  creatorLicense?: string;
}>;

export type GalleryGrantErrorCode = "no_current_gallery_grant" | "stale_gallery_grant" | "gallery_permission_bundle_fixed";

export class GalleryGrantError extends Error {
  constructor(readonly code: GalleryGrantErrorCode) { super(code); }
}

export function validateGalleryPermissionAcceptance(current: GalleryPermissionGrantRecord | null, input: GalleryPermissionAcceptanceInput): GalleryPermissionGrantRecord {
  if (!current) throw new GalleryGrantError("no_current_gallery_grant");
  if (input.grantVersion !== current.version) throw new GalleryGrantError("stale_gallery_grant");
  if (input.creatorLicense || (input.permissions && input.permissions.join("\0") !== galleryPermissionBundle.join("\0"))) throw new GalleryGrantError("gallery_permission_bundle_fixed");
  return current;
}

export class GalleryPermissionGrantService {
  constructor(private readonly pool: Pool) {}

  async current(): Promise<GalleryPermissionGrantRecord | null> {
    const { rows } = await this.pool.query("select * from gallery_permission_grant where active");
    const row = rows[0];
    return row ? {version: row.version, exactText: row.exact_text, textDigest: row.text_digest, permissions: galleryPermissionBundle, requiresRenewalOnNextProposal: row.requires_renewal_on_next_proposal} : null;
  }

  async accept(input: GalleryPermissionAcceptanceInput): Promise<string> {
    const current = validateGalleryPermissionAcceptance(await this.current(), input);
    const digest = createHash("sha256").update(current.exactText).digest("hex");
    if (digest !== current.textDigest) throw new Error("gallery_grant_digest_mismatch");
    await this.pool.query(`insert into gallery_permission_grant_acceptance
      (id, user_id, listing_id, version_id, grant_version, grant_text_digest)
      values ($1, $2, $3, $4, $5, $6)`, [input.acceptanceId, input.userId, input.listingId, input.versionId, current.version, current.textDigest]);
    return input.acceptanceId;
  }

  async history(listingId: string): Promise<readonly Readonly<{grantVersion: string; versionId: string | null; acceptedAt: Date}>[]> {
    const { rows } = await this.pool.query("select grant_version, version_id, accepted_at from gallery_permission_grant_acceptance where listing_id = $1 order by accepted_at", [listingId]);
    return rows.map((row) => ({grantVersion: row.grant_version, versionId: row.version_id, acceptedAt: row.accepted_at}));
  }
}
