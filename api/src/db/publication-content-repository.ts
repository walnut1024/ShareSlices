import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  PublicationContentRepository,
  PublicationExpiration,
  PublicationView,
  PublishResult,
  ShareLinkAccessRecord,
  ShareResolution
} from "../application/artifacts/publication-viewer.js";
import { db } from "./client.js";
import * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;

function publicationView(row: typeof schema.artifactPublication.$inferSelect): PublicationView {
  return {
    id: row.id,
    versionId: row.versionId,
    publishedAt: row.createdAt,
    expirationKind: row.expirationKind as PublicationView["expirationKind"],
    durationSeconds: row.durationSeconds,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
    endReason: row.endReason as PublicationView["endReason"]
  };
}

function expirationValues(expiration: PublicationExpiration, now: Date) {
  if (expiration.kind === "permanent") {
    return { expirationKind: "permanent", durationSeconds: null, expiresAt: null } as const;
  }
  if (expiration.kind === "duration") {
    return {
      expirationKind: "duration",
      durationSeconds: expiration.durationSeconds,
      expiresAt: new Date(now.getTime() + expiration.durationSeconds * 1000)
    } as const;
  }
  return { expirationKind: "exact", durationSeconds: null, expiresAt: expiration.expiresAt } as const;
}

export function createPublicationContentRepository(
  database: Database = db
): PublicationContentRepository {
  return {
    async findOwnedReadyVersion(ownerUserId, versionId) {
      const [row] = await database
        .select({ id: schema.artifactVersion.id, artifactId: schema.artifactVersion.artifactId })
        .from(schema.artifactVersion)
        .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
        .where(
          and(
            eq(schema.artifactVersion.id, versionId),
            eq(schema.artifactVersion.state, "ready"),
            eq(schema.artifact.ownerUserId, ownerUserId)
          )
        )
        .limit(1);
      return row ?? null;
    },

    async findAsset(versionId, path) {
      const row = await database.query.artifactAsset.findFirst({
        where: and(eq(schema.artifactAsset.versionId, versionId), eq(schema.artifactAsset.path, path))
      });
      return row ?? null;
    },

    async findEntryAsset(versionId) {
      const [row] = await database
        .select({
          versionId: schema.artifactAsset.versionId,
          path: schema.artifactAsset.path,
          objectKey: schema.artifactAsset.objectKey,
          sizeBytes: schema.artifactAsset.sizeBytes,
          contentType: schema.artifactAsset.contentType,
          sha256: schema.artifactAsset.sha256
        })
        .from(schema.artifactManifest)
        .innerJoin(
          schema.artifactAsset,
          and(
            eq(schema.artifactAsset.versionId, schema.artifactManifest.versionId),
            eq(schema.artifactAsset.path, schema.artifactManifest.entryPath)
          )
        )
        .where(eq(schema.artifactManifest.versionId, versionId))
        .limit(1);
      return row ?? null;
    },

    async findOwnedVersionExport(ownerUserId, versionId) {
      const [version] = await database
        .select({ artifactId: schema.artifact.id, artifactName: schema.artifact.name })
        .from(schema.artifactVersion)
        .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
        .where(
          and(
            eq(schema.artifactVersion.id, versionId),
            eq(schema.artifactVersion.state, "ready"),
            eq(schema.artifact.ownerUserId, ownerUserId)
          )
        )
        .limit(1);
      if (!version) return null;
      const assets = await database.query.artifactAsset.findMany({
        where: eq(schema.artifactAsset.versionId, versionId),
        orderBy: [schema.artifactAsset.path]
      });
      return { artifactId: version.artifactId, artifactName: version.artifactName, assets };
    },

    async publish(input): Promise<PublishResult> {
      return database.transaction(async (transaction) => {
        const [artifact] = await transaction
          .select({ id: schema.artifact.id })
          .from(schema.artifact)
          .where(and(eq(schema.artifact.id, input.artifactId), eq(schema.artifact.ownerUserId, input.ownerUserId)))
          .for("update")
          .limit(1);
        if (!artifact) return { kind: "artifact_not_found" };

        const existing = await transaction.query.artifactIdempotencyRecord.findFirst({
          where: and(
            eq(schema.artifactIdempotencyRecord.ownerUserId, input.ownerUserId),
            eq(schema.artifactIdempotencyRecord.operation, "publish"),
            eq(schema.artifactIdempotencyRecord.targetResourceId, input.artifactId),
            eq(schema.artifactIdempotencyRecord.key, input.idempotencyKey)
          )
        });
        if (existing) {
          if (existing.requestHash !== input.requestHash) return { kind: "idempotency_conflict" };
          if (existing.state !== "completed" || !existing.responseBody) return { kind: "operation_in_progress" };
          const storedPublication = existing.responseBody.publication as Record<string, unknown>;
          const storedLink = existing.responseBody.shareLink as Record<string, unknown>;
          if (
            typeof storedPublication.id !== "string" ||
            typeof storedPublication.versionId !== "string" ||
            typeof storedPublication.publishedAt !== "string" ||
            typeof storedPublication.expirationKind !== "string" ||
            typeof storedLink.shareSlug !== "string"
          ) throw new Error("Completed Publish idempotency response is invalid.");
          return {
            kind: "published",
            publication: {
              id: storedPublication.id,
              versionId: storedPublication.versionId,
              publishedAt: new Date(storedPublication.publishedAt),
              expirationKind: storedPublication.expirationKind as PublicationView["expirationKind"],
              durationSeconds: typeof storedPublication.durationSeconds === "number" ? storedPublication.durationSeconds : null,
              expiresAt: typeof storedPublication.expiresAt === "string" ? new Date(storedPublication.expiresAt) : null,
              endedAt: null,
              endReason: null
            },
            shareLink: { shareSlug: storedLink.shareSlug, state: "active" }
          };
        }

        const [version] = await transaction
          .select({ id: schema.artifactVersion.id })
          .from(schema.artifactVersion)
          .where(and(
            eq(schema.artifactVersion.id, input.versionId),
            eq(schema.artifactVersion.artifactId, input.artifactId),
            eq(schema.artifactVersion.state, "ready")
          ))
          .limit(1);
        if (!version) return { kind: "version_not_ready" };

        const now = new Date();
        const expiration = expirationValues(input.expiration, now);
        if (expiration.expiresAt !== null && expiration.expiresAt <= now) return { kind: "version_not_ready" };

        await transaction.insert(schema.artifactIdempotencyRecord).values({
          id: `idem_${randomUUID().replaceAll("-", "")}`,
          ownerUserId: input.ownerUserId,
          operation: "publish",
          targetResourceId: input.artifactId,
          key: input.idempotencyKey,
          requestHash: input.requestHash
        });

        const current = await transaction.query.artifactPublication.findFirst({
          where: and(eq(schema.artifactPublication.artifactId, input.artifactId), isNull(schema.artifactPublication.endedAt)),
          orderBy: [desc(schema.artifactPublication.createdAt)]
        });
        if (current) {
          await transaction.update(schema.artifactPublication)
            .set({ endedAt: now, endReason: "superseded" })
            .where(eq(schema.artifactPublication.id, current.id));
        }

        let link = await transaction.query.artifactShareLink.findFirst({
          where: and(eq(schema.artifactShareLink.artifactId, input.artifactId), eq(schema.artifactShareLink.status, "active")),
          orderBy: [desc(schema.artifactShareLink.createdAt)]
        });
        if (input.link.mode === "replace" && link) {
          await transaction.update(schema.artifactShareLink)
            .set({ status: "retired", retiredAt: now })
            .where(eq(schema.artifactShareLink.id, link.id));
          link = undefined;
        }
        if (!link) {
          const [createdLink] = await transaction.insert(schema.artifactShareLink).values({
            id: `link_${randomUUID().replaceAll("-", "")}`,
            artifactId: input.artifactId,
            slug: randomBytes(16).toString("base64url")
          }).returning();
          if (!createdLink) throw new Error("Share link insert returned no row.");
          link = createdLink;
        }

        const [created] = await transaction.insert(schema.artifactPublication).values({
          id: input.id,
          artifactId: input.artifactId,
          versionId: input.versionId,
          publishedByUserId: input.ownerUserId,
          ...expiration
        }).returning();
        if (!created) throw new Error("Publication insert returned no row.");
        const publication = publicationView(created);
        const shareLink: ShareLinkAccessRecord = { shareSlug: link.slug, state: "active" };
        const responseBody = {
          publication: {
            id: publication.id,
            versionId: publication.versionId,
            publishedAt: publication.publishedAt.toISOString(),
            expirationKind: publication.expirationKind,
            durationSeconds: publication.durationSeconds,
            expiresAt: publication.expiresAt?.toISOString() ?? null
          },
          shareLink
        };
        await transaction.update(schema.artifactIdempotencyRecord)
          .set({ state: "completed", responseStatus: 201, responseBody, completedAt: now })
          .where(and(
            eq(schema.artifactIdempotencyRecord.ownerUserId, input.ownerUserId),
            eq(schema.artifactIdempotencyRecord.operation, "publish"),
            eq(schema.artifactIdempotencyRecord.targetResourceId, input.artifactId),
            eq(schema.artifactIdempotencyRecord.key, input.idempotencyKey)
          ));
        return { kind: "published", publication, shareLink };
      });
    },

    async unpublish(ownerUserId, artifactId, publicationId) {
      return database.transaction(async (transaction) => {
        const artifact = await transaction.query.artifact.findFirst({
          columns: { id: true },
          where: and(eq(schema.artifact.id, artifactId), eq(schema.artifact.ownerUserId, ownerUserId))
        });
        if (!artifact) {
          return false;
        }
        await transaction
          .update(schema.artifactPublication)
          .set({ endedAt: new Date(), endReason: "unpublished" })
          .where(
            and(
              eq(schema.artifactPublication.id, publicationId),
              eq(schema.artifactPublication.artifactId, artifactId),
              isNull(schema.artifactPublication.endedAt)
            )
          );
        return true;
      });
    },

    async updateExpiration(ownerUserId, artifactId, publicationId, expiration) {
      return database.transaction(async (transaction) => {
        const [artifact] = await transaction.select({ id: schema.artifact.id })
          .from(schema.artifact)
          .where(and(eq(schema.artifact.id, artifactId), eq(schema.artifact.ownerUserId, ownerUserId)))
          .for("update")
          .limit(1);
        if (!artifact) return null;
        const now = new Date();
        const values = expirationValues(expiration, now);
        if (values.expiresAt !== null && values.expiresAt <= now) return null;
        const [updated] = await transaction.update(schema.artifactPublication)
          .set(values)
          .where(and(
            eq(schema.artifactPublication.id, publicationId),
            eq(schema.artifactPublication.artifactId, artifactId),
            isNull(schema.artifactPublication.endedAt)
          ))
          .returning();
        return updated ? publicationView(updated) : null;
      });
    },

    async resolveShareSlug(shareSlug): Promise<ShareResolution> {
      const link = await database.query.artifactShareLink.findFirst({
        where: eq(schema.artifactShareLink.slug, shareSlug)
      });
      if (!link) {
        return { kind: "unknown" };
      }
      if (link.status === "retired") {
        return { kind: "retired" };
      }
      const publication = await database.query.artifactPublication.findFirst({
        where: eq(schema.artifactPublication.artifactId, link.artifactId),
        orderBy: [desc(schema.artifactPublication.createdAt)]
      });
      if (!publication || publication.endReason === "unpublished") return { kind: "unpublished" };
      if (publication.endedAt !== null) return { kind: "unpublished" };
      if (publication.expiresAt !== null && publication.expiresAt <= new Date()) return { kind: "expired" };
      return { kind: "published", versionId: publication.versionId };
    }
  };
}
