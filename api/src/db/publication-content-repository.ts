import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  PublicationContentRepository,
  PublicationView,
  PublishResult,
  ShareResolution
} from "../application/artifacts/publication-viewer.js";
import { db } from "./client.js";
import * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;

function publicationView(row: typeof schema.artifactPublication.$inferSelect): PublicationView {
  return { id: row.id, versionId: row.versionId, publishedAt: row.createdAt };
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
        .select({ artifactName: schema.artifact.name })
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
      return { artifactName: version.artifactName, assets };
    },

    async publish(input): Promise<PublishResult> {
      return database.transaction(async (transaction) => {
        const [artifact] = await transaction
          .select({ id: schema.artifact.id })
          .from(schema.artifact)
          .where(
            and(eq(schema.artifact.id, input.artifactId), eq(schema.artifact.ownerUserId, input.ownerUserId))
          )
          .for("update")
          .limit(1);
        if (!artifact) {
          return { kind: "artifact_not_found" };
        }

        const existingIdempotency = await transaction.query.artifactIdempotencyRecord.findFirst({
          where: and(
            eq(schema.artifactIdempotencyRecord.ownerUserId, input.ownerUserId),
            eq(schema.artifactIdempotencyRecord.operation, "publish"),
            eq(schema.artifactIdempotencyRecord.targetResourceId, input.artifactId),
            eq(schema.artifactIdempotencyRecord.key, input.idempotencyKey)
          )
        });
        if (existingIdempotency) {
          if (existingIdempotency.requestHash !== input.requestHash) {
            return { kind: "idempotency_conflict" };
          }
          if (existingIdempotency.state !== "completed" || !existingIdempotency.responseBody) {
            return { kind: "operation_in_progress" };
          }
          const response = existingIdempotency.responseBody.publication as
            | { id?: unknown; versionId?: unknown; publishedAt?: unknown }
            | undefined;
          if (
            !response ||
            typeof response.id !== "string" ||
            typeof response.versionId !== "string" ||
            typeof response.publishedAt !== "string"
          ) {
            throw new Error("Completed Publish idempotency response is invalid.");
          }
          return {
            kind: "published",
            publication: {
              id: response.id,
              versionId: response.versionId,
              publishedAt: new Date(response.publishedAt)
            }
          };
        }

        const [version] = await transaction
          .select({ id: schema.artifactVersion.id })
          .from(schema.artifactVersion)
          .where(
            and(
              eq(schema.artifactVersion.id, input.versionId),
              eq(schema.artifactVersion.artifactId, input.artifactId),
              eq(schema.artifactVersion.state, "ready")
            )
          )
          .limit(1);
        if (!version) {
          return { kind: "version_not_ready" };
        }

        await transaction.insert(schema.artifactIdempotencyRecord).values({
          id: `idem_${crypto.randomUUID().replaceAll("-", "")}`,
          ownerUserId: input.ownerUserId,
          operation: "publish",
          targetResourceId: input.artifactId,
          key: input.idempotencyKey,
          requestHash: input.requestHash
        });

        const current = await transaction.query.artifactPublication.findFirst({
          where: and(
            eq(schema.artifactPublication.artifactId, input.artifactId),
            isNull(schema.artifactPublication.endedAt)
          ),
          orderBy: [desc(schema.artifactPublication.createdAt)]
        });
        let publication: PublicationView;
        if (current?.versionId === input.versionId) {
          publication = publicationView(current);
        } else {
          if (current) {
            await transaction
              .update(schema.artifactPublication)
              .set({ endedAt: new Date() })
              .where(eq(schema.artifactPublication.id, current.id));
          }
          const [created] = await transaction
            .insert(schema.artifactPublication)
            .values({
              id: input.id,
              artifactId: input.artifactId,
              versionId: input.versionId,
              publishedByUserId: input.ownerUserId
            })
            .returning();
          if (!created) {
            throw new Error("Publication insert returned no row.");
          }
          publication = publicationView(created);
        }
        const responseBody = {
          publication: {
            id: publication.id,
            versionId: publication.versionId,
            publishedAt: publication.publishedAt.toISOString()
          }
        };
        await transaction
          .update(schema.artifactIdempotencyRecord)
          .set({ state: "completed", responseStatus: 201, responseBody, completedAt: new Date() })
          .where(
            and(
              eq(schema.artifactIdempotencyRecord.ownerUserId, input.ownerUserId),
              eq(schema.artifactIdempotencyRecord.operation, "publish"),
              eq(schema.artifactIdempotencyRecord.targetResourceId, input.artifactId),
              eq(schema.artifactIdempotencyRecord.key, input.idempotencyKey)
            )
          );
        return { kind: "published", publication };
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
          .set({ endedAt: new Date() })
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

    async resolveShareSlug(shareSlug): Promise<ShareResolution> {
      const link = await database.query.artifactShareLink.findFirst({
        where: eq(schema.artifactShareLink.slug, shareSlug)
      });
      if (!link) {
        return { kind: "unknown" };
      }
      if (link.status === "expired") {
        return { kind: "expired" };
      }
      if (link.status === "retired") {
        return { kind: "retired" };
      }
      if (link.expiresAt !== null && link.expiresAt <= new Date()) {
        return { kind: "expired" };
      }
      const publication = await database.query.artifactPublication.findFirst({
        columns: { versionId: true },
        where: and(
          eq(schema.artifactPublication.artifactId, link.artifactId),
          isNull(schema.artifactPublication.endedAt)
        ),
        orderBy: [desc(schema.artifactPublication.createdAt)]
      });
      return publication ? { kind: "published", versionId: publication.versionId } : { kind: "unpublished" };
    }
  };
}
