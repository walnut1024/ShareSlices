// cspell:ignore Deque oneshot
use std::{future::Future, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use shareslices_worker::{
    archive_validation::ArchiveError,
    format_rules::{FormatError, PolicySnapshot, default_format_rules},
    job_store::{
        ClaimedJob, JobFailure, JobStore, JobStoreError, PostgresJobStore, ReadyVersionStore,
    },
    logging::{EventContext, SanitizedException, Severity, WorkerEvent},
    object_storage::AwsS3ObjectStorage,
    processing::{
        AttemptCompletion, ProcessingAttemptInput, ProcessingError as AttemptError, process_attempt,
    },
    retry_policy::{
        ProcessingError, ProcessingOperation, RetryDecision, RetryPolicy, TerminalOutcome,
        ValidationFailure,
    },
};
use sqlx::{PgPool, Row};
use thiserror::Error;
use time::OffsetDateTime;
use tokio::time::{Instant, MissedTickBehavior};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub worker_id: String,
    pub poll_interval: Duration,
    pub lease_duration: Duration,
    pub heartbeat_interval: Duration,
    pub write_concurrency: usize,
    pub recovery_limit: i64,
    pub configured_max_attempts: u32,
}

#[derive(Debug, Error)]
pub enum InputError {
    #[error("processing input is inconsistent: {0}")]
    Inconsistent(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

#[async_trait]
pub trait ProcessingInputSource: Send + Sync {
    async fn load(
        &self,
        claim: &ClaimedJob,
        worker_id: &str,
        write_concurrency: usize,
    ) -> Result<ProcessingAttemptInput, InputError>;
}

#[async_trait(?Send)]
pub trait AttemptProcessor: Send + Sync {
    async fn process(
        &self,
        ready_versions: &dyn ReadyVersionStore,
        input: ProcessingAttemptInput,
    ) -> Result<AttemptCompletion, AttemptError>;
}

#[derive(Clone)]
pub struct PostgresInputSource {
    pool: PgPool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatSnapshot {
    extension: String,
    content_type: String,
    validation_kind: String,
}

impl PostgresInputSource {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ProcessingInputSource for PostgresInputSource {
    async fn load(
        &self,
        claim: &ClaimedJob,
        worker_id: &str,
        write_concurrency: usize,
    ) -> Result<ProcessingAttemptInput, InputError> {
        let row = sqlx::query(
            r"
            select raw_object_key, archive_size_bytes, expanded_size_bytes,
                   file_count, single_file_size_bytes, formats
            from artifact_upload_session
            where id = $1
            ",
        )
        .bind(&claim.upload_session_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| {
            InputError::Inconsistent(format!(
                "upload session {} was not found",
                claim.upload_session_id
            ))
        })?;
        let formats: Value = row.try_get("formats")?;
        let formats = serde_json::from_value::<Vec<FormatSnapshot>>(formats).map_err(|error| {
            InputError::Inconsistent(format!(
                "upload session {} has invalid formats: {error}",
                claim.upload_session_id
            ))
        })?;
        validate_format_snapshots(&claim.upload_session_id, &formats)?;
        let policy = PolicySnapshot::new(
            positive_bigint(&row, "archive_size_bytes")?,
            positive_bigint(&row, "expanded_size_bytes")?,
            positive_integer(&row, "file_count")?,
            positive_bigint(&row, "single_file_size_bytes")?,
            formats.iter().map(|format| format.extension.as_str()),
        )
        .map_err(|error| {
            InputError::Inconsistent(format!(
                "upload session {} has an invalid policy snapshot: {error}",
                claim.upload_session_id
            ))
        })?;

        Ok(ProcessingAttemptInput {
            job_id: claim.job_id.clone(),
            worker_id: worker_id.to_owned(),
            upload_session_id: claim.upload_session_id.clone(),
            version_id: Uuid::new_v4().to_string(),
            raw_object_key: row.try_get("raw_object_key")?,
            staging_prefix: claim.staging_prefix.clone(),
            policy,
            write_concurrency,
        })
    }
}

fn validate_format_snapshots(
    upload_session_id: &str,
    formats: &[FormatSnapshot],
) -> Result<(), InputError> {
    for format in formats {
        let deployed = default_format_rules()
            .iter()
            .find(|rule| rule.extension() == format.extension)
            .ok_or_else(|| {
                InputError::Inconsistent(format!(
                    "upload session {upload_session_id} enables unsupported extension {}",
                    format.extension
                ))
            })?;
        if deployed.content_type() != format.content_type || format.validation_kind.is_empty() {
            return Err(InputError::Inconsistent(format!(
                "upload session {upload_session_id} has invalid metadata for extension {}",
                format.extension
            )));
        }
    }
    Ok(())
}

fn positive_bigint(row: &sqlx::postgres::PgRow, column: &'static str) -> Result<u64, InputError> {
    let value: i64 = row.try_get(column)?;
    positive_value(value, column)
}

fn positive_integer(row: &sqlx::postgres::PgRow, column: &'static str) -> Result<u64, InputError> {
    let value: i32 = row.try_get(column)?;
    positive_value(i64::from(value), column)
}

fn positive_value(value: i64, column: &'static str) -> Result<u64, InputError> {
    if value <= 0 {
        return Err(InputError::Inconsistent(format!(
            "upload policy field {column} must be positive"
        )));
    }
    Ok(u64::try_from(value).expect("positive i64 always fits u64"))
}

pub struct StorageAttemptProcessor {
    storage: AwsS3ObjectStorage,
}

impl StorageAttemptProcessor {
    pub fn new(storage: AwsS3ObjectStorage) -> Self {
        Self { storage }
    }
}

#[async_trait(?Send)]
impl AttemptProcessor for StorageAttemptProcessor {
    async fn process(
        &self,
        ready_versions: &dyn ReadyVersionStore,
        input: ProcessingAttemptInput,
    ) -> Result<AttemptCompletion, AttemptError> {
        process_attempt(&self.storage, ready_versions, input).await
    }
}

pub struct WorkerRuntime<S, I, P, J> {
    store: Arc<S>,
    input_source: I,
    processor: P,
    retry_policy: RetryPolicy<J>,
    config: RuntimeConfig,
}

impl<S, I, P, J> WorkerRuntime<S, I, P, J>
where
    S: JobStore + ReadyVersionStore + 'static,
    I: ProcessingInputSource,
    P: AttemptProcessor,
    J: Fn(Duration) -> Duration,
{
    pub fn new(
        store: Arc<S>,
        input_source: I,
        processor: P,
        retry_policy: RetryPolicy<J>,
        config: RuntimeConfig,
    ) -> Self {
        Self {
            store,
            input_source,
            processor,
            retry_policy,
            config,
        }
    }

    pub async fn run_until<F>(&self, shutdown: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let (shutdown_sender, mut shutdown_receiver) = tokio::sync::watch::channel(false);
        tokio::spawn(async move {
            shutdown.await;
            shutdown_sender.send_replace(true);
        });
        loop {
            if *shutdown_receiver.borrow() {
                emit_stopped();
                return;
            }
            if self.run_iteration().await {
                continue;
            }
            tokio::select! {
                result = shutdown_receiver.changed() => {
                    if result.is_ok() && *shutdown_receiver.borrow() {
                        emit_stopped();
                    }
                    return;
                }
                () = tokio::time::sleep(self.config.poll_interval) => {}
            }
        }
    }

    async fn run_iteration(&self) -> bool {
        match self
            .store
            .recover_expired_leases(self.config.recovery_limit)
            .await
        {
            Ok(recovered) if recovered > 0 => WorkerEvent::new(
                Severity::Warn,
                "shareslices.artifact.processing.expired_leases_recovered",
                "expired processing leases recovered",
            )
            .emit(),
            Ok(_) => {}
            Err(error) => {
                emit_runtime_error(
                    "shareslices.worker.lease_recovery_failed",
                    "expired lease recovery failed",
                    &error,
                    EventContext::default(),
                );
                return false;
            }
        }

        let claim = match self
            .store
            .claim_next(&self.config.worker_id, self.config.lease_duration)
            .await
        {
            Ok(Some(claim)) => claim,
            Ok(None) => return false,
            Err(error) => {
                emit_runtime_error(
                    "shareslices.worker.claim_failed",
                    "processing job claim failed",
                    &error,
                    EventContext::default(),
                );
                return false;
            }
        };
        self.process_claim(claim).await;
        true
    }

    async fn process_claim(&self, claim: ClaimedJob) {
        let context = claim_context(&claim);
        WorkerEvent::new(
            Severity::Info,
            "shareslices.artifact.processing.started",
            "processing attempt started",
        )
        .with_context(context)
        .emit();

        let input = match self
            .input_source
            .load(
                &claim,
                &self.config.worker_id,
                self.config.write_concurrency,
            )
            .await
        {
            Ok(input) => input,
            Err(error) => {
                self.record_failure(
                    &claim,
                    ProcessingOperation::CommitReadyVersion,
                    classify_input_error(&error),
                    error.to_string(),
                )
                .await;
                return;
            }
        };

        let result = self.process_with_heartbeat(&claim, input).await;
        match result {
            Ok(_completion) => WorkerEvent::new(
                Severity::Info,
                "shareslices.artifact.processing.completed",
                "processing attempt completed",
            )
            .with_context(claim_context(&claim))
            .emit(),
            Err(error) => {
                let (operation, classified) = classify_attempt_error(&error);
                self.record_failure(&claim, operation, classified, error.to_string())
                    .await;
            }
        }
    }

    async fn process_with_heartbeat(
        &self,
        claim: &ClaimedJob,
        input: ProcessingAttemptInput,
    ) -> Result<AttemptCompletion, AttemptError> {
        let processing = self.processor.process(self.store.as_ref(), input);
        tokio::pin!(processing);
        let mut heartbeat = tokio::time::interval_at(
            Instant::now() + self.config.heartbeat_interval,
            self.config.heartbeat_interval,
        );
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                result = &mut processing => return result,
                _ = heartbeat.tick() => {
                    match self.store.heartbeat(
                        &claim.job_id,
                        &self.config.worker_id,
                        self.config.lease_duration,
                    ).await {
                        Ok(true) => {}
                        Ok(false) => {
                            WorkerEvent::new(
                                Severity::Warn,
                                "shareslices.artifact.processing.lease_lost",
                                "processing lease was lost",
                            )
                            .with_context(claim_context(claim))
                            .emit();
                            return processing.await;
                        }
                        Err(error) => emit_runtime_error(
                            "shareslices.artifact.processing.heartbeat_failed",
                            "processing heartbeat failed",
                            &error,
                            claim_context(claim),
                        ),
                    }
                }
            }
        }
    }

    async fn record_failure(
        &self,
        claim: &ClaimedJob,
        operation: ProcessingOperation,
        error: ProcessingError,
        message: String,
    ) {
        let attempt = u32::try_from(claim.attempt_number).unwrap_or(u32::MAX);
        let mut decision = self.retry_policy.decide(operation, attempt, &error);
        let configured_max_attempts =
            i32::try_from(self.config.configured_max_attempts).unwrap_or(i32::MAX);
        if matches!(decision, RetryDecision::RetryAfter(_))
            && claim.attempt_number >= claim.max_attempts.min(configured_max_attempts)
        {
            decision = RetryDecision::Terminal(TerminalOutcome::RecoverableFailure);
        }
        let fields = self
            .retry_policy
            .log_fields(operation, attempt, &error, &decision);
        let retry_at = match decision {
            RetryDecision::RetryAfter(delay) => time::Duration::try_from(delay)
                .ok()
                .and_then(|delay| OffsetDateTime::now_utc().checked_add(delay)),
            RetryDecision::Terminal(_) => None,
        };
        let retryable = !matches!(
            decision,
            RetryDecision::Terminal(TerminalOutcome::ReplaceFileRequired)
        );
        let exception = json!({
            "type": error_type(error),
            "message": message,
            "causeChain": [],
        });
        let failure = JobFailure {
            reason_code: fields.reason_code().to_owned(),
            retry_at,
            retryable,
            exception: Some(exception),
        };
        let context = EventContext {
            retry_reason_code: Some(fields.reason_code()),
            ..claim_context(claim)
        };
        WorkerEvent::new(
            match decision {
                RetryDecision::RetryAfter(_) => Severity::Warn,
                RetryDecision::Terminal(_) => Severity::Error,
            },
            fields.event_name(),
            "processing attempt failed",
        )
        .with_context(context)
        .with_exception(SanitizedException::new(
            error_type(error),
            &message,
            Option::<&str>::None,
            std::iter::empty::<&str>(),
        ))
        .emit();

        match self
            .store
            .fail(&claim.job_id, &self.config.worker_id, &failure)
            .await
        {
            Ok(true) => {}
            Ok(false) => WorkerEvent::new(
                Severity::Warn,
                "shareslices.artifact.processing.failure_lease_lost",
                "failure transition skipped because the lease was lost",
            )
            .with_context(claim_context(claim))
            .emit(),
            Err(store_error) => emit_runtime_error(
                "shareslices.artifact.processing.failure_transition_failed",
                "processing failure transition failed",
                &store_error,
                claim_context(claim),
            ),
        }
    }
}

fn emit_stopped() {
    WorkerEvent::new(
        Severity::Info,
        "shareslices.worker.stopped",
        "worker stopped",
    )
    .emit();
}

pub type ProductionRuntime = WorkerRuntime<
    PostgresJobStore,
    PostgresInputSource,
    StorageAttemptProcessor,
    fn(Duration) -> Duration,
>;

fn claim_context(claim: &ClaimedJob) -> EventContext<'_> {
    EventContext {
        upload_session_id: Some(&claim.upload_session_id),
        processing_job_id: Some(&claim.job_id),
        attempt_id: Some(&claim.attempt_id),
        ..EventContext::default()
    }
}

fn emit_runtime_error(
    event_name: &str,
    body: &str,
    error: &dyn std::error::Error,
    context: EventContext<'_>,
) {
    WorkerEvent::new(Severity::Error, event_name, body)
        .with_context(context)
        .with_exception(SanitizedException::new(
            std::any::type_name_of_val(error),
            error.to_string(),
            Option::<&str>::None,
            std::iter::empty::<&str>(),
        ))
        .emit();
}

fn classify_input_error(error: &InputError) -> ProcessingError {
    match error {
        InputError::Database(error) => classify_database_error(error),
        InputError::Inconsistent(_) => ProcessingError::Unclassified,
    }
}

fn classify_attempt_error(error: &AttemptError) -> (ProcessingOperation, ProcessingError) {
    match error {
        AttemptError::Archive(error) => (
            ProcessingOperation::ValidateArchive,
            classify_archive_error(*error),
        ),
        AttemptError::Storage(_) => (
            ProcessingOperation::WriteStagingObject,
            ProcessingError::ObjectStoreUnavailable,
        ),
        AttemptError::Commit(JobStoreError::Database(error)) => (
            ProcessingOperation::CommitReadyVersion,
            classify_database_error(error),
        ),
        AttemptError::Commit(_) => (
            ProcessingOperation::CommitReadyVersion,
            ProcessingError::WorkerInfrastructure,
        ),
        AttemptError::LeaseLost => (
            ProcessingOperation::CommitReadyVersion,
            ProcessingError::LeaseLost,
        ),
        AttemptError::TemporaryArchive(_)
        | AttemptError::ExtractionTask(_)
        | AttemptError::InvalidConcurrency
        | AttemptError::InvalidStagingPrefix
        | AttemptError::EntryChanged { .. }
        | AttemptError::CleanupAfterCommit(_) => (
            ProcessingOperation::ValidateArchive,
            ProcessingError::WorkerInfrastructure,
        ),
        AttemptError::FailureCleanup { .. } => (
            ProcessingOperation::WriteStagingObject,
            ProcessingError::Unclassified,
        ),
    }
}

fn classify_archive_error(error: ArchiveError) -> ProcessingError {
    let failure = match error {
        ArchiveError::InvalidZip | ArchiveError::DuplicatePath => ValidationFailure::InvalidZip,
        ArchiveError::UnsafePath => ValidationFailure::ArchivePathTraversal,
        ArchiveError::UnsupportedFileType => ValidationFailure::UnsupportedFileType,
        ArchiveError::NestedArchive => ValidationFailure::NestedArchive,
        ArchiveError::MissingRootIndex => ValidationFailure::MissingRootIndex,
        ArchiveError::Format(FormatError::ArchiveSizeExceeded) => {
            ValidationFailure::ArchiveSizeExceeded
        }
        ArchiveError::Format(FormatError::ExpandedSizeExceeded) => {
            ValidationFailure::ExpandedSizeExceeded
        }
        ArchiveError::Format(FormatError::FileCountExceeded) => {
            ValidationFailure::FileCountExceeded
        }
        ArchiveError::Format(FormatError::SingleFileSizeExceeded) => {
            ValidationFailure::SingleFileSizeExceeded
        }
        ArchiveError::Format(
            FormatError::UnsupportedExtension | FormatError::ExtensionDisabled,
        ) => ValidationFailure::UnsupportedExtension,
        ArchiveError::Format(FormatError::InvalidContent) => ValidationFailure::InvalidContent,
        ArchiveError::Format(FormatError::ReadFailed) => {
            return ProcessingError::WorkerInfrastructure;
        }
    };
    ProcessingError::Validation(failure)
}

fn classify_database_error(error: &sqlx::Error) -> ProcessingError {
    if matches!(error, sqlx::Error::PoolTimedOut) {
        ProcessingError::DatabaseTimeout
    } else {
        ProcessingError::DatabaseUnavailable
    }
}

fn error_type(error: ProcessingError) -> &'static str {
    match error {
        ProcessingError::Validation(_) => "ValidationFailure",
        ProcessingError::ObjectStoreTimeout | ProcessingError::ObjectStoreUnavailable => {
            "ObjectStorageFailure"
        }
        ProcessingError::DatabaseTimeout | ProcessingError::DatabaseUnavailable => {
            "DatabaseFailure"
        }
        ProcessingError::LeaseLost => "LeaseLost",
        ProcessingError::WorkerInfrastructure => "WorkerInfrastructureFailure",
        ProcessingError::Unclassified => "UnclassifiedFailure",
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, env, fs, path::Path, sync::Mutex};

    use shareslices_worker::{
        job_store::{CommitOutcome, ReadyVersionCommit},
        manifest::ReadyManifest,
    };
    use sqlx::postgres::PgPoolOptions;

    use super::*;

    #[tokio::test]
    async fn idle_iteration_recovers_expired_leases_and_keeps_running() {
        let store = Arc::new(FakeStore::default());
        store.recovered.lock().expect("recovered lock").push_back(2);
        let runtime = runtime(Arc::clone(&store), FakeProcessor::default());

        assert!(!runtime.run_iteration().await);
        assert_eq!(*store.recovery_calls.lock().expect("recovery lock"), 1);
    }

    #[tokio::test]
    async fn successful_processing_finishes_without_a_failure_transition() {
        let store = Arc::new(FakeStore::with_claim(claim(1, 3)));
        let runtime = runtime(Arc::clone(&store), FakeProcessor::succeed());

        assert!(runtime.run_iteration().await);
        assert!(store.failures.lock().expect("failure lock").is_empty());
    }

    #[tokio::test]
    async fn transient_processing_failure_is_scheduled_for_retry() {
        let store = Arc::new(FakeStore::with_claim(claim(1, 3)));
        let processor = FakeProcessor::fail(AttemptError::Storage(
            shareslices_worker::object_storage::ObjectStorageError::Read {
                key: "raw/upload.zip".to_owned(),
                message: "unavailable".to_owned(),
            },
        ));
        let runtime = runtime(Arc::clone(&store), processor);

        assert!(runtime.run_iteration().await);
        let failures = store.failures.lock().expect("failure lock");
        assert_eq!(failures[0].reason_code, "object_store_unavailable");
        assert!(failures[0].retry_at.is_some());
        assert!(failures[0].retryable);
    }

    #[tokio::test]
    async fn deterministic_validation_failure_is_terminal() {
        let store = Arc::new(FakeStore::with_claim(claim(1, 3)));
        let processor = FakeProcessor::fail(AttemptError::Archive(ArchiveError::UnsafePath));
        let runtime = runtime(Arc::clone(&store), processor);

        assert!(runtime.run_iteration().await);
        let failures = store.failures.lock().expect("failure lock");
        assert_eq!(failures[0].reason_code, "archive_path_traversal");
        assert!(failures[0].retry_at.is_none());
        assert!(!failures[0].retryable);
    }

    #[tokio::test]
    async fn processing_renews_the_lease_until_the_attempt_finishes() {
        let store = Arc::new(FakeStore::with_claim(claim(1, 3)));
        let processor = FakeProcessor {
            outcome: Mutex::new(Some(Ok(completion()))),
            delay: Duration::from_millis(25),
        };
        let mut runtime = runtime(Arc::clone(&store), processor);
        runtime.config.heartbeat_interval = Duration::from_millis(5);

        assert!(runtime.run_iteration().await);
        assert!(*store.heartbeat_calls.lock().expect("heartbeat lock") >= 1);
    }

    #[tokio::test]
    async fn shutdown_stops_an_idle_worker() {
        let store = Arc::new(FakeStore::default());
        let mut runtime = runtime(store, FakeProcessor::default());
        runtime.config.poll_interval = Duration::from_mins(1);
        let (send, receive) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            tokio::task::yield_now().await;
            send.send(()).expect("send shutdown");
        });

        tokio::time::timeout(Duration::from_millis(100), async {
            runtime
                .run_until(async {
                    receive.await.ok();
                })
                .await;
        })
        .await
        .expect("worker stops promptly");
    }

    #[tokio::test]
    async fn shutdown_finishes_the_active_attempt_without_claiming_another_job() {
        let store = Arc::new(FakeStore::with_claims([
            claim_with_id("job-1", 1, 3),
            claim_with_id("job-2", 1, 3),
        ]));
        let processor = FakeProcessor {
            outcome: Mutex::new(Some(Ok(completion()))),
            delay: Duration::from_millis(25),
        };
        let runtime = runtime(Arc::clone(&store), processor);
        let (send, receive) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            send.send(()).expect("send shutdown");
        });

        tokio::time::timeout(Duration::from_millis(100), async {
            runtime
                .run_until(async {
                    receive.await.ok();
                })
                .await;
        })
        .await
        .expect("active attempt finishes before shutdown");

        let remaining = store.claims.lock().expect("claims lock");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].job_id, "job-2");
    }

    #[tokio::test]
    async fn postgres_loader_reads_the_migrated_upload_snapshot_shape() {
        let Ok(database_url) = env::var("DATABASE_URL") else {
            eprintln!("skipping PostgreSQL loader integration test: DATABASE_URL is not set");
            return;
        };
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect(&database_url)
            .await
            .expect("connect to PostgreSQL");
        let schema = format!("worker_runtime_test_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("create schema \"{schema}\""))
            .execute(&admin)
            .await
            .expect("create test schema");
        let search_path = schema.clone();
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .after_connect(move |connection, _| {
                let statement = format!("set search_path to \"{search_path}\"");
                Box::pin(async move {
                    sqlx::query(&statement).execute(connection).await?;
                    Ok(())
                })
            })
            .connect(&database_url)
            .await
            .expect("connect to test schema");
        let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("worker is inside repository");
        for migration in [
            "db/migrations/0001_account_entry.sql",
            "db/migrations/0002_artifact_foundation.sql",
        ] {
            let sql = fs::read_to_string(repository_root.join(migration)).expect("read migration");
            sqlx::raw_sql(&sql)
                .execute(&pool)
                .await
                .expect("apply migration");
        }
        sqlx::raw_sql(
            r#"
            insert into "user" (id, name, email) values ('user-1', 'Owner', 'owner@example.com');
            insert into artifact (id, owner_user_id, name) values ('artifact-1', 'user-1', 'Artifact');
            insert into artifact_upload_session (
              id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
              file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
              raw_size_bytes
            )
            select
              'upload-1', 'artifact-1', policy.revision, policy.archive_size_bytes,
              policy.expanded_size_bytes, policy.file_count, policy.single_file_size_bytes,
              jsonb_agg(
                jsonb_build_object(
                  'extension', format.extension,
                  'contentType', format.content_type,
                  'validationKind', format.validation_kind
                ) order by format.extension
              ),
              'raw/artifact-1/upload-1.zip', repeat('a', 64), 1024
            from artifact_upload_policy policy
            join artifact_upload_policy_format format on format.policy_id = policy.id
            where policy.active
            group by policy.id;
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed upload snapshot from migrated policy");

        let loaded = PostgresInputSource::new(pool.clone())
            .load(&claim(1, 3), "worker-test", 4)
            .await
            .expect("load processing input");

        assert_eq!(loaded.raw_object_key, "raw/artifact-1/upload-1.zip");
        assert_eq!(loaded.policy, PolicySnapshot::product_defaults());
        assert_eq!(loaded.write_concurrency, 4);

        pool.close().await;
        sqlx::query(&format!("drop schema \"{schema}\" cascade"))
            .execute(&admin)
            .await
            .expect("drop test schema");
        admin.close().await;
    }

    fn runtime(
        store: Arc<FakeStore>,
        processor: FakeProcessor,
    ) -> WorkerRuntime<FakeStore, FakeInputSource, FakeProcessor, fn(Duration) -> Duration> {
        WorkerRuntime::new(
            store,
            FakeInputSource,
            processor,
            RetryPolicy::new(identity),
            RuntimeConfig {
                worker_id: "worker-test".to_owned(),
                poll_interval: Duration::from_millis(1),
                lease_duration: Duration::from_secs(30),
                heartbeat_interval: Duration::from_secs(10),
                write_concurrency: 2,
                recovery_limit: 10,
                configured_max_attempts: 3,
            },
        )
    }

    const fn identity(duration: Duration) -> Duration {
        duration
    }

    fn claim(attempt_number: i32, max_attempts: i32) -> ClaimedJob {
        claim_with_id("job-1", attempt_number, max_attempts)
    }

    fn claim_with_id(job_id: &str, attempt_number: i32, max_attempts: i32) -> ClaimedJob {
        ClaimedJob {
            job_id: job_id.to_owned(),
            upload_session_id: "upload-1".to_owned(),
            attempt_id: format!("attempt-{attempt_number}"),
            attempt_number,
            max_attempts,
            staging_prefix: format!("staging/upload-1/attempt-{attempt_number}/"),
            lease_expires_at: OffsetDateTime::now_utc() + time::Duration::seconds(30),
        }
    }

    fn input(
        claim: &ClaimedJob,
        worker_id: &str,
        write_concurrency: usize,
    ) -> ProcessingAttemptInput {
        ProcessingAttemptInput {
            job_id: claim.job_id.clone(),
            worker_id: worker_id.to_owned(),
            upload_session_id: claim.upload_session_id.clone(),
            version_id: "version-1".to_owned(),
            raw_object_key: "raw/upload.zip".to_owned(),
            staging_prefix: claim.staging_prefix.clone(),
            policy: PolicySnapshot::product_defaults(),
            write_concurrency,
        }
    }

    fn completion() -> AttemptCompletion {
        AttemptCompletion {
            commit_outcome: CommitOutcome::Committed,
            manifest: ReadyManifest::new(Vec::new()),
            removed_staging_objects: 0,
        }
    }

    #[derive(Default)]
    struct FakeStore {
        claims: Mutex<VecDeque<ClaimedJob>>,
        recovered: Mutex<VecDeque<u64>>,
        recovery_calls: Mutex<u32>,
        heartbeat_calls: Mutex<u32>,
        failures: Mutex<Vec<JobFailure>>,
    }

    impl FakeStore {
        fn with_claim(claim: ClaimedJob) -> Self {
            Self::with_claims([claim])
        }

        fn with_claims(claims: impl IntoIterator<Item = ClaimedJob>) -> Self {
            Self {
                claims: Mutex::new(claims.into_iter().collect()),
                ..Self::default()
            }
        }
    }

    #[async_trait]
    impl JobStore for FakeStore {
        async fn claim_next(
            &self,
            _worker_id: &str,
            _lease_duration: Duration,
        ) -> Result<Option<ClaimedJob>, JobStoreError> {
            Ok(self.claims.lock().expect("claims lock").pop_front())
        }

        async fn heartbeat(
            &self,
            _job_id: &str,
            _worker_id: &str,
            _lease_duration: Duration,
        ) -> Result<bool, JobStoreError> {
            *self.heartbeat_calls.lock().expect("heartbeat lock") += 1;
            Ok(true)
        }

        async fn complete(&self, _job_id: &str, _worker_id: &str) -> Result<bool, JobStoreError> {
            Ok(true)
        }

        async fn fail(
            &self,
            _job_id: &str,
            _worker_id: &str,
            failure: &JobFailure,
        ) -> Result<bool, JobStoreError> {
            self.failures
                .lock()
                .expect("failure lock")
                .push(failure.clone());
            Ok(true)
        }

        async fn recover_expired_leases(&self, _limit: i64) -> Result<u64, JobStoreError> {
            *self.recovery_calls.lock().expect("recovery lock") += 1;
            Ok(self
                .recovered
                .lock()
                .expect("recovered lock")
                .pop_front()
                .unwrap_or(0))
        }
    }

    #[async_trait]
    impl ReadyVersionStore for FakeStore {
        async fn commit_ready_version(
            &self,
            _commit: &ReadyVersionCommit,
        ) -> Result<CommitOutcome, JobStoreError> {
            Ok(CommitOutcome::Committed)
        }
    }

    struct FakeInputSource;

    #[async_trait]
    impl ProcessingInputSource for FakeInputSource {
        async fn load(
            &self,
            claim: &ClaimedJob,
            worker_id: &str,
            write_concurrency: usize,
        ) -> Result<ProcessingAttemptInput, InputError> {
            Ok(input(claim, worker_id, write_concurrency))
        }
    }

    #[derive(Default)]
    struct FakeProcessor {
        outcome: Mutex<Option<Result<AttemptCompletion, AttemptError>>>,
        delay: Duration,
    }

    impl FakeProcessor {
        fn succeed() -> Self {
            Self {
                outcome: Mutex::new(Some(Ok(completion()))),
                delay: Duration::ZERO,
            }
        }

        fn fail(error: AttemptError) -> Self {
            Self {
                outcome: Mutex::new(Some(Err(error))),
                delay: Duration::ZERO,
            }
        }
    }

    #[async_trait(?Send)]
    impl AttemptProcessor for FakeProcessor {
        async fn process(
            &self,
            _ready_versions: &dyn ReadyVersionStore,
            _input: ProcessingAttemptInput,
        ) -> Result<AttemptCompletion, AttemptError> {
            tokio::time::sleep(self.delay).await;
            self.outcome
                .lock()
                .expect("outcome lock")
                .take()
                .unwrap_or_else(|| Ok(completion()))
        }
    }
}
