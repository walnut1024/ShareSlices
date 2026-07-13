import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./client.js";
import * as schema from "./schema.js";

const CAPTURE_SESSION_SECONDS = 30;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type ThumbnailAssetRecord = {
  objectKey: string;
  contentType: string;
};

export type CaptureSession = {
  versionId: string;
  token: string;
  expiresAt: Date;
};

export function createArtifactThumbnailRepository(database = db) {
  return {
    async findOwned(ownerUserId: string, versionId: string): Promise<ThumbnailAssetRecord | null> {
      const rows = await database
        .select({ objectKey: schema.artifactThumbnail.objectKey, contentType: schema.artifactThumbnail.contentType })
        .from(schema.artifactThumbnail)
        .innerJoin(schema.artifactVersion, eq(schema.artifactVersion.id, schema.artifactThumbnail.versionId))
        .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
        .where(and(eq(schema.artifactThumbnail.versionId, versionId), eq(schema.artifact.ownerUserId, ownerUserId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async consumeGrant(rawToken: string, versionId: string): Promise<CaptureSession | null> {
      const sessionToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + CAPTURE_SESSION_SECONDS * 1000);
      const rows = await database
        .update(schema.artifactThumbnailCaptureGrant)
        .set({ consumedAt: new Date(), sessionTokenHash: hash(sessionToken), sessionExpiresAt: expiresAt })
        .where(and(
          eq(schema.artifactThumbnailCaptureGrant.tokenHash, hash(rawToken)),
          eq(schema.artifactThumbnailCaptureGrant.versionId, versionId),
          isNull(schema.artifactThumbnailCaptureGrant.consumedAt),
          gt(schema.artifactThumbnailCaptureGrant.expiresAt, new Date())
        ))
        .returning({ versionId: schema.artifactThumbnailCaptureGrant.versionId });
      return rows[0] ? { versionId: rows[0].versionId, token: sessionToken, expiresAt } : null;
    },

    async resolveSession(rawToken: string, versionId: string): Promise<boolean> {
      const row = await database.query.artifactThumbnailCaptureGrant.findFirst({
        columns: { tokenHash: true },
        where: and(
          eq(schema.artifactThumbnailCaptureGrant.versionId, versionId),
          eq(schema.artifactThumbnailCaptureGrant.sessionTokenHash, hash(rawToken)),
          gt(schema.artifactThumbnailCaptureGrant.sessionExpiresAt, new Date())
        )
      });
      return row !== undefined;
    },

    async findVersionAsset(versionId: string, requestedPath: string): Promise<ThumbnailAssetRecord | null> {
      const path = requestedPath === ""
        ? database.select({ path: schema.artifactManifest.entryPath }).from(schema.artifactManifest).where(eq(schema.artifactManifest.versionId, versionId))
        : Promise.resolve([{ path: requestedPath }]);
      const resolved = (await path)[0]?.path;
      if (!resolved) return null;
      const row = await database.query.artifactAsset.findFirst({
        columns: { objectKey: true, contentType: true },
        where: and(eq(schema.artifactAsset.versionId, versionId), eq(schema.artifactAsset.path, resolved))
      });
      return row ?? null;
    }
  };
}

export type ArtifactThumbnailRepository = ReturnType<typeof createArtifactThumbnailRepository>;
