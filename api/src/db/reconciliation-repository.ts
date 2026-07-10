import { inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ReconciliationRepository } from "../application/reconciliation/repository.js";
import { db } from "./client.js";
import * as schema from "./schema.js";

type Database = NodePgDatabase<typeof schema>;

type ExpiredLeaseRow = {
  id: string;
  uploadSessionId: string;
  attemptCount: number;
  maxAttempts: number;
};

function attemptIdFromStagingKey(key: string): string | null {
  const parts = key.split("/", 4);
  return parts.length === 4 && parts[0] === "staging" && parts[2] ? parts[2] : null;
}

export function createReconciliationRepository(
  database: Database = db
): ReconciliationRepository {
  return {
    async recoverExpiredLeases(expiredBefore, limit) {
      return database.transaction(async (transaction) => {
        const expired = await transaction.execute<ExpiredLeaseRow>(sql`
          select
            id,
            upload_session_id as "uploadSessionId",
            attempt_count as "attemptCount",
            max_attempts as "maxAttempts"
          from artifact_processing_job
          where state = 'running' and lease_expires_at <= ${expiredBefore}
          order by lease_expires_at, id
          for update skip locked
          limit ${limit}
        `);

        for (const job of expired.rows) {
          const attempt = await transaction.execute(sql`
            update artifact_processing_attempt
            set state = 'failed', reason_code = 'processing_lease_expired', finished_at = now()
            where job_id = ${job.id}
              and attempt_number = ${job.attemptCount}
              and state = 'running'
            returning id
          `);
          if (attempt.rowCount !== 1) {
            throw new Error(
              `Running attempt ${job.attemptCount} is missing for expired job ${job.id}.`
            );
          }

          if (job.attemptCount < job.maxAttempts) {
            await transaction.execute(sql`
              update artifact_processing_job
              set state = 'queued', available_at = now(), lease_owner = null,
                  lease_expires_at = null, heartbeat_at = null, updated_at = now()
              where id = ${job.id}
            `);
            continue;
          }

          await transaction.execute(sql`
            update artifact_processing_job
            set state = 'failed', lease_owner = null, lease_expires_at = null,
                heartbeat_at = null, updated_at = now()
            where id = ${job.id}
          `);
          await transaction.execute(sql`
            update artifact_upload_session
            set state = 'failed', failure_reason_code = 'processing_lease_expired',
                failure_summary = 'processing_lease_expired', retryable = true,
                updated_at = now()
            where id = ${job.uploadSessionId}
          `);
        }

        return expired.rows.length;
      });
    },

    async findRemovableRawObjectKeys(keys) {
      if (keys.length === 0) {
        return [];
      }
      const sessions = await database
        .select({
          rawObjectKey: schema.artifactUploadSession.rawObjectKey,
          artifactId: schema.artifactUploadSession.artifactId,
          state: schema.artifactUploadSession.state,
          supersededAt: schema.artifactUploadSession.supersededAt
        })
        .from(schema.artifactUploadSession)
        .where(inArray(schema.artifactUploadSession.rawObjectKey, keys));
      const artifactIds = [...new Set(sessions.map((session) => session.artifactId))];
      const readyArtifacts =
        artifactIds.length === 0
          ? new Set<string>()
          : new Set(
              (
                await database
                  .select({ artifactId: schema.artifactVersion.artifactId })
                  .from(schema.artifactVersion)
                  .where(inArray(schema.artifactVersion.artifactId, artifactIds))
              ).map((version) => version.artifactId)
            );
      const references = new Map<string, typeof sessions>();
      for (const session of sessions) {
        const existing = references.get(session.rawObjectKey) ?? [];
        existing.push(session);
        references.set(session.rawObjectKey, existing);
      }

      return keys.filter((key) => {
        const referencedBy = references.get(key);
        return (
          !referencedBy ||
          referencedBy.every(
            (session) =>
              session.supersededAt !== null ||
              session.state === "committed" ||
              readyArtifacts.has(session.artifactId)
          )
        );
      });
    },

    async findRemovableStagingObjectKeys(keys) {
      if (keys.length === 0) {
        return [];
      }
      const attemptIds = [
        ...new Set(keys.map(attemptIdFromStagingKey).filter((id): id is string => id !== null))
      ];
      const attempts =
        attemptIds.length === 0
          ? []
          : await database
              .select({
                id: schema.artifactProcessingAttempt.id,
                state: schema.artifactProcessingAttempt.state,
                stagingPrefix: schema.artifactProcessingAttempt.stagingPrefix,
                artifactId: schema.artifactUploadSession.artifactId
              })
              .from(schema.artifactProcessingAttempt)
              .innerJoin(
                schema.artifactProcessingJob,
                sql`${schema.artifactProcessingJob.id} = ${schema.artifactProcessingAttempt.jobId}`
              )
              .innerJoin(
                schema.artifactUploadSession,
                sql`${schema.artifactUploadSession.id} = ${schema.artifactProcessingJob.uploadSessionId}`
              )
              .where(inArray(schema.artifactProcessingAttempt.id, attemptIds));
      const readyArtifactIds = [...new Set(attempts.map((attempt) => attempt.artifactId))];
      const readyArtifacts =
        readyArtifactIds.length === 0
          ? new Set<string>()
          : new Set(
              (
                await database
                  .select({ artifactId: schema.artifactVersion.artifactId })
                  .from(schema.artifactVersion)
                  .where(inArray(schema.artifactVersion.artifactId, readyArtifactIds))
              ).map((version) => version.artifactId)
            );

      return keys.filter((key) => {
        const attempt = attempts.find(
          (candidate) => candidate.id === attemptIdFromStagingKey(key) && key.startsWith(candidate.stagingPrefix)
        );
        return !attempt || attempt.state === "failed" || readyArtifacts.has(attempt.artifactId);
      });
    }
  };
}
