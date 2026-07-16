import type { Pool } from "pg";
import type { GalleryProfileRecord } from "./repositories.js";

export type SafeGalleryAvatar = Readonly<{objectKey: string; contentType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number}>;
export type GalleryProfileFields = Readonly<{displayName: string; biography: string | null; avatar: SafeGalleryAvatar | null}>;

export class GalleryProfileError extends Error {
  constructor(readonly code: "invalid_profile" | "profile_revision_conflict" | "profile_not_found") { super(code); }
}

export function normalizeProfileFields(input: GalleryProfileFields): GalleryProfileFields {
  const displayName = input.displayName.trim();
  const biography = input.biography?.trim() || null;
  if (!displayName || displayName.length > 80 || (biography?.length ?? 0) > 500) throw new GalleryProfileError("invalid_profile");
  if (input.avatar && (!input.avatar.objectKey || input.avatar.width <= 0 || input.avatar.height <= 0)) throw new GalleryProfileError("invalid_profile");
  return {displayName, biography, avatar: input.avatar};
}

export class GalleryCreatorProfileService {
  constructor(private readonly pool: Pool) {}

  async getOwn(userId: string): Promise<GalleryProfileRecord | null> {
    const { rows } = await this.pool.query("select * from gallery_creator_profile where user_id = $1", [userId]);
    return rows[0] ? this.record(rows[0]) : null;
  }

  async stageForFirstShare(input: Readonly<{profileId: string; userId: string; opaqueSlug: string; expectedRevision: number | null; fields: GalleryProfileFields}>): Promise<GalleryProfileRecord> {
    const fields = normalizeProfileFields(input.fields);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from \"user\" where id = $1 for update", [input.userId]);
      const { rows } = await client.query("select * from gallery_creator_profile where user_id = $1 for update", [input.userId]);
      const existing = rows[0];
      if (existing) {
        const same = existing.display_name === fields.displayName && existing.biography === fields.biography
          && existing.avatar_object_key === (fields.avatar?.objectKey ?? null)
          && existing.avatar_content_type === (fields.avatar?.contentType ?? null)
          && existing.avatar_width === (fields.avatar?.width ?? null)
          && existing.avatar_height === (fields.avatar?.height ?? null);
        if (input.expectedRevision === null || Number(existing.revision) !== input.expectedRevision) throw new GalleryProfileError("profile_revision_conflict");
        if (!same) {
          const { rows: updated } = await client.query(`update gallery_creator_profile set display_name=$2, biography=$3,
            avatar_object_key=$4, avatar_content_type=$5, avatar_width=$6, avatar_height=$7,
            revision=revision+1, updated_at=now() where id=$1 returning *`, [existing.id, fields.displayName,
            fields.biography, fields.avatar?.objectKey ?? null, fields.avatar?.contentType ?? null,
            fields.avatar?.width ?? null, fields.avatar?.height ?? null]);
          await client.query("commit");
          return this.record(updated[0]);
        }
        await client.query("commit");
        return this.record(existing);
      }
      if (input.expectedRevision !== null) throw new GalleryProfileError("profile_revision_conflict");
      const { rows: inserted } = await client.query(`insert into gallery_creator_profile
        (id, user_id, opaque_slug, display_name, biography, avatar_object_key, avatar_content_type, avatar_width, avatar_height)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [input.profileId, input.userId, input.opaqueSlug, fields.displayName, fields.biography, fields.avatar?.objectKey ?? null, fields.avatar?.contentType ?? null, fields.avatar?.width ?? null, fields.avatar?.height ?? null]);
      await client.query("commit");
      return this.record(inserted[0]);
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async update(userId: string, expectedRevision: number, fields: GalleryProfileFields): Promise<GalleryProfileRecord> {
    const normalized = normalizeProfileFields(fields);
    const { rows } = await this.pool.query(`update gallery_creator_profile set display_name = $3,
      biography = $4, avatar_object_key = $5, avatar_content_type = $6, avatar_width = $7,
      avatar_height = $8, revision = revision + 1, updated_at = now()
      where user_id = $1 and revision = $2 and retired_at is null returning *`, [userId, expectedRevision, normalized.displayName, normalized.biography, normalized.avatar?.objectKey ?? null, normalized.avatar?.contentType ?? null, normalized.avatar?.width ?? null, normalized.avatar?.height ?? null]);
    if (rows[0]) return this.record(rows[0]);
    if (await this.getOwn(userId)) throw new GalleryProfileError("profile_revision_conflict");
    throw new GalleryProfileError("profile_not_found");
  }

  async updateFromUpload(input: Readonly<{userId: string; expectedRevision: number; displayName: string; biography: string | null; avatarUploadId?: string | null}>): Promise<GalleryProfileRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const {rows} = await client.query("select * from gallery_creator_profile where user_id=$1 and retired_at is null for update", [input.userId]);
      const current = rows[0];
      if (!current) throw new GalleryProfileError("profile_not_found");
      if (Number(current.revision) !== input.expectedRevision) throw new GalleryProfileError("profile_revision_conflict");
      let avatar: SafeGalleryAvatar | null = current.avatar_object_key ? {
        objectKey: String(current.avatar_object_key), contentType: current.avatar_content_type,
        width: Number(current.avatar_width), height: Number(current.avatar_height),
      } : null;
      if (input.avatarUploadId === null) avatar = null;
      else if (input.avatarUploadId) {
        const upload = (await client.query(`select * from gallery_avatar_upload
          where id=$1 and user_id=$2 and state='staged' and expires_at>now() for update`, [input.avatarUploadId, input.userId])).rows[0];
        if (!upload) throw new GalleryProfileError("invalid_profile");
        avatar = {objectKey: String(upload.object_key), contentType: upload.content_type, width: Number(upload.width), height: Number(upload.height)};
        await client.query("update gallery_avatar_upload set state='consumed',consumed_at=now() where id=$1", [input.avatarUploadId]);
      }
      const normalized = normalizeProfileFields({displayName: input.displayName, biography: input.biography, avatar});
      const updated = (await client.query(`update gallery_creator_profile set display_name=$3,biography=$4,
        avatar_object_key=$5,avatar_content_type=$6,avatar_width=$7,avatar_height=$8,revision=revision+1,updated_at=now()
        where user_id=$1 and revision=$2 returning *`, [input.userId, input.expectedRevision, normalized.displayName,
        normalized.biography, avatar?.objectKey ?? null, avatar?.contentType ?? null, avatar?.width ?? null, avatar?.height ?? null])).rows[0];
      await client.query("commit");
      return this.record(updated);
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async publicAvatar(opaqueSlug: string): Promise<SafeGalleryAvatar | null> {
    const {rows} = await this.pool.query(`select avatar_object_key,avatar_content_type,avatar_width,avatar_height
      from gallery_creator_profile where opaque_slug=$1 and public_at is not null and retired_at is null`, [opaqueSlug]);
    const row = rows[0];
    return row?.avatar_object_key ? {objectKey: String(row.avatar_object_key), contentType: row.avatar_content_type,
      width: Number(row.avatar_width), height: Number(row.avatar_height)} : null;
  }

  private record(row: Record<string, unknown>): GalleryProfileRecord {
    return {id: String(row.id), userId: String(row.user_id), opaqueSlug: String(row.opaque_slug), displayName: String(row.display_name), biography: row.biography as string | null,
      avatar: row.avatar_object_key ? {objectKey: String(row.avatar_object_key), contentType: row.avatar_content_type as SafeGalleryAvatar["contentType"], width: Number(row.avatar_width), height: Number(row.avatar_height)} : null,
      revision: Number(row.revision), publicAt: row.public_at as Date | null, retiredAt: row.retired_at as Date | null};
  }
}
