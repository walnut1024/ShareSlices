import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Pool } from "pg";
import type { ObjectStorage } from "../../storage/object-storage.js";
import { inspectSafeAvatar } from "./safe-avatar.js";

export class GalleryAvatarError extends Error {
  constructor(readonly code: "invalid_gallery_avatar" | "gallery_avatar_not_found") {
    super(code);
  }
}

export class GalleryAvatarService {
  constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly storage: Pick<
      ObjectStorage,
      "readCommittedObject" | "writeStagingObject"
    >,
  ) {}

  async stageUpload(
    userId: string,
    bytes: Uint8Array,
    declaredContentType: string,
  ): Promise<{ avatarUploadId: string; width: number; height: number }> {
    if (bytes.byteLength < 1 || bytes.byteLength > 2_097_152)
      throw new GalleryAvatarError("invalid_gallery_avatar");
    let image: ReturnType<typeof inspectSafeAvatar>;
    try {
      image = inspectSafeAvatar(bytes, declaredContentType);
    } catch {
      throw new GalleryAvatarError("invalid_gallery_avatar");
    }
    const id = `gallery_avatar_${randomUUID()}`;
    const objectKey = `gallery-avatars/${userId}/${id}`;
    await this.storage.writeStagingObject({
      key: objectKey,
      body: Readable.from(bytes),
      contentType: image.contentType,
    });
    await this.pool.query(
      `insert into gallery_avatar_upload(id,user_id,object_key,content_type,width,height,size_bytes)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        userId,
        objectKey,
        image.contentType,
        image.width,
        image.height,
        bytes.byteLength,
      ],
    );
    return { avatarUploadId: id, width: image.width, height: image.height };
  }

  async readPublic(
    creatorSlug: string,
  ): Promise<{ body: AsyncIterable<Uint8Array>; contentType: string }> {
    const { rows } = await this.pool.query(
      `select avatar_object_key,avatar_content_type from gallery_creator_profile
       where opaque_slug=$1 and public_at is not null and retired_at is null`,
      [creatorSlug],
    );
    const avatar = rows[0];
    if (!avatar?.avatar_object_key)
      throw new GalleryAvatarError("gallery_avatar_not_found");
    const object = await this.storage.readCommittedObject(
      String(avatar.avatar_object_key),
    );
    return {
      body: object.body,
      contentType: String(avatar.avatar_content_type),
    };
  }
}
