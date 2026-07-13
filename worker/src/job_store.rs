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
pub trait ReadyVersionStore: Send + Sync {
    async fn commit_ready_version(
        &self,
        commit: &ReadyVersionCommit,
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
            select id, upload_session_id, attempt_count, max_attempts
            from artifact_processing_job
            where state = 'queued'
              and available_at <= now()
              and attempt_count < max_attempts
            order by available_at, created_at, id
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
              id, job_id, attempt_number, staging_prefix
            ) values ($1, $2, $3, $4)
            ",
        )
        .bind(&attempt_id)
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
impl ReadyVersionStore for PostgresJobStore {
    async fn commit_ready_version(
        &self,
        commit: &ReadyVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError> {
        let mut transaction = self.pool.begin().await?;
        if let Some(version_id) =
            committed_version_id(&mut transaction, &commit.upload_session_id).await?
        {
            transaction.commit().await?;
            return Ok(CommitOutcome::AlreadyCommitted { version_id });
        }

        let active_job =
            lock_active_job(&mut transaction, &commit.job_id, &commit.worker_id).await?;
        let Some(active_job) = active_job else {
            if let Some(version_id) =
                committed_version_id(&mut transaction, &commit.upload_session_id).await?
            {
                transaction.commit().await?;
                return Ok(CommitOutcome::AlreadyCommitted { version_id });
            }
            transaction.rollback().await?;
            return Ok(CommitOutcome::LeaseLost);
        };
        let job_upload_session_id: String = active_job.try_get("upload_session_id")?;
        if job_upload_session_id != commit.upload_session_id {
            return Err(JobStoreError::InconsistentState(format!(
                "job {} belongs to upload session {job_upload_session_id}, not {}",
                commit.job_id, commit.upload_session_id
            )));
        }
        let attempt_number: i32 = active_job.try_get("attempt_count")?;

        insert_ready_version(&mut transaction, commit).await?;
        finish_ready_states(&mut transaction, commit, attempt_number).await?;

        transaction.commit().await?;
        Ok(CommitOutcome::Committed)
    }
}

async fn insert_ready_version(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ReadyVersionCommit,
) -> Result<(), JobStoreError> {
    let upload = sqlx::query(
        "select artifact_id, state from artifact_upload_session where id = $1 for update",
    )
    .bind(&commit.upload_session_id)
    .fetch_one(&mut **transaction)
    .await?;
    let artifact_id: String = upload.try_get("artifact_id")?;
    let upload_state: String = upload.try_get("state")?;
    if upload_state != "processing" {
        return Err(JobStoreError::InconsistentState(format!(
            "upload session {} is {upload_state}, expected processing",
            commit.upload_session_id
        )));
    }

    sqlx::query("select id from artifact where id = $1 for update")
        .bind(&artifact_id)
        .fetch_one(&mut **transaction)
        .await?;
    let version_number: i32 = sqlx::query_scalar(
        "select coalesce(max(version_number), 0) + 1 from artifact_version where artifact_id = $1",
    )
    .bind(&artifact_id)
    .fetch_one(&mut **transaction)
    .await?;
    sqlx::query(
        "insert into artifact_version (id, artifact_id, upload_session_id, version_number, state) values ($1, $2, $3, $4, 'ready')",
    )
    .bind(&commit.version_id)
    .bind(&artifact_id)
    .bind(&commit.upload_session_id)
    .bind(version_number)
    .execute(&mut **transaction)
    .await?;

    insert_manifest(transaction, commit).await?;
    sqlx::query("insert into artifact_thumbnail_job (id, version_id) values ($1, $2)")
        .bind(format!("thumbnail-{}", commit.version_id))
        .bind(&commit.version_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn insert_manifest(
    transaction: &mut Transaction<'_, Postgres>,
    commit: &ReadyVersionCommit,
) -> Result<(), JobStoreError> {
    if commit
        .manifest
        .files
        .iter()
        .filter(|asset| asset.path == commit.manifest.entry_path)
        .count()
        != 1
    {
        return Err(JobStoreError::InconsistentState(
            "manifest entry path must identify exactly one asset".to_owned(),
        ));
    }
    let file_count = i32::try_from(commit.manifest.file_count()).map_err(|_| {
        JobStoreError::InconsistentState("manifest file count exceeds i32".to_owned())
    })?;
    let total_size_bytes = i64::try_from(commit.manifest.total_size_bytes()).map_err(|_| {
        JobStoreError::InconsistentState("manifest total size exceeds i64".to_owned())
    })?;
    for asset in &commit.manifest.files {
        let size_bytes = i64::try_from(asset.size_bytes).map_err(|_| {
            JobStoreError::InconsistentState(format!(
                "manifest asset {} size exceeds i64",
                asset.path
            ))
        })?;
        sqlx::query(
            "insert into artifact_asset (version_id, path, object_key, size_bytes, content_type, sha256) values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&commit.version_id)
        .bind(&asset.path)
        .bind(&asset.object_key)
        .bind(size_bytes)
        .bind(&asset.content_type)
        .bind(&asset.sha256)
        .execute(&mut **transaction)
        .await?;
    }
    sqlx::query(
        "insert into artifact_manifest (version_id, entry_path, file_count, total_size_bytes) values ($1, $2, $3, $4)",
    )
    .bind(&commit.version_id)
    .bind(&commit.manifest.entry_path)
    .bind(file_count)
    .bind(total_size_bytes)
    .execute(&mut **transaction)
    .await?;
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
