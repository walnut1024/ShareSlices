use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    manifest::ReadyManifest,
    validation_report::{ValidationReport, primary_issue_matches_legacy_reason},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimedJob {
    pub job_id: String,
    pub upload_session_id: String,
    pub attempt_id: String,
    pub attempt_number: i32,
    pub max_attempts: i32,
    pub staging_prefix: String,
    pub lease_expires_at: OffsetDateTime,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobFailure {
    pub reason_code: String,
    pub summary: String,
    pub retry_at: Option<OffsetDateTime>,
    pub retryable: bool,
    pub exception: Option<Value>,
    pub validation_report: Option<ValidationReport>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadyVersionCommit {
    pub job_id: String,
    pub worker_id: String,
    pub upload_session_id: String,
    pub version_id: String,
    pub manifest: ReadyManifest,
    pub validation_report: ValidationReport,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommitOutcome {
    Committed,
    AlreadyCommitted { version_id: String },
    LeaseLost,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentBundleReservation {
    pub bundle_id: String,
    pub attempt_id: String,
    pub content_identity_revision: String,
    pub fingerprint_key_revision: String,
    pub reuse_fingerprint: String,
    pub previous_fingerprint: Option<(String, String)>,
    pub lease_duration: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ContentBundleReservationOutcome {
    Reserved { bundle_id: String },
    Creating { bundle_id: String },
    Ready { bundle_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadyContentBundleVersionCommit {
    pub bundle_id: String,
    pub attempt_id: String,
    pub renderer_revision: String,
    pub version: ReadyVersionCommit,
    pub raw_reuse: RawReuseContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawFingerprintCandidate {
    pub key_revision: String,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawReuseContext {
    pub requested_entry_key: String,
    pub policy_revision: String,
    pub processing_revision: String,
    pub content_identity_revision: String,
    pub candidates: Vec<RawFingerprintCandidate>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RawReuseHit {
    pub bundle_id: String,
    pub validation_report: ValidationReport,
}

#[derive(Debug, Error)]
pub enum JobStoreError {
    #[error("lease duration must be greater than zero and fit in milliseconds")]
    InvalidLeaseDuration,
    #[error("recovery limit must be greater than zero")]
    InvalidRecoveryLimit,
    #[error("job state is inconsistent: {0}")]
    InconsistentState(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[async_trait]
pub trait JobStore: Send + Sync {
    async fn claim_next(
        &self,
        worker_id: &str,
        lease_duration: Duration,
    ) -> Result<Option<ClaimedJob>, JobStoreError>;

    async fn heartbeat(
        &self,
        job_id: &str,
        worker_id: &str,
        lease_duration: Duration,
    ) -> Result<bool, JobStoreError>;

    async fn complete(&self, job_id: &str, worker_id: &str) -> Result<bool, JobStoreError>;

    async fn fail(
        &self,
        job_id: &str,
        worker_id: &str,
        failure: &JobFailure,
    ) -> Result<bool, JobStoreError>;

    async fn recover_expired_leases(&self, limit: i64) -> Result<u64, JobStoreError>;
}

#[async_trait]
pub trait ContentBundleStore: Send + Sync {
    async fn lookup_raw_reuse(
        &self,
        _attempt_id: &str,
        _context: &RawReuseContext,
    ) -> Result<Option<RawReuseHit>, JobStoreError> {
        Ok(None)
    }

    async fn prepare_bundle_writes(
        &self,
        _attempt_id: &str,
        _bundle_id: &str,
        _lease_duration: Duration,
    ) -> Result<bool, JobStoreError> {
        Ok(true)
    }

    async fn mark_attempt_cleanup_eligible(&self, _attempt_id: &str) -> Result<(), JobStoreError> {
        Ok(())
    }

    async fn reserve_content_bundle(
        &self,
        reservation: &ContentBundleReservation,
    ) -> Result<ContentBundleReservationOutcome, JobStoreError>;

    async fn commit_content_bundle_version(
        &self,
        commit: &ReadyContentBundleVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError>;
}

#[derive(Clone)]
pub struct PostgresJobStore {
    pool: PgPool,
}

impl PostgresJobStore {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl JobStore for PostgresJobStore {
    async fn claim_next(
        &self,
        worker_id: &str,
        lease_duration: Duration,
    ) -> Result<Option<ClaimedJob>, JobStoreError> {
        let lease_milliseconds = lease_milliseconds(lease_duration)?;
        let mut transaction = self.pool.begin().await?;
        let candidate = sqlx::query(
            r"
            select job.id, job.upload_session_id, job.attempt_count, job.max_attempts,
                   artifact.owner_user_id
            from artifact_processing_job as job
            join artifact_upload_session as upload on upload.id = job.upload_session_id
            join artifact on artifact.id = upload.artifact_id
            where job.state = 'queued'
              and job.available_at <= now()
              and job.attempt_count < job.max_attempts
            order by job.available_at, job.created_at, job.id
            for update skip locked
            limit 1
            ",
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(candidate) = candidate else {
            transaction.commit().await?;
            return Ok(None);
        };

        let job_id: String = candidate.try_get("id")?;
        let upload_session_id: String = candidate.try_get("upload_session_id")?;
        let owner_user_id: String = candidate.try_get("owner_user_id")?;
        let attempt_number: i32 = candidate.try_get::<i32, _>("attempt_count")? + 1;
        let max_attempts: i32 = candidate.try_get("max_attempts")?;
        let lease_expires_at: OffsetDateTime = sqlx::query_scalar(
            r"
            update artifact_processing_job
            set state = 'running',
                lease_owner = $2,
                lease_expires_at = now() + ($3 * interval '1 millisecond'),
                heartbeat_at = now(),
                attempt_count = $4,
                updated_at = now()
            where id = $1
            returning lease_expires_at
            ",
        )
        .bind(&job_id)
        .bind(worker_id)
        .bind(lease_milliseconds)
        .bind(attempt_number)
        .fetch_one(&mut *transaction)
        .await?;

        sqlx::query(
            "update artifact_upload_session set state = 'processing', updated_at = now() where id = $1 and state = 'accepted'",
        )
        .bind(&upload_session_id)
        .execute(&mut *transaction)
        .await?;

        let attempt_id = Uuid::new_v4().to_string();
        let staging_prefix = format!("staging/{upload_session_id}/{attempt_id}/");
        sqlx::query(
            r"
            insert into artifact_processing_attempt (
              id, owner_user_id, job_id, attempt_number, staging_prefix
            ) values ($1, $2, $3, $4, $5)
            ",
        )
        .bind(&attempt_id)
        .bind(&owner_user_id)
        .bind(&job_id)
        .bind(attempt_number)
        .bind(&staging_prefix)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(Some(ClaimedJob {
            job_id,
            upload_session_id,
            attempt_id,
            attempt_number,
            max_attempts,
            staging_prefix,
            lease_expires_at,
        }))
    }

    async fn heartbeat(
        &self,
        job_id: &str,
        worker_id: &str,
        lease_duration: Duration,
    ) -> Result<bool, JobStoreError> {
        let lease_milliseconds = lease_milliseconds(lease_duration)?;
        let result = sqlx::query(
            r"
            update artifact_processing_job
            set heartbeat_at = now(),
                lease_expires_at = now() + ($3 * interval '1 millisecond'),
                updated_at = now()
            where id = $1
              and state = 'running'
              and lease_owner = $2
              and lease_expires_at > now()
            ",
        )
        .bind(job_id)
        .bind(worker_id)
        .bind(lease_milliseconds)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn complete(&self, job_id: &str, worker_id: &str) -> Result<bool, JobStoreError> {
        let mut transaction = self.pool.begin().await?;
        let attempt_number = lock_active_lease(&mut transaction, job_id, worker_id).await?;
        let Some(attempt_number) = attempt_number else {
            transaction.rollback().await?;
            return Ok(false);
        };

        finish_attempt(
            &mut transaction,
            job_id,
            attempt_number,
            "succeeded",
            None,
            None,
            None,
        )
        .await?;
        sqlx::query(
            r"
            update artifact_processing_job
            set state = 'completed', lease_owner = null, lease_expires_at = null,
                heartbeat_at = null, updated_at = now()
            where id = $1
            ",
        )
        .bind(job_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn fail(
        &self,
        job_id: &str,
        worker_id: &str,
        failure: &JobFailure,
    ) -> Result<bool, JobStoreError> {
        let mut transaction = self.pool.begin().await?;
        let row = lock_active_job(&mut transaction, job_id, worker_id).await?;
        let Some(row) = row else {
            transaction.rollback().await?;
            return Ok(false);
        };
        let attempt_number: i32 = row.try_get("attempt_count")?;
        let max_attempts: i32 = row.try_get("max_attempts")?;
        let upload_session_id: String = row.try_get("upload_session_id")?;
        let retry_at = failure.retry_at.filter(|_| attempt_number < max_attempts);

        finish_attempt(
            &mut transaction,
            job_id,
            attempt_number,
            "failed",
            Some(&failure.reason_code),
            retry_at,
            failure.exception.as_ref(),
        )
        .await?;

        if let Some(retry_at) = retry_at {
            sqlx::query(
                r"
                update artifact_processing_job
                set state = 'queued', available_at = $2, lease_owner = null,
                    lease_expires_at = null, heartbeat_at = null, updated_at = now()
                where id = $1
                ",
            )
            .bind(job_id)
            .bind(retry_at)
            .execute(&mut *transaction)
            .await?;
        } else {
            if let Some(report) = &failure.validation_report {
                let primary_issue = report.primary_issue.as_ref().ok_or_else(|| {
                    JobStoreError::InconsistentState(
                        "failed validation report must contain a primary issue".to_owned(),
                    )
                })?;
                if !primary_issue_matches_legacy_reason(&failure.reason_code, &primary_issue.code) {
                    return Err(JobStoreError::InconsistentState(format!(
                        "validation report primary issue {} does not match legacy reason {}",
                        primary_issue.code, failure.reason_code
                    )));
                }
            }
            let validation_report = failure
                .validation_report
                .as_ref()
                .map(serde_json::to_value)
                .transpose()
                .map_err(|error| JobStoreError::InconsistentState(error.to_string()))?;
            fail_job_and_upload(
                &mut transaction,
                job_id,
                &upload_session_id,
                &failure.reason_code,
                &failure.summary,
                failure.retryable,
                validation_report.as_ref(),
            )
            .await?;
        }
        transaction.commit().await?;
        Ok(true)
    }

    async fn recover_expired_leases(&self, limit: i64) -> Result<u64, JobStoreError> {
        if limit <= 0 {
            return Err(JobStoreError::InvalidRecoveryLimit);
        }
        let mut transaction = self.pool.begin().await?;
        let rows = sqlx::query(
            r"
            select id, upload_session_id, attempt_count, max_attempts
            from artifact_processing_job
            where state = 'running' and lease_expires_at <= now()
            order by lease_expires_at, id
            for update skip locked
            limit $1
            ",
        )
        .bind(limit)
        .fetch_all(&mut *transaction)
        .await?;

        for row in &rows {
            let job_id: String = row.try_get("id")?;
            let upload_session_id: String = row.try_get("upload_session_id")?;
            let attempt_number: i32 = row.try_get("attempt_count")?;
            let max_attempts: i32 = row.try_get("max_attempts")?;
            finish_attempt(
                &mut transaction,
                &job_id,
                attempt_number,
                "failed",
                Some("processing_lease_expired"),
                None,
                None,
            )
            .await?;

            if attempt_number < max_attempts {
                sqlx::query(
                    r"
                    update artifact_processing_job
                    set state = 'queued', available_at = now(), lease_owner = null,
                        lease_expires_at = null, heartbeat_at = null, updated_at = now()
                    where id = $1
                    ",
                )
                .bind(&job_id)
                .execute(&mut *transaction)
                .await?;
            } else {
                fail_job_and_upload(
                    &mut transaction,
                    &job_id,
                    &upload_session_id,
                    "processing_lease_expired",
                    "Processing was interrupted.",
                    true,
                    None,
                )
                .await?;
            }
        }

        let recovered = u64::try_from(rows.len()).expect("row count always fits into u64");
        transaction.commit().await?;
        Ok(recovered)
    }
}

#[async_trait]
impl ContentBundleStore for PostgresJobStore {
    async fn lookup_raw_reuse(
        &self,
        attempt_id: &str,
        context: &RawReuseContext,
    ) -> Result<Option<RawReuseHit>, JobStoreError> {
        if context.candidates.is_empty() {
            return Ok(None);
        }
        let mut transaction = self.pool.begin().await?;
        let Some(owner_user_id) = active_attempt_owner(&mut transaction, attempt_id).await? else {
            transaction.rollback().await?;
            return Ok(None);
        };
        for candidate in &context.candidates {
            let row = sqlx::query(
                r"
                select alias.bundle_id, alias.validation_evidence
                from raw_input_fingerprint_alias as alias
                join content_bundle as bundle
                  on bundle.id = alias.bundle_id and bundle.owner_user_id = alias.owner_user_id
                where alias.owner_user_id = $1
                  and alias.fingerprint_key_revision = $2
                  and alias.reuse_fingerprint = $3
                  and alias.requested_entry_key = $4
                  and alias.policy_revision = $5
                  and alias.processing_revision = $6
                  and alias.content_identity_revision = $7
                  and alias.retired_at is null
                  and bundle.lifecycle_state = 'ready'
                  and bundle.integrity_state = 'healthy'
                ",
            )
            .bind(&owner_user_id)
            .bind(&candidate.key_revision)
            .bind(&candidate.fingerprint)
            .bind(&context.requested_entry_key)
            .bind(&context.policy_revision)
            .bind(&context.processing_revision)
            .bind(&context.content_identity_revision)
            .fetch_optional(&mut *transaction)
            .await?;
            let Some(row) = row else { continue };
            let evidence: Value = row.try_get("validation_evidence")?;
            let Ok(validation_report) =
                serde_json::from_value::<ValidationReport>(evidence.clone())
            else {
                continue;
            };
            let canonical_evidence = serde_json::to_value(&validation_report)
                .map_err(|error| JobStoreError::InconsistentState(error.to_string()))?;
            if canonical_evidence != evidence
                || validation_report.primary_issue.is_some()
                || !validation_report.issues.is_empty()
            {
                continue;
            }
            let bundle_id: String = row.try_get("bundle_id")?;
            transaction.commit().await?;
            return Ok(Some(RawReuseHit {
                bundle_id,
                validation_report,
            }));
        }
        transaction.commit().await?;
        Ok(None)
    }

    async fn prepare_bundle_writes(
        &self,
        attempt_id: &str,
        bundle_id: &str,
        lease_duration: Duration,
    ) -> Result<bool, JobStoreError> {
        let lease_milliseconds = lease_milliseconds(lease_duration)?;
        let object_prefix = format!("content-bundles/{bundle_id}/attempts/{attempt_id}/");
        let result = sqlx::query(
            r"
            update artifact_processing_attempt as attempt
            set object_prefix = $3,
                lease_expires_at = job.lease_expires_at,
                write_deadline_at = now() + ($4 * interval '1 millisecond')
            from artifact_processing_job as job, content_bundle as bundle
            where attempt.id = $1 and attempt.job_id = job.id
              and bundle.id = $2 and bundle.creator_attempt_id = attempt.id
              and attempt.owner_user_id = bundle.owner_user_id
              and attempt.state = 'running' and job.state = 'running'
              and job.lease_expires_at > now() and bundle.lifecycle_state = 'creating'
              and bundle.creator_lease_expires_at > now()
            ",
        )
        .bind(attempt_id)
        .bind(bundle_id)
        .bind(object_prefix)
        .bind(lease_milliseconds)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn mark_attempt_cleanup_eligible(&self, attempt_id: &str) -> Result<(), JobStoreError> {
        sqlx::query(
            r"
            update artifact_processing_attempt
            set cleanup_state = 'eligible',
                cleanup_eligible_at = coalesce(cleanup_eligible_at, now())
            where id = $1 and object_prefix is not null and cleanup_state = 'pending'
            ",
        )
        .bind(attempt_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn reserve_content_bundle(
        &self,
        reservation: &ContentBundleReservation,
    ) -> Result<ContentBundleReservationOutcome, JobStoreError> {
        let lease_milliseconds = lease_milliseconds(reservation.lease_duration)?;
        let mut transaction = self.pool.begin().await?;
        let owner_user_id = active_attempt_owner(&mut transaction, &reservation.attempt_id)
            .await?
            .ok_or_else(|| {
                JobStoreError::InconsistentState(format!(
                    "processing attempt {} has no active Lease",
                    reservation.attempt_id
                ))
            })?;

        if let Some(row) =
            lock_bundle_by_alias(&mut transaction, &owner_user_id, reservation).await?
        {
            let outcome =
                reserve_existing_bundle(&mut transaction, row, reservation, lease_milliseconds)
                    .await?;
            transaction.commit().await?;
            return Ok(outcome);
        }

        sqlx::query(
            r"
            insert into content_bundle (
              id, owner_user_id, content_identity_revision, creator_attempt_id,
              creator_lease_expires_at
            ) values ($1, $2, $3, $4, now() + ($5 * interval '1 millisecond'))
            ",
        )
        .bind(&reservation.bundle_id)
        .bind(&owner_user_id)
        .bind(&reservation.content_identity_revision)
        .bind(&reservation.attempt_id)
        .bind(lease_milliseconds)
        .execute(&mut *transaction)
        .await?;
        let inserted = sqlx::query(
            r"
            insert into content_bundle_fingerprint_alias (
              id, owner_user_id, bundle_id, content_identity_revision,
              fingerprint_key_revision, reuse_fingerprint
            ) values ($1, $2, $3, $4, $5, $6)
            on conflict (
              owner_user_id, content_identity_revision, fingerprint_key_revision,
              reuse_fingerprint
            ) where retired_at is null do nothing
            ",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&owner_user_id)
        .bind(&reservation.bundle_id)
        .bind(&reservation.content_identity_revision)
        .bind(&reservation.fingerprint_key_revision)
        .bind(&reservation.reuse_fingerprint)
        .execute(&mut *transaction)
        .await?;
        if inserted.rows_affected() == 1 {
            if let Some((key_revision, fingerprint)) = &reservation.previous_fingerprint {
                sqlx::query(
                    r"
                    insert into content_bundle_fingerprint_alias (
                      id, owner_user_id, bundle_id, content_identity_revision,
                      fingerprint_key_revision, reuse_fingerprint
                    ) values ($1, $2, $3, $4, $5, $6)
                    ",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&owner_user_id)
                .bind(&reservation.bundle_id)
                .bind(&reservation.content_identity_revision)
                .bind(key_revision)
                .bind(fingerprint)
                .execute(&mut *transaction)
                .await?;
            }
            transaction.commit().await?;
            return Ok(ContentBundleReservationOutcome::Reserved {
                bundle_id: reservation.bundle_id.clone(),
            });
        }

        sqlx::query("delete from content_bundle where id = $1")
            .bind(&reservation.bundle_id)
            .execute(&mut *transaction)
            .await?;
        let row = lock_bundle_by_alias(&mut transaction, &owner_user_id, reservation)
            .await?
            .ok_or_else(|| {
                JobStoreError::InconsistentState(
                    "winning Content bundle alias disappeared during reservation".to_owned(),
                )
            })?;
        let outcome =
            reserve_existing_bundle(&mut transaction, row, reservation, lease_milliseconds).await?;
        transaction.commit().await?;
        Ok(outcome)
    }

    async fn commit_content_bundle_version(
        &self,
        commit: &ReadyContentBundleVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(version_id) =
            committed_version_id(&mut transaction, &commit.version.upload_session_id).await?
        {
            transaction.commit().await?;
            return Ok(CommitOutcome::AlreadyCommitted { version_id });
        }
        let active_job = lock_active_job(
            &mut transaction,
            &commit.version.job_id,
            &commit.version.worker_id,
        )
        .await?;
        let Some(active_job) = active_job else {
            transaction.rollback().await?;
            return Ok(CommitOutcome::LeaseLost);
        };
        let attempt_number: i32 = active_job.try_get("attempt_count")?;
        let active_attempt_id: Option<String> = sqlx::query_scalar(
            "select id from artifact_processing_attempt where job_id = $1 and attempt_number = $2 and state = 'running'",
        )
        .bind(&commit.version.job_id)
        .bind(attempt_number)
        .fetch_optional(&mut *transaction)
        .await?;
        if active_attempt_id.as_deref() != Some(&commit.attempt_id) {
            transaction.rollback().await?;
            return Ok(CommitOutcome::LeaseLost);
        }
        let attempt_owner = active_attempt_owner(&mut transaction, &commit.attempt_id)
            .await?
            .ok_or_else(|| {
                JobStoreError::InconsistentState(format!(
                    "processing attempt {} has no active Lease",
                    commit.attempt_id
                ))
            })?;

        let bundle = sqlx::query(
            "select owner_user_id, lifecycle_state, integrity_state, creator_attempt_id, creator_lease_expires_at from content_bundle where id = $1 for update",
        )
        .bind(&commit.bundle_id)
        .fetch_one(&mut *transaction)
        .await?;
        let bundle_owner: String = bundle.try_get("owner_user_id")?;
        if bundle_owner != attempt_owner {
            return Err(JobStoreError::InconsistentState(
                "Content bundle and creator attempt owners differ".to_owned(),
            ));
        }
        let lifecycle_state: String = bundle.try_get("lifecycle_state")?;
        let integrity_state: String = bundle.try_get("integrity_state")?;
        if integrity_state != "healthy" {
            return Err(JobStoreError::InconsistentState(format!(
                "Content bundle {} is {integrity_state}",
                commit.bundle_id
            )));
        }
        if lifecycle_state == "creating" {
            let creator_attempt_id: Option<String> = bundle.try_get("creator_attempt_id")?;
            let creator_lease_expires_at: Option<OffsetDateTime> =
                bundle.try_get("creator_lease_expires_at")?;
            if creator_attempt_id.as_deref() != Some(&commit.attempt_id)
                || creator_lease_expires_at.is_none_or(|expiry| expiry <= OffsetDateTime::now_utc())
            {
                transaction.rollback().await?;
                return Ok(CommitOutcome::LeaseLost);
            }
            insert_content_bundle_manifest(&mut transaction, commit).await?;
            let published = sqlx::query(
                r"
                update content_bundle
                set lifecycle_state = 'ready', winning_attempt_id = $2,
                    ready_at = now(), updated_at = now()
                where id = $1 and lifecycle_state = 'creating'
                  and creator_attempt_id = $2 and creator_lease_expires_at > now()
                ",
            )
            .bind(&commit.bundle_id)
            .bind(&commit.attempt_id)
            .execute(&mut *transaction)
            .await?;
            if published.rows_affected() != 1 {
                transaction.rollback().await?;
                return Ok(CommitOutcome::LeaseLost);
            }
        } else if lifecycle_state != "ready" {
            return Err(JobStoreError::InconsistentState(format!(
                "Content bundle {} is {lifecycle_state}",
                commit.bundle_id
            )));
        }

        insert_content_bundle_version(&mut transaction, commit).await?;
        promote_raw_aliases(&mut transaction, &bundle_owner, commit).await?;
        finish_ready_states(&mut transaction, &commit.version, attempt_number).await?;
        transaction.commit().await?;
        Ok(CommitOutcome::Committed)
    }
}

async fn active_attempt_owner(
    transaction: &mut Transaction<'_, Postgres>,
    attempt_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r"
        select artifact.owner_user_id
        from artifact_processing_attempt as attempt
        join artifact_processing_job as job on job.id = attempt.job_id
        join artifact_upload_session as upload on upload.id = job.upload_session_id
        join artifact on artifact.id = upload.artifact_id
        where attempt.id = $1 and attempt.state = 'running'
          and job.state = 'running' and job.lease_expires_at > now()
        ",
    )
    .bind(attempt_id)
    .fetch_optional(&mut **transaction)
    .await
}

async fn lock_bundle_by_alias(
    transaction: &mut Transaction<'_, Postgres>,
    owner_user_id: &str,
    reservation: &ContentBundleReservation,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    let aliases = std::iter::once((
        reservation.fingerprint_key_revision.as_str(),
        reservation.reuse_fingerprint.as_str(),
    ))
    .chain(
        reservation
            .previous_fingerprint
            .as_ref()
            .map(|(revision, fingerprint)| (revision.as_str(), fingerprint.as_str())),
    );
    for (key_revision, fingerprint) in aliases {
        let row = sqlx::query(
            r"
        select bundle.id, bundle.lifecycle_state, bundle.integrity_state,
               bundle.creator_lease_expires_at
        from content_bundle_fingerprint_alias as alias
        join content_bundle as bundle
          on bundle.id = alias.bundle_id and bundle.owner_user_id = alias.owner_user_id
        where alias.owner_user_id = $1
          and alias.content_identity_revision = $2
          and alias.fingerprint_key_revision = $3
          and alias.reuse_fingerprint = $4
          and alias.retired_at is null
        for update of bundle
        ",
        )
        .bind(owner_user_id)
        .bind(&reservation.content_identity_revision)
        .bind(key_revision)
        .bind(fingerprint)
        .fetch_optional(&mut **transaction)
        .await?;
        if row.is_some() {
            return Ok(row);
        }
    }
    Ok(None)
}

async fn reserve_existing_bundle(
    transaction: &mut Transaction<'_, Postgres>,
    row: sqlx::postgres::PgRow,
    reservation: &ContentBundleReservation,
    lease_milliseconds: i64,
) -> Result<ContentBundleReservationOutcome, JobStoreError> {
    let bundle_id: String = row.try_get("id")?;
    let lifecycle_state: String = row.try_get("lifecycle_state")?;
    let integrity_state: String = row.try_get("integrity_state")?;
    if lifecycle_state == "ready" && integrity_state == "healthy" {
        return Ok(ContentBundleReservationOutcome::Ready { bundle_id });
    }
    if lifecycle_state != "creating" || integrity_state != "healthy" {
        return Err(JobStoreError::InconsistentState(format!(
            "Content bundle {bundle_id} is {lifecycle_state}/{integrity_state}"
        )));
    }
    let creator_lease_expires_at: OffsetDateTime = row.try_get("creator_lease_expires_at")?;
    if creator_lease_expires_at > OffsetDateTime::now_utc() {
        return Ok(ContentBundleReservationOutcome::Creating { bundle_id });
    }
    let reclaimed = sqlx::query(
        r"
        update content_bundle
        set creator_attempt_id = $2,
            creator_lease_expires_at = now() + ($3 * interval '1 millisecond'),
            updated_at = now()
        where id = $1 and lifecycle_state = 'creating'
          and creator_lease_expires_at <= now()
        ",
    )
    .bind(&bundle_id)
    .bind(&reservation.attempt_id)
    .bind(lease_milliseconds)
    .execute(&mut **transaction)
    .await?;
    if reclaimed.rows_affected() != 1 {
        return Err(JobStoreError::InconsistentState(format!(
            "Content bundle {bundle_id} creator changed while locked"
        )));
    }
    Ok(ContentBundleReservationOutcome::Reserved { bundle_id })
}

async fn insert_content_bundle_manifest(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ReadyContentBundleVersionCommit,
) -> Result<(), JobStoreError> {
    let owner_user_id: String =
        sqlx::query_scalar("select owner_user_id from content_bundle where id = $1")
            .bind(&commit.bundle_id)
            .fetch_one(&mut **transaction)
            .await?;
    for asset in &commit.version.manifest.files {
        let size_bytes = i64::try_from(asset.size_bytes).map_err(|_| {
            JobStoreError::InconsistentState(format!(
                "manifest asset {} size exceeds i64",
                asset.path
            ))
        })?;
        sqlx::query(
            "insert into content_bundle_asset (bundle_id, owner_user_id, path, object_key, size_bytes, content_type) values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&commit.bundle_id)
        .bind(&owner_user_id)
        .bind(&asset.path)
        .bind(&asset.object_key)
        .bind(size_bytes)
        .bind(&asset.content_type)
        .execute(&mut **transaction)
        .await?;
    }
    sqlx::query(
        "insert into content_bundle_manifest (bundle_id, owner_user_id, entry_path, object_key, file_count, total_size_bytes) values ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&commit.bundle_id)
    .bind(&owner_user_id)
    .bind(&commit.version.manifest.entry_path)
    .bind(format!(
        "content-bundles/{}/attempts/{}/manifest.json",
        commit.bundle_id, commit.attempt_id
    ))
    .bind(i32::try_from(commit.version.manifest.file_count()).map_err(|_| {
        JobStoreError::InconsistentState("manifest file count exceeds i32".to_owned())
    })?)
    .bind(i64::try_from(commit.version.manifest.total_size_bytes()).map_err(|_| {
        JobStoreError::InconsistentState("manifest total size exceeds i64".to_owned())
    })?)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_content_bundle_version(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ReadyContentBundleVersionCommit,
) -> Result<(), JobStoreError> {
    let upload = sqlx::query(
        r"
        select upload.artifact_id, artifact.owner_user_id, upload.state
        from artifact_upload_session as upload
        join artifact on artifact.id = upload.artifact_id
        where upload.id = $1
        for update of upload, artifact
        ",
    )
    .bind(&commit.version.upload_session_id)
    .fetch_one(&mut **transaction)
    .await?;
    let artifact_id: String = upload.try_get("artifact_id")?;
    let owner_user_id: String = upload.try_get("owner_user_id")?;
    let upload_state: String = upload.try_get("state")?;
    if upload_state != "processing" {
        return Err(JobStoreError::InconsistentState(format!(
            "upload session {} is {upload_state}, expected processing",
            commit.version.upload_session_id
        )));
    }
    let bundle_owner: String =
        sqlx::query_scalar("select owner_user_id from content_bundle where id = $1")
            .bind(&commit.bundle_id)
            .fetch_one(&mut **transaction)
            .await?;
    if bundle_owner != owner_user_id {
        return Err(JobStoreError::InconsistentState(
            "Content bundle and Artifact owners differ".to_owned(),
        ));
    }
    let version_number: i32 = sqlx::query_scalar(
        "select coalesce(max(version_number), 0) + 1 from artifact_version where artifact_id = $1",
    )
    .bind(&artifact_id)
    .fetch_one(&mut **transaction)
    .await?;
    sqlx::query(
        "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state, owner_user_id, content_bundle_id, renderer_revision) values ($1, $2, $3, $4, 'ready', $5, $6, $7)",
    )
    .bind(&commit.version.version_id)
    .bind(&artifact_id)
    .bind(&commit.version.upload_session_id)
    .bind(version_number)
    .bind(&owner_user_id)
    .bind(&commit.bundle_id)
    .bind(&commit.renderer_revision)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "insert into content_bundle_thumbnail_job (id, bundle_id, owner_user_id, renderer_revision) values ($1, $2, $3, $4) on conflict (bundle_id, renderer_revision) do nothing",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&commit.bundle_id)
    .bind(&owner_user_id)
    .bind(&commit.renderer_revision)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn promote_raw_aliases(
    transaction: &mut Transaction<'_, Postgres>,
    owner_user_id: &str,
    commit: &ReadyContentBundleVersionCommit,
) -> Result<(), JobStoreError> {
    let evidence = serde_json::to_value(&commit.version.validation_report)
        .map_err(|error| JobStoreError::InconsistentState(error.to_string()))?;
    for candidate in &commit.raw_reuse.candidates {
        sqlx::query(
            r"
            insert into raw_input_fingerprint_alias (
              id, owner_user_id, bundle_id, content_identity_revision,
              fingerprint_key_revision, reuse_fingerprint, requested_entry_key,
              policy_revision, processing_revision, validation_evidence
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            on conflict (
              owner_user_id, content_identity_revision, fingerprint_key_revision,
              reuse_fingerprint, requested_entry_key, policy_revision, processing_revision
            ) where retired_at is null do nothing
            ",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(owner_user_id)
        .bind(&commit.bundle_id)
        .bind(&commit.raw_reuse.content_identity_revision)
        .bind(&candidate.key_revision)
        .bind(&candidate.fingerprint)
        .bind(&commit.raw_reuse.requested_entry_key)
        .bind(&commit.raw_reuse.policy_revision)
        .bind(&commit.raw_reuse.processing_revision)
        .bind(&evidence)
        .execute(&mut **transaction)
        .await?;
        let aliased_bundle: String = sqlx::query_scalar(
            r"
            select bundle_id from raw_input_fingerprint_alias
            where owner_user_id = $1 and content_identity_revision = $2
              and fingerprint_key_revision = $3 and reuse_fingerprint = $4
              and requested_entry_key = $5 and policy_revision = $6
              and processing_revision = $7 and retired_at is null
            ",
        )
        .bind(owner_user_id)
        .bind(&commit.raw_reuse.content_identity_revision)
        .bind(&candidate.key_revision)
        .bind(&candidate.fingerprint)
        .bind(&commit.raw_reuse.requested_entry_key)
        .bind(&commit.raw_reuse.policy_revision)
        .bind(&commit.raw_reuse.processing_revision)
        .fetch_one(&mut **transaction)
        .await?;
        if aliased_bundle != commit.bundle_id {
            return Err(JobStoreError::InconsistentState(
                "raw fingerprint alias resolves to another Content bundle".to_owned(),
            ));
        }
    }
    Ok(())
}

async fn finish_ready_states(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ReadyVersionCommit,
    attempt_number: i32,
) -> Result<(), JobStoreError> {
    if commit.validation_report.primary_issue.is_some() {
        return Err(JobStoreError::InconsistentState(
            "ready validation report must not contain a primary issue".to_owned(),
        ));
    }
    let validation_report = serde_json::to_value(&commit.validation_report)
        .map_err(|error| JobStoreError::InconsistentState(error.to_string()))?;
    finish_attempt(
        transaction,
        &commit.job_id,
        attempt_number,
        "succeeded",
        None,
        None,
        None,
    )
    .await?;
    sqlx::query(
        r"
        update artifact_processing_job
        set state = 'completed', lease_owner = null, lease_expires_at = null,
            heartbeat_at = null, updated_at = now()
        where id = $1
        ",
    )
    .bind(&commit.job_id)
    .execute(&mut **transaction)
    .await?;
    let upload_update = sqlx::query(
        r"
        update artifact_upload_session
        set state = 'committed', failure_reason_code = null, failure_summary = null,
            retryable = false, validation_report = $2, updated_at = now()
        where id = $1 and state = 'processing'
        ",
    )
    .bind(&commit.upload_session_id)
    .bind(validation_report)
    .execute(&mut **transaction)
    .await?;
    if upload_update.rows_affected() != 1 {
        return Err(JobStoreError::InconsistentState(format!(
            "upload session {} was not committed",
            commit.upload_session_id
        )));
    }
    Ok(())
}

fn lease_milliseconds(duration: Duration) -> Result<i64, JobStoreError> {
    let milliseconds = duration.as_millis();
    if milliseconds == 0 {
        return Err(JobStoreError::InvalidLeaseDuration);
    }
    i64::try_from(milliseconds).map_err(|_| JobStoreError::InvalidLeaseDuration)
}

async fn lock_active_lease(
    transaction: &mut Transaction<'_, Postgres>,
    job_id: &str,
    worker_id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    let row = lock_active_job(transaction, job_id, worker_id).await?;
    row.map(|row| row.try_get("attempt_count")).transpose()
}

async fn lock_active_job(
    transaction: &mut Transaction<'_, Postgres>,
    job_id: &str,
    worker_id: &str,
) -> Result<Option<sqlx::postgres::PgRow>, sqlx::Error> {
    sqlx::query(
        r"
        select upload_session_id, attempt_count, max_attempts
        from artifact_processing_job
        where id = $1 and state = 'running' and lease_owner = $2
          and lease_expires_at > now()
        for update
        ",
    )
    .bind(job_id)
    .bind(worker_id)
    .fetch_optional(&mut **transaction)
    .await
}

async fn committed_version_id(
    transaction: &mut Transaction<'_, Postgres>,
    upload_session_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("select id from artifact_version where upload_session_id = $1")
        .bind(upload_session_id)
        .fetch_optional(&mut **transaction)
        .await
}

async fn finish_attempt(
    transaction: &mut Transaction<'_, Postgres>,
    job_id: &str,
    attempt_number: i32,
    state: &str,
    reason_code: Option<&str>,
    retry_scheduled_at: Option<OffsetDateTime>,
    exception: Option<&Value>,
) -> Result<(), JobStoreError> {
    let result = sqlx::query(
        r"
        update artifact_processing_attempt
        set state = $3, reason_code = $4, retry_scheduled_at = $5,
            exception = $6, finished_at = now()
        where job_id = $1 and attempt_number = $2 and state = 'running'
        ",
    )
    .bind(job_id)
    .bind(attempt_number)
    .bind(state)
    .bind(reason_code)
    .bind(retry_scheduled_at)
    .bind(exception)
    .execute(&mut **transaction)
    .await?;
    if result.rows_affected() != 1 {
        return Err(JobStoreError::InconsistentState(format!(
            "running attempt {attempt_number} missing for job {job_id}"
        )));
    }
    Ok(())
}

async fn fail_job_and_upload(
    transaction: &mut Transaction<'_, Postgres>,
    job_id: &str,
    upload_session_id: &str,
    reason_code: &str,
    failure_summary: &str,
    retryable: bool,
    validation_report: Option<&Value>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r"
        update artifact_processing_job
        set state = 'failed', lease_owner = null, lease_expires_at = null,
            heartbeat_at = null, updated_at = now()
        where id = $1
        ",
    )
    .bind(job_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        r"
        update artifact_upload_session
        set state = 'failed', failure_reason_code = $2,
            failure_summary = $3, retryable = $4, validation_report = $5,
            updated_at = now()
        where id = $1
        ",
    )
    .bind(upload_session_id)
    .bind(reason_code)
    .bind(failure_summary)
    .bind(retryable)
    .bind(validation_report)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}
