import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import type {
  ArtifactRecord,
  ArtifactRepositories,
  IdempotencyRecord,
  ProcessingJobRecord,
  PublicationRecord,
  ShareLinkRecord,
  UploadPolicySnapshot,
  UploadSessionRecord,
  ValidationReport,
  VersionRecord
} from "../application/artifacts/repositories.js";
import { db } from "./client.js";
import * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;

const nonEmptyString = z.string().min(1);
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonNegativeIntegerString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const exactNonNegativeInteger = z.union([nonNegativeSafeInteger, nonNegativeIntegerString]);
const validationDetailsSchema = z.strictObject({
  path: nonEmptyString.optional(),
  paths: z.array(nonEmptyString).optional(),
  candidates: z.array(nonEmptyString).optional(),
  extension: nonEmptyString.optional(),
  validationKind: nonEmptyString.optional(),
  actualBytes: exactNonNegativeInteger.optional(),
  limitBytes: exactNonNegativeInteger.optional(),
  actualCount: exactNonNegativeInteger.optional(),
  limitCount: exactNonNegativeInteger.optional(),
  ignoredCount: exactNonNegativeInteger.optional(),
  directory: nonEmptyString.optional(),
  entryFile: nonEmptyString.optional()
});
const validationNoticeSchema = z.strictObject({
  code: nonEmptyString.regex(/^[a-z][a-z0-9_]*$/),
  message: nonEmptyString,
  action: nonEmptyString.nullable(),
  details: validationDetailsSchema
});
const validationReportSchema = z
  .strictObject({
    primaryIssue: validationNoticeSchema.nullable(),
    issues: z.array(validationNoticeSchema).max(20),
    warnings: z.array(validationNoticeSchema).max(20)
  })
  .superRefine((report, context) => {
    if ((report.primaryIssue === null ? 0 : 1) + report.issues.length > 20) {
      context.addIssue({
        code: "custom",
        message: "A validation report cannot contain more than 20 blocking issues."
      });
    }
  });

function parseValidationReport(value: unknown): ValidationReport | null {
  if (value === null) return null;
  const parsed = validationReportSchema.safeParse(value);
  if (parsed.success) return value as ValidationReport;
  throw new Error("Database contains an inconsistent Artifact validation report.");
}

function artifactRecord(row: typeof schema.artifact.$inferSelect): ArtifactRecord {
  return row;
}

function shareLinkRecord(row: typeof schema.artifactShareLink.$inferSelect): ShareLinkRecord {
  return row;
}

function uploadSessionRecord(row: typeof schema.artifactUploadSession.$inferSelect): UploadSessionRecord {
  return {
    id: row.id,
    artifactId: row.artifactId,
    state: row.state,
    retryable: row.retryable,
    rawObjectKey: row.rawObjectKey,
    rawSha256: row.rawSha256,
    failureReasonCode: row.failureReasonCode,
    failureSummary: row.failureSummary,
    validationReport: parseValidationReport(row.validationReport),
    supersededAt: row.supersededAt
  };
}

function processingJobRecord(row: typeof schema.artifactProcessingJob.$inferSelect): ProcessingJobRecord {
  return {
    id: row.id,
    uploadSessionId: row.uploadSessionId,
    state: row.state,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts
  };
}

function versionRecord(row: typeof schema.artifactVersion.$inferSelect): VersionRecord {
  return {
    id: row.id,
    artifactId: row.artifactId,
    uploadSessionId: row.uploadSessionId,
    versionNumber: row.versionNumber,
    state: row.state
  };
}

function publicationRecord(row: typeof schema.artifactPublication.$inferSelect): PublicationRecord {
  return row;
}

function idempotencyRecord(row: typeof schema.artifactIdempotencyRecord.$inferSelect): IdempotencyRecord {
  return row;
}

export function createArtifactRepositories(database: Database = db): ArtifactRepositories {
  return {
    uploadPolicies: {
      async getActive(): Promise<UploadPolicySnapshot | null> {
        const policy = await database.query.artifactUploadPolicy.findFirst({
          where: eq(schema.artifactUploadPolicy.active, true),
          with: { formats: true }
        });
        if (!policy) {
          return null;
        }
        return {
          revision: policy.revision,
          archiveSizeBytes: policy.archiveSizeBytes,
          expandedSizeBytes: policy.expandedSizeBytes,
          fileCount: policy.fileCount,
          singleFileSizeBytes: policy.singleFileSizeBytes,
          formats: policy.formats.map(({ extension, contentType, validationKind }) => ({
            extension,
            contentType,
            validationKind
          }))
        };
      }
    },
    artifacts: {
      async listOwned(ownerUserId) {
        const rows = await database.query.artifact.findMany({
          where: eq(schema.artifact.ownerUserId, ownerUserId),
          orderBy: [desc(schema.artifact.updatedAt)]
        });
        return rows.map(artifactRecord);
      },
      async findOwned(ownerUserId, artifactId) {
        const row = await database.query.artifact.findFirst({
          where: and(eq(schema.artifact.ownerUserId, ownerUserId), eq(schema.artifact.id, artifactId))
        });
        return row ? artifactRecord(row) : null;
      },
      async updateName(ownerUserId, artifactId, name) {
        const [row] = await database
          .update(schema.artifact)
          .set({ name, updatedAt: new Date() })
          .where(and(eq(schema.artifact.ownerUserId, ownerUserId), eq(schema.artifact.id, artifactId)))
          .returning();
        return row ? artifactRecord(row) : null;
      },
      async deleteOwned(ownerUserId, artifactId) {
        return database.transaction(async (transaction) => {
          const owned = await transaction.query.artifact.findFirst({
            columns: { id: true },
            where: and(eq(schema.artifact.id, artifactId), eq(schema.artifact.ownerUserId, ownerUserId))
          });
          if (!owned) return null;
          const [rawObjects, committedObjects, attempts] = await Promise.all([
            transaction
              .select({ key: schema.artifactUploadSession.rawObjectKey })
              .from(schema.artifactUploadSession)
              .where(eq(schema.artifactUploadSession.artifactId, artifactId)),
            transaction
              .select({ key: schema.artifactAsset.objectKey })
              .from(schema.artifactAsset)
              .innerJoin(schema.artifactVersion, eq(schema.artifactVersion.id, schema.artifactAsset.versionId))
              .where(eq(schema.artifactVersion.artifactId, artifactId)),
            transaction
              .select({ prefix: schema.artifactProcessingAttempt.stagingPrefix })
              .from(schema.artifactProcessingAttempt)
              .innerJoin(schema.artifactProcessingJob, eq(schema.artifactProcessingJob.id, schema.artifactProcessingAttempt.jobId))
              .innerJoin(schema.artifactUploadSession, eq(schema.artifactUploadSession.id, schema.artifactProcessingJob.uploadSessionId))
              .where(eq(schema.artifactUploadSession.artifactId, artifactId))
          ]);
          await transaction.delete(schema.artifactPublication).where(eq(schema.artifactPublication.artifactId, artifactId));
          await transaction.delete(schema.artifactVersion).where(eq(schema.artifactVersion.artifactId, artifactId));
          await transaction.delete(schema.artifactIdempotencyRecord).where(eq(schema.artifactIdempotencyRecord.targetResourceId, artifactId));
          await transaction.delete(schema.artifact).where(eq(schema.artifact.id, artifactId));
          return {
            objectKeys: [...new Set([...rawObjects, ...committedObjects].map(({ key }) => key))],
            stagingPrefixes: [...new Set(attempts.map(({ prefix }) => prefix))]
          };
        });
      },
      async hasReadyVersion(artifactId) {
        const row = await database.query.artifactVersion.findFirst({
          columns: { id: true },
          where: and(eq(schema.artifactVersion.artifactId, artifactId), eq(schema.artifactVersion.state, "ready"))
        });
        return row !== undefined;
      }
    },
    shareLinks: {
      async findActiveByArtifact(artifactId) {
        const row = await database.query.artifactShareLink.findFirst({
          where: and(
            eq(schema.artifactShareLink.artifactId, artifactId),
            eq(schema.artifactShareLink.status, "active")
          )
        });
        return row ? shareLinkRecord(row) : null;
      },
      async findBySlug(slug) {
        const row = await database.query.artifactShareLink.findFirst({
          where: eq(schema.artifactShareLink.slug, slug)
        });
        return row ? shareLinkRecord(row) : null;
      },
      async updateExpirationOwned(ownerUserId, artifactId, expiresAt) {
        const owned = await database.query.artifact.findFirst({
          columns: { id: true },
          where: and(eq(schema.artifact.id, artifactId), eq(schema.artifact.ownerUserId, ownerUserId))
        });
        if (!owned) return null;
        const [row] = await database
          .update(schema.artifactShareLink)
          .set({ expiresAt })
          .where(and(eq(schema.artifactShareLink.artifactId, artifactId), eq(schema.artifactShareLink.status, "active")))
          .returning();
        return row ? shareLinkRecord(row) : null;
      }
    },
    uploadSessions: {
      async findOwned(ownerUserId, uploadSessionId) {
        const row = await database
          .select({ session: schema.artifactUploadSession })
          .from(schema.artifactUploadSession)
          .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactUploadSession.artifactId))
          .where(
            and(
              eq(schema.artifactUploadSession.id, uploadSessionId),
              eq(schema.artifact.ownerUserId, ownerUserId)
            )
          )
          .limit(1);
        return row[0] ? uploadSessionRecord(row[0].session) : null;
      },
      async findCurrent(artifactId) {
        const row = await database.query.artifactUploadSession.findFirst({
          where: and(
            eq(schema.artifactUploadSession.artifactId, artifactId),
            isNull(schema.artifactUploadSession.supersededAt)
          ),
          orderBy: [desc(schema.artifactUploadSession.createdAt)]
        });
        return row ? uploadSessionRecord(row) : null;
      }
    },
    processingJobs: {
      async findByUploadSession(uploadSessionId) {
        const row = await database.query.artifactProcessingJob.findFirst({
          where: eq(schema.artifactProcessingJob.uploadSessionId, uploadSessionId),
          orderBy: [desc(schema.artifactProcessingJob.createdAt)]
        });
        return row ? processingJobRecord(row) : null;
      }
    },
    versions: {
      async findReadyOwned(ownerUserId, versionId) {
        const row = await database
          .select({ version: schema.artifactVersion })
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
        return row[0] ? versionRecord(row[0].version) : null;
      },
      async findReadyByArtifact(artifactId) {
        const row = await database.query.artifactVersion.findFirst({
          where: and(eq(schema.artifactVersion.artifactId, artifactId), eq(schema.artifactVersion.state, "ready")),
          orderBy: [desc(schema.artifactVersion.versionNumber)]
        });
        return row ? versionRecord(row) : null;
      }
    },
    publications: {
      async findCurrent(artifactId) {
        const row = await database.query.artifactPublication.findFirst({
          where: and(eq(schema.artifactPublication.artifactId, artifactId), isNull(schema.artifactPublication.endedAt)),
          orderBy: [desc(schema.artifactPublication.createdAt)]
        });
        return row ? publicationRecord(row) : null;
      }
    },
    idempotency: {
      async find(ownerUserId, operation, targetResourceId, key) {
        const targetCondition =
          targetResourceId === null
            ? isNull(schema.artifactIdempotencyRecord.targetResourceId)
            : eq(schema.artifactIdempotencyRecord.targetResourceId, targetResourceId);
        const row = await database.query.artifactIdempotencyRecord.findFirst({
          where: and(
            eq(schema.artifactIdempotencyRecord.ownerUserId, ownerUserId),
            eq(schema.artifactIdempotencyRecord.operation, operation),
            targetCondition,
            eq(schema.artifactIdempotencyRecord.key, key)
          )
        });
        return row ? idempotencyRecord(row) : null;
      },
      async claimPending(input) {
        const [inserted] = await database
          .insert(schema.artifactIdempotencyRecord)
          .values({
            id: input.id,
            ownerUserId: input.ownerUserId,
            operation: input.operation,
            targetResourceId: input.targetResourceId,
            key: input.key,
            requestHash: input.provisionalRequestHash,
            state: "pending"
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) {
          return { kind: "acquired", record: idempotencyRecord(inserted) };
        }

        const existing = await this.find(
          input.ownerUserId,
          input.operation,
          input.targetResourceId,
          input.key
        );
        if (!existing) {
          throw new Error("Idempotency claim conflicted without an existing record.");
        }
        return { kind: "existing", record: existing };
      },
      async releasePending(id) {
        await database
          .delete(schema.artifactIdempotencyRecord)
          .where(
            and(
              eq(schema.artifactIdempotencyRecord.id, id),
              eq(schema.artifactIdempotencyRecord.state, "pending")
            )
          );
      }
    },
    intake: {
      async commitAccepted(input) {
        await database.transaction(async (transaction) => {
          await transaction.insert(schema.artifact).values({
            id: input.artifactId,
            ownerUserId: input.ownerUserId,
            name: input.name
          });
          await transaction.insert(schema.artifactShareLink).values({
            id: input.shareLinkId,
            artifactId: input.artifactId,
            slug: input.shareSlug
          });
          await transaction.insert(schema.artifactUploadSession).values({
            id: input.uploadSessionId,
            artifactId: input.artifactId,
            policyRevision: input.policy.revision,
            archiveSizeBytes: input.policy.archiveSizeBytes,
            expandedSizeBytes: input.policy.expandedSizeBytes,
            fileCount: input.policy.fileCount,
            singleFileSizeBytes: input.policy.singleFileSizeBytes,
            formats: input.policy.formats,
            rawObjectKey: input.rawObjectKey,
            rawSha256: input.rawSha256,
            rawSizeBytes: input.rawSizeBytes,
            requestedEntry: input.requestedEntry ?? null
          });
          await transaction.insert(schema.artifactProcessingJob).values({
            id: input.processingJobId,
            uploadSessionId: input.uploadSessionId,
            maxAttempts: input.maxAttempts
          });
          const completed = await transaction
            .update(schema.artifactIdempotencyRecord)
            .set({
              requestHash: input.requestHash,
              state: "completed",
              responseStatus: input.responseStatus,
              responseBody: input.responseBody,
              completedAt: new Date()
            })
            .where(
              and(
                eq(schema.artifactIdempotencyRecord.id, input.idempotencyRecordId),
                eq(schema.artifactIdempotencyRecord.state, "pending")
              )
            )
            .returning({ id: schema.artifactIdempotencyRecord.id });
          if (completed.length !== 1) {
            throw new Error("Pending idempotency record was not completed.");
          }
        });
      }
    },
    recovery: {
      async queueManualRetry(input) {
        await database.transaction(async (transaction) => {
          const sessions = await transaction
            .update(schema.artifactUploadSession)
            .set({
              state: "accepted",
              retryable: false,
              failureReasonCode: null,
              failureSummary: null,
              validationReport: null,
              updatedAt: new Date()
            })
            .where(
              and(
                eq(schema.artifactUploadSession.id, input.uploadSessionId),
                eq(schema.artifactUploadSession.state, "failed"),
                eq(schema.artifactUploadSession.retryable, true),
                isNull(schema.artifactUploadSession.supersededAt)
              )
            )
            .returning({ id: schema.artifactUploadSession.id });
          if (sessions.length !== 1) {
            throw new Error("Upload session is not eligible for manual Retry.");
          }
          await transaction.insert(schema.artifactProcessingJob).values({
            id: input.processingJobId,
            uploadSessionId: input.uploadSessionId,
            maxAttempts: input.maxAttempts
          });
          const completed = await transaction
            .update(schema.artifactIdempotencyRecord)
            .set({
              requestHash: input.requestHash,
              state: "completed",
              responseStatus: input.responseStatus,
              responseBody: input.responseBody,
              completedAt: new Date()
            })
            .where(
              and(
                eq(schema.artifactIdempotencyRecord.id, input.idempotencyRecordId),
                eq(schema.artifactIdempotencyRecord.state, "pending")
              )
            )
            .returning({ id: schema.artifactIdempotencyRecord.id });
          if (completed.length !== 1) {
            throw new Error("Pending Retry idempotency record was not completed.");
          }
        });
      },
      async commitReplacement(input) {
        await database.transaction(async (transaction) => {
          const superseded = await transaction
            .update(schema.artifactUploadSession)
            .set({ supersededAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(schema.artifactUploadSession.id, input.previousUploadSessionId),
                eq(schema.artifactUploadSession.artifactId, input.artifactId),
                eq(schema.artifactUploadSession.state, "failed"),
                eq(schema.artifactUploadSession.retryable, false),
                isNull(schema.artifactUploadSession.supersededAt)
              )
            )
            .returning({ id: schema.artifactUploadSession.id });
          if (superseded.length !== 1) {
            throw new Error("Upload session is not eligible for Replace file.");
          }
          await transaction.insert(schema.artifactUploadSession).values({
            id: input.uploadSessionId,
            artifactId: input.artifactId,
            policyRevision: input.policy.revision,
            archiveSizeBytes: input.policy.archiveSizeBytes,
            expandedSizeBytes: input.policy.expandedSizeBytes,
            fileCount: input.policy.fileCount,
            singleFileSizeBytes: input.policy.singleFileSizeBytes,
            formats: input.policy.formats,
            rawObjectKey: input.rawObjectKey,
            rawSha256: input.rawSha256,
            rawSizeBytes: input.rawSizeBytes
          });
          await transaction.insert(schema.artifactProcessingJob).values({
            id: input.processingJobId,
            uploadSessionId: input.uploadSessionId,
            maxAttempts: input.maxAttempts
          });
          const completed = await transaction
            .update(schema.artifactIdempotencyRecord)
            .set({
              requestHash: input.requestHash,
              state: "completed",
              responseStatus: input.responseStatus,
              responseBody: input.responseBody,
              completedAt: new Date()
            })
            .where(
              and(
                eq(schema.artifactIdempotencyRecord.id, input.idempotencyRecordId),
                eq(schema.artifactIdempotencyRecord.state, "pending")
              )
            )
            .returning({ id: schema.artifactIdempotencyRecord.id });
          if (completed.length !== 1) {
            throw new Error("Pending Replace idempotency record was not completed.");
          }
        });
      }
    }
  };
}
