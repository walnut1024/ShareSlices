import { asc, eq, inArray, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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

type DeletionCleanupRow = {
  artifactId: string;
  objectKeys: string[];
  stagingPrefixes: string[];
  attemptCount: number;
  leaseToken: string;
};

type ContentBundleCleanupRow = {
  bundleId: string;
  ownerUserId: string;
  objectPrefixes: string[];
  attemptCount: number;
  leaseToken: string;
};

function attemptIdFromStagingKey(key: string): string | null {
  const parts = key.split("/", 4);
  return parts.length === 4 && parts[0] === "staging" && parts[2] ? parts[2] : null;
}

export function createReconciliationRepository(
  database: Database = db,
  cleanupLeaseOwner = "shareslices-api",
  createLeaseToken = randomUUID
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
                failure_summary = 'Processing was interrupted.', retryable = true,
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
          state: schema.artifactUploadSession.state,
          supersededAt: schema.artifactUploadSession.supersededAt
        })
        .from(schema.artifactUploadSession)
        .where(inArray(schema.artifactUploadSession.rawObjectKey, keys));
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
              session.state === "committed"
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
    },

    async claimArtifactDeletionCleanups(createdBefore, limit) {
      const leaseToken = `${cleanupLeaseOwner}-${createLeaseToken()}`;
      const claimed = await database.execute<DeletionCleanupRow>(sql`
        with candidates as (
          select artifact_id
          from artifact_deletion_cleanup
          where created_at < ${createdBefore}
            and next_attempt_at <= now()
            and (lease_expires_at is null or lease_expires_at <= now())
            and not exists (
              select 1 from gallery_governance_evidence_hold hold
              join gallery_governance_case governance_case on governance_case.id=hold.case_id
              where governance_case.artifact_id=artifact_deletion_cleanup.artifact_id
                and hold.released_at is null
              union all
              select 1 from gallery_copy_source_retention retention
              join artifact_version version on version.id=retention.source_version_id
              where version.artifact_id=artifact_deletion_cleanup.artifact_id
                and retention.released_at is null
              union all
              select 1 from gallery_download_source_lease lease
              join artifact_version version on version.id=lease.version_id
              where version.artifact_id=artifact_deletion_cleanup.artifact_id
                and lease.state='active' and lease.expires_at>now()
            )
          order by next_attempt_at, created_at, artifact_id
          for update skip locked
          limit ${limit}
        )
        update artifact_deletion_cleanup as cleanup
        set lease_owner = ${leaseToken},
            lease_expires_at = now() + interval '1 minute',
            attempt_count = cleanup.attempt_count + 1,
            last_error_code = null
        from candidates
        where cleanup.artifact_id = candidates.artifact_id
        returning cleanup.artifact_id as "artifactId",
                  cleanup.object_keys as "objectKeys",
                  cleanup.staging_prefixes as "stagingPrefixes",
                  cleanup.attempt_count as "attemptCount",
                  cleanup.lease_owner as "leaseToken"
      `);
      return claimed.rows;
    },

    async completeArtifactDeletionCleanup(artifactId, leaseToken) {
      await database.transaction(async (transaction) => {
        const galleryReference = await transaction.execute<{ held: boolean }>(sql`
          select exists(select 1 from gallery_listing where artifact_id=${artifactId}) as held
        `);
        if (!galleryReference.rows[0]?.held) {
          await transaction
            .delete(schema.artifactDeletionCleanup)
            .where(sql`${schema.artifactDeletionCleanup.artifactId} = ${artifactId}
              and ${schema.artifactDeletionCleanup.leaseOwner} = ${leaseToken}`);
          return;
        }

        const cleanup = await transaction.execute(sql`
          select 1 from artifact_deletion_cleanup
          where artifact_id=${artifactId} and lease_owner=${leaseToken}
          for update
        `);
        if (cleanup.rowCount !== 1) return;

        await transaction.execute(sql`
          insert into content_bundle_cleanup(bundle_id,owner_user_id,object_prefixes,quiesce_after)
          select bundle.id,bundle.owner_user_id,
            jsonb_build_array('content-bundles/' || bundle.id || '/') ||
              coalesce((
                select jsonb_agg(distinct attempt.object_prefix)
                from artifact_processing_attempt attempt
                where attempt.id in (bundle.creator_attempt_id,bundle.winning_attempt_id)
                  and attempt.object_prefix is not null
              ), '[]'::jsonb),
            greatest(
              now() + interval '1 minute',
              coalesce((
                select max(attempt.write_deadline_at)
                from artifact_processing_attempt attempt
                where attempt.id in (bundle.creator_attempt_id,bundle.winning_attempt_id)
              ), now()) + interval '1 minute'
            )
          from content_bundle bundle
          where bundle.id in (
            select version.content_bundle_id from artifact_version version
            where version.artifact_id=${artifactId} and version.content_bundle_id is not null
          ) and not exists (
            select 1 from artifact_version other
            where other.content_bundle_id=bundle.id and other.artifact_id<>${artifactId}
          )
          on conflict(bundle_id) do nothing
        `);
        await transaction.execute(sql`
          update content_bundle_fingerprint_alias alias set retired_at=now()
          where alias.bundle_id in (
            select version.content_bundle_id from artifact_version version
            where version.artifact_id=${artifactId} and version.content_bundle_id is not null
          ) and alias.retired_at is null
        `);
        await transaction.execute(sql`
          update raw_input_fingerprint_alias alias set retired_at=now()
          where alias.bundle_id in (
            select version.content_bundle_id from artifact_version version
            where version.artifact_id=${artifactId} and version.content_bundle_id is not null
          ) and alias.retired_at is null
        `);
        await transaction.execute(sql`
          update content_bundle_thumbnail_job job
          set state='cancelled',lease_owner=null,lease_expires_at=null,
              heartbeat_at=null,updated_at=now()
          where job.bundle_id in (
            select version.content_bundle_id from artifact_version version
            where version.artifact_id=${artifactId} and version.content_bundle_id is not null
          ) and job.state in ('queued','running')
        `);
        await transaction.execute(sql`
          update content_bundle bundle
          set lifecycle_state='deleting',creator_attempt_id=null,winning_attempt_id=null,
              deleting_at=now(),updated_at=now()
          where bundle.id in (
            select version.content_bundle_id from artifact_version version
            where version.artifact_id=${artifactId} and version.content_bundle_id is not null
          ) and not exists (
            select 1 from artifact_version other
            where other.content_bundle_id=bundle.id and other.artifact_id<>${artifactId}
          )
        `);
        await transaction.execute(sql`
          update artifact_version set content_bundle_id=null where artifact_id=${artifactId}
        `);
        await transaction.execute(sql`
          delete from artifact_publication where artifact_id=${artifactId}
        `);
        await transaction.execute(sql`
          delete from artifact_share_link where artifact_id=${artifactId}
        `);
        await transaction.execute(sql`
          update artifact_deletion_cleanup
          set lease_owner=null,lease_expires_at=null,next_attempt_at='infinity',
              last_error_code='gallery_tombstone_retained'
          where artifact_id=${artifactId} and lease_owner=${leaseToken}
        `);
      });
    },

    async failArtifactDeletionCleanup(artifactId, leaseToken, nextAttemptAt, errorCode) {
      await database
        .update(schema.artifactDeletionCleanup)
        .set({
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt,
          lastErrorCode: errorCode
        })
        .where(sql`${schema.artifactDeletionCleanup.artifactId} = ${artifactId}
          and ${schema.artifactDeletionCleanup.leaseOwner} = ${leaseToken}`);
    },

    async recoverExpiredCreatingBundles(expiredBefore, quiesceAfter, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Recovery limit must be positive.");
      const recovered = await database.execute<{ bundleId: string }>(sql`
        with candidates as (
          select bundle.id, bundle.owner_user_id, attempt.object_prefix, attempt.write_deadline_at
          from content_bundle bundle
          join artifact_processing_attempt attempt on attempt.id = bundle.creator_attempt_id
          join artifact_processing_job job on job.id = attempt.job_id
          where bundle.lifecycle_state = 'creating'
            and bundle.creator_lease_expires_at <= ${expiredBefore}
            and job.state in ('completed', 'failed')
            and not exists (
              select 1 from artifact_version version where version.content_bundle_id = bundle.id
            )
          order by bundle.creator_lease_expires_at, bundle.id
          for update of bundle skip locked
          limit ${limit}
        ), inserted as (
          insert into content_bundle_cleanup (
            bundle_id, owner_user_id, object_prefixes, quiesce_after
          )
          select id, owner_user_id,
                 jsonb_build_array('content-bundles/' || id || '/') ||
                   case when object_prefix is null then '[]'::jsonb else jsonb_build_array(object_prefix) end,
                 greatest(
                   ${quiesceAfter},
                   now() + interval '1 minute',
                   coalesce(write_deadline_at, now()) + interval '1 minute'
                 )
          from candidates
          on conflict (bundle_id) do nothing
          returning bundle_id
        )
        update content_bundle bundle
        set lifecycle_state = 'deleting', creator_attempt_id = null,
            winning_attempt_id = null, creator_lease_expires_at = null,
            deleting_at = now(), updated_at = now()
        from candidates
        where bundle.id = candidates.id
        returning bundle.id as "bundleId"
      `);
      return recovered.rows.length;
    },

    async claimContentBundleCleanups(now, limit) {
      const leaseToken = `${cleanupLeaseOwner}-${createLeaseToken()}`;
      const claimed = await database.execute<ContentBundleCleanupRow>(sql`
        with candidates as (
          select bundle_id
          from content_bundle_cleanup
          where quiesce_after <= ${now}::timestamptz
            and next_attempt_at <= ${now}::timestamptz
            and (state = 'pending' or (state = 'running' and lease_expires_at <= ${now}::timestamptz))
          order by next_attempt_at, created_at, bundle_id
          for update skip locked
          limit ${limit}
        )
        update content_bundle_cleanup cleanup
        set state = 'running', lease_owner = ${leaseToken},
            lease_expires_at = ${now}::timestamptz + interval '1 minute',
            attempt_count = cleanup.attempt_count + 1,
            last_error_code = null
        from candidates
        where cleanup.bundle_id = candidates.bundle_id
        returning cleanup.bundle_id as "bundleId",
                  cleanup.owner_user_id as "ownerUserId",
                  cleanup.object_prefixes as "objectPrefixes",
                  cleanup.attempt_count as "attemptCount",
                  cleanup.lease_owner as "leaseToken"
      `);
      return claimed.rows;
    },

    async completeContentBundleCleanup(bundleId, leaseToken, processedPrefixes) {
      return database.transaction(async (transaction) => {
        const cleanup = await transaction.execute<{ objectPrefixes: string[] }>(sql`
          select object_prefixes as "objectPrefixes" from content_bundle_cleanup
          where bundle_id = ${bundleId} and state = 'running' and lease_owner = ${leaseToken}
          for update
        `);
        if (cleanup.rowCount !== 1) return false;
        if (JSON.stringify(cleanup.rows[0]?.objectPrefixes) !== JSON.stringify(processedPrefixes)) {
          await transaction.execute(sql`
            update content_bundle_cleanup
            set state = 'pending', lease_owner = null, lease_expires_at = null,
                next_attempt_at = now()
            where bundle_id = ${bundleId} and lease_owner = ${leaseToken}
          `);
          return false;
        }
        await transaction.execute(sql`delete from content_bundle_thumbnail where bundle_id = ${bundleId}`);
        await transaction.execute(sql`delete from content_bundle_thumbnail_job where bundle_id = ${bundleId}`);
        await transaction.execute(sql`delete from content_bundle where id = ${bundleId}`);
        return true;
      });
    },

    async failContentBundleCleanup(bundleId, leaseToken, nextAttemptAt, errorCode) {
      await database.execute(sql`
        update content_bundle_cleanup
        set state = 'pending', lease_owner = null, lease_expires_at = null,
            next_attempt_at = ${nextAttemptAt}, last_error_code = ${errorCode}
        where bundle_id = ${bundleId} and state = 'running' and lease_owner = ${leaseToken}
      `);
    },

    async recordLateContentBundlePrefix(bundleId, objectPrefix) {
      const root = `content-bundles/${bundleId}/`;
      if (!objectPrefix.startsWith(root) || !objectPrefix.endsWith("/")) {
        throw new Error("A late content bundle prefix must stay below its bundle root and end with '/'.");
      }
      const updated = await database.execute(sql`
        update content_bundle_cleanup
        set object_prefixes = case
          when object_prefixes ? ${objectPrefix} then object_prefixes
          else object_prefixes || jsonb_build_array(${objectPrefix}::text) end
        where bundle_id = ${bundleId} and state in ('pending', 'running')
        returning bundle_id
      `);
      return updated.rowCount === 1;
    },

    async claimEligibleAttemptPrefixes(now, limit) {
      const leaseToken = `${cleanupLeaseOwner}-${createLeaseToken()}`;
      const claimed = await database.execute<{
        attemptId: string;
        objectPrefix: string;
        attemptCount: number;
        leaseToken: string;
      }>(sql`
        with candidates as (
          select id from artifact_processing_attempt
          where object_prefix is not null
            and (cleanup_state = 'eligible'
              or (cleanup_state = 'cleaned' and cleaned_at <= ${now}::timestamptz - interval '1 minute'))
            and cleanup_eligible_at <= ${now}::timestamptz
            and cleanup_next_attempt_at <= ${now}::timestamptz
            and (cleanup_lease_expires_at is null or cleanup_lease_expires_at <= ${now}::timestamptz)
          order by cleanup_next_attempt_at, cleanup_eligible_at, id
          for update skip locked
          limit ${limit}
        )
        update artifact_processing_attempt attempt
        set cleanup_state = 'eligible', cleaned_at = null,
            cleanup_lease_owner = ${leaseToken},
            cleanup_lease_expires_at = ${now}::timestamptz + interval '1 minute',
            cleanup_attempt_count = attempt.cleanup_attempt_count + 1,
            cleanup_last_error_code = null
        from candidates where attempt.id = candidates.id
        returning attempt.id as "attemptId", attempt.object_prefix as "objectPrefix",
          attempt.cleanup_attempt_count as "attemptCount", attempt.cleanup_lease_owner as "leaseToken"
      `);
      return claimed.rows;
    },

    async completeAttemptPrefixCleanup(attemptId, leaseToken) {
      await database.execute(sql`
        update artifact_processing_attempt
        set cleanup_state = 'cleaned', cleaned_at = now(), cleanup_lease_owner = null,
            cleanup_lease_expires_at = null, cleanup_last_error_code = null
        where id = ${attemptId} and cleanup_state = 'eligible'
          and cleanup_lease_owner = ${leaseToken}
      `);
    },

    async failAttemptPrefixCleanup(attemptId, leaseToken, nextAttemptAt, errorCode) {
      await database.execute(sql`
        update artifact_processing_attempt
        set cleanup_lease_owner = null, cleanup_lease_expires_at = null,
            cleanup_next_attempt_at = ${nextAttemptAt}, cleanup_last_error_code = ${errorCode}
        where id = ${attemptId} and cleanup_state = 'eligible'
          and cleanup_lease_owner = ${leaseToken}
      `);
    },

    async claimEligibleThumbnailObjects(now, limit) {
      const leaseToken = `${cleanupLeaseOwner}-${createLeaseToken()}`;
      const claimed = await database.execute<{
        attemptId: string; objectKey: string; attemptCount: number; leaseToken: string;
      }>(sql`
        with candidates as (
          select id from content_bundle_thumbnail_attempt
          where (cleanup_state = 'eligible'
              or (cleanup_state = 'cleaned' and cleaned_at <= ${now}::timestamptz - interval '1 minute'))
            and cleanup_eligible_at <= ${now}::timestamptz
            and cleanup_next_attempt_at <= ${now}::timestamptz
            and (cleanup_lease_expires_at is null or cleanup_lease_expires_at <= ${now}::timestamptz)
          order by cleanup_next_attempt_at, cleanup_eligible_at, id
          for update skip locked limit ${limit}
        )
        update content_bundle_thumbnail_attempt attempt
        set cleanup_state = 'eligible', cleaned_at = null,
            cleanup_lease_owner = ${leaseToken},
            cleanup_lease_expires_at = ${now}::timestamptz + interval '1 minute',
            cleanup_attempt_count = attempt.cleanup_attempt_count + 1,
            cleanup_last_error_code = null
        from candidates where attempt.id = candidates.id
        returning attempt.id as "attemptId", attempt.object_key as "objectKey",
          attempt.cleanup_attempt_count as "attemptCount", attempt.cleanup_lease_owner as "leaseToken"
      `);
      return claimed.rows;
    },

    async completeThumbnailObjectCleanup(attemptId, leaseToken) {
      await database.execute(sql`
        update content_bundle_thumbnail_attempt
        set cleanup_state = 'cleaned', cleaned_at = now(), cleanup_lease_owner = null,
            cleanup_lease_expires_at = null, cleanup_last_error_code = null
        where id = ${attemptId} and cleanup_state = 'eligible' and cleanup_lease_owner = ${leaseToken}
      `);
    },

    async failThumbnailObjectCleanup(attemptId, leaseToken, nextAttemptAt, errorCode) {
      await database.execute(sql`
        update content_bundle_thumbnail_attempt
        set cleanup_lease_owner = null, cleanup_lease_expires_at = null,
            cleanup_next_attempt_at = ${nextAttemptAt}, cleanup_last_error_code = ${errorCode}
        where id = ${attemptId} and cleanup_state = 'eligible' and cleanup_lease_owner = ${leaseToken}
      `);
    }
  };
}
