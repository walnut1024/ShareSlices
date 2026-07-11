// cspell:ignore sqlx
use std::{env, fs, path::Path, time::Duration};

use serde_json::json;
use shareslices_worker::{
    job_store::{
        CommitOutcome, JobFailure, JobStore, PostgresJobStore, ReadyVersionCommit,
        ReadyVersionStore,
    },
    manifest::{ManifestAsset, ReadyManifest},
    validation_report::{ValidationDetails, ValidationNotice, ValidationReport},
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use time::{Duration as TimeDuration, OffsetDateTime};
use uuid::Uuid;

#[tokio::test]
async fn concurrent_workers_claim_a_job_only_once() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 3).await;
    let store = PostgresJobStore::new(database.pool.clone());

    let (first, second) = tokio::join!(
        store.claim_next("worker-a", Duration::from_secs(30)),
        store.claim_next("worker-b", Duration::from_secs(30))
    );
    let claims = [first.expect("first claim"), second.expect("second claim")];
    let claim = claims
        .iter()
        .flatten()
        .next()
        .expect("one worker should claim the job");

    assert_eq!(claims.iter().flatten().count(), 1);
    assert_eq!(claim.job_id, "job-1");
    assert_eq!(claim.upload_session_id, "upload-1");
    assert_eq!(claim.attempt_number, 1);
    assert!(claim.staging_prefix.contains(&claim.attempt_id));
    assert!(claim.staging_prefix.ends_with('/'));

    let state: (String, i32) = sqlx::query_as(
        "select state, attempt_count from artifact_processing_job where id = 'job-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("job state");
    assert_eq!(state, ("running".to_owned(), 1));
    assert_eq!(database.upload_state().await, "processing");

    database.drop().await;
}

#[tokio::test]
async fn heartbeat_and_completion_require_the_active_lease() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 3).await;
    let store = PostgresJobStore::new(database.pool.clone());
    let claim = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("claim");

    assert!(
        !store
            .heartbeat("job-1", "worker-b", Duration::from_secs(30))
            .await
            .expect("wrong-owner heartbeat")
    );
    assert!(
        store
            .heartbeat("job-1", "worker-a", Duration::from_mins(1))
            .await
            .expect("heartbeat")
    );
    assert!(
        store
            .complete("job-1", "worker-a")
            .await
            .expect("completion")
    );
    assert!(
        !store
            .complete("job-1", "worker-a")
            .await
            .expect("repeated completion")
    );

    let job_state: String =
        sqlx::query_scalar("select state from artifact_processing_job where id = 'job-1'")
            .fetch_one(&database.pool)
            .await
            .expect("job state");
    let attempt_state: String =
        sqlx::query_scalar("select state from artifact_processing_attempt where id = $1")
            .bind(&claim.attempt_id)
            .fetch_one(&database.pool)
            .await
            .expect("attempt state");
    assert_eq!(job_state, "completed");
    assert_eq!(attempt_state, "succeeded");

    database.drop().await;
}

#[tokio::test]
async fn ready_version_commit_is_atomic_and_concurrent_replay_is_effectively_once() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 3).await;
    let store = PostgresJobStore::new(database.pool.clone());
    store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("claim");
    let commit = ready_version_commit();

    let (first, second) = tokio::join!(
        store.commit_ready_version(&commit),
        store.commit_ready_version(&commit)
    );
    let outcomes = [first.expect("first commit"), second.expect("second commit")];
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| **outcome == CommitOutcome::Committed)
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, CommitOutcome::AlreadyCommitted { version_id } if version_id == "version-1"))
            .count(),
        1
    );

    let version_count: i64 = sqlx::query_scalar(
        "select count(*) from artifact_version where upload_session_id = 'upload-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("version count");
    let manifest: (String, i32, i64) = sqlx::query_as(
        "select entry_path, file_count, total_size_bytes from artifact_manifest where version_id = 'version-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("manifest");
    let assets: Vec<(String, String, String)> = sqlx::query_as(
        "select path, content_type, sha256 from artifact_asset where version_id = 'version-1' order by path",
    )
    .fetch_all(&database.pool)
    .await
    .expect("assets");
    assert_eq!(version_count, 1);
    assert_eq!(manifest, ("index.html".to_owned(), 2, 9));
    assert_eq!(assets[0].0, "app.js");
    assert_eq!(assets[1].0, "index.html");
    assert_eq!(database.job_state().await, "completed");
    assert_eq!(database.upload_state().await, "committed");
    let report: serde_json::Value = sqlx::query_scalar(
        "select validation_report from artifact_upload_session where id = 'upload-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("validation report");
    assert!(report["primaryIssue"].is_null());
    assert_eq!(report["warnings"][0]["code"], "entry_file_inferred");

    database.drop().await;
}

#[tokio::test]
async fn invalid_manifest_rolls_back_every_ready_transition() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 3).await;
    let store = PostgresJobStore::new(database.pool.clone());
    let claim = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("claim");
    let mut commit = ready_version_commit();
    commit.manifest.files[0].sha256 = "invalid".to_owned();

    store
        .commit_ready_version(&commit)
        .await
        .expect_err("database constraint must reject invalid manifest metadata");

    let version_count: i64 = sqlx::query_scalar("select count(*) from artifact_version")
        .fetch_one(&database.pool)
        .await
        .expect("version count");
    let attempt_state: String =
        sqlx::query_scalar("select state from artifact_processing_attempt where id = $1")
            .bind(&claim.attempt_id)
            .fetch_one(&database.pool)
            .await
            .expect("attempt state");
    assert_eq!(version_count, 0);
    assert_eq!(attempt_state, "running");
    assert_eq!(database.job_state().await, "running");
    assert_eq!(database.upload_state().await, "processing");

    database.drop().await;
}

#[tokio::test]
async fn manifest_with_missing_entry_asset_rolls_back_every_ready_transition() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 3).await;
    let store = PostgresJobStore::new(database.pool.clone());
    store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("claim");
    let mut commit = ready_version_commit();
    commit.manifest.entry_path = "missing.html".to_owned();

    store
        .commit_ready_version(&commit)
        .await
        .expect_err("missing entry asset must be rejected");

    let version_count: i64 = sqlx::query_scalar("select count(*) from artifact_version")
        .fetch_one(&database.pool)
        .await
        .expect("version count");
    assert_eq!(version_count, 0);
    assert_eq!(database.job_state().await, "running");
    assert_eq!(database.upload_state().await, "processing");
    database.drop().await;
}

#[tokio::test]
async fn failure_is_idempotent_and_can_schedule_one_more_attempt() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 2).await;
    let store = PostgresJobStore::new(database.pool.clone());
    let first = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("first claim");
    let retry_at = OffsetDateTime::now_utc() + TimeDuration::seconds(1);
    let failure = JobFailure {
        reason_code: "object_store_timeout".to_owned(),
        summary: "Processing could not be completed.".to_owned(),
        retry_at: Some(retry_at),
        retryable: true,
        exception: Some(json!({"type": "Timeout"})),
        validation_report: None,
    };

    assert!(
        store
            .fail("job-1", "worker-a", &failure)
            .await
            .expect("failure transition")
    );
    assert!(
        !store
            .fail("job-1", "worker-a", &failure)
            .await
            .expect("repeated failure transition")
    );
    let first_state: String =
        sqlx::query_scalar("select state from artifact_processing_attempt where id = $1")
            .bind(&first.attempt_id)
            .fetch_one(&database.pool)
            .await
            .expect("first attempt state");
    assert_eq!(first_state, "failed");

    sqlx::query("update artifact_processing_job set available_at = now() where id = 'job-1'")
        .execute(&database.pool)
        .await
        .expect("make retry available");
    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim query")
        .expect("second claim");
    assert_eq!(second.attempt_number, 2);

    let terminal = JobFailure {
        reason_code: "invalid_content".to_owned(),
        summary: "The ZIP contains a file with invalid content.".to_owned(),
        retry_at: None,
        retryable: false,
        exception: None,
        validation_report: Some(ValidationReport::failure(
            ValidationNotice::for_code(
                "invalid_file_content",
                ValidationDetails {
                    path: Some("assets/chart.png".to_owned()),
                    ..ValidationDetails::default()
                },
            ),
            Vec::new(),
        )),
    };
    assert!(
        store
            .fail("job-1", "worker-b", &terminal)
            .await
            .expect("terminal transition")
    );
    assert_eq!(database.job_state().await, "failed");
    assert_eq!(database.upload_state().await, "failed");
    let failure: (String, String) = sqlx::query_as(
        "select failure_reason_code, failure_summary from artifact_upload_session where id = 'upload-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("failure details");
    assert_eq!(
        failure,
        (
            "invalid_content".to_owned(),
            "The ZIP contains a file with invalid content.".to_owned()
        )
    );
    let report: serde_json::Value = sqlx::query_scalar(
        "select validation_report from artifact_upload_session where id = 'upload-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("validation report");
    assert_eq!(report["primaryIssue"]["code"], "invalid_file_content");
    assert_eq!(
        report["primaryIssue"]["details"]["path"],
        "assets/chart.png"
    );

    database.drop().await;
}

#[tokio::test]
async fn validation_failure_rejects_a_missing_or_mismatched_primary_issue_atomically() {
    for (suffix, report) in [
        ("missing", ValidationReport::default()),
        (
            "mismatch",
            ValidationReport::failure(
                ValidationNotice::for_code("unsupported_format", ValidationDetails::default()),
                Vec::new(),
            ),
        ),
    ] {
        let Some(database) = TestDatabase::create().await else {
            return;
        };
        database.seed_job("job-1", 1).await;
        let store = PostgresJobStore::new(database.pool.clone());
        let claim = store
            .claim_next("worker-a", Duration::from_secs(30))
            .await
            .expect("claim query")
            .expect("claim");
        let failure = JobFailure {
            reason_code: "invalid_content".to_owned(),
            summary: "The ZIP contains a file with invalid content.".to_owned(),
            retry_at: None,
            retryable: false,
            exception: None,
            validation_report: Some(report),
        };

        let error = store
            .fail("job-1", "worker-a", &failure)
            .await
            .expect_err("invalid validation report must be rejected");
        assert!(
            error.to_string().contains("validation report"),
            "{suffix}: {error}"
        );
        let attempt_state: String =
            sqlx::query_scalar("select state from artifact_processing_attempt where id = $1")
                .bind(&claim.attempt_id)
                .fetch_one(&database.pool)
                .await
                .expect("attempt state");
        assert_eq!(attempt_state, "running", "{suffix}");
        assert_eq!(database.job_state().await, "running", "{suffix}");
        assert_eq!(database.upload_state().await, "processing", "{suffix}");
        database.drop().await;
    }
}

#[tokio::test]
async fn expired_leases_requeue_remaining_attempts_and_fail_exhausted_jobs() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_job("job-1", 2).await;
    let store = PostgresJobStore::new(database.pool.clone());
    store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("claim query")
        .expect("first claim");
    database.expire_lease().await;

    assert_eq!(store.recover_expired_leases(10).await.expect("recovery"), 1);
    assert_eq!(
        store
            .recover_expired_leases(10)
            .await
            .expect("repeat recovery"),
        0
    );
    assert_eq!(database.job_state().await, "queued");

    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim query")
        .expect("second claim");
    assert_eq!(second.attempt_number, 2);
    database.expire_lease().await;

    assert_eq!(store.recover_expired_leases(10).await.expect("recovery"), 1);
    assert_eq!(database.job_state().await, "failed");
    assert_eq!(database.upload_state().await, "failed");
    let summary: String = sqlx::query_scalar(
        "select failure_summary from artifact_upload_session where id = 'upload-1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("failure summary");
    assert_eq!(summary, "Processing was interrupted.");

    database.drop().await;
}

struct TestDatabase {
    admin: PgPool,
    pool: PgPool,
    schema: String,
}

fn ready_version_commit() -> ReadyVersionCommit {
    ReadyVersionCommit {
        job_id: "job-1".to_owned(),
        worker_id: "worker-a".to_owned(),
        upload_session_id: "upload-1".to_owned(),
        version_id: "version-1".to_owned(),
        manifest: ReadyManifest::new(
            "index.html".to_owned(),
            vec![
                ManifestAsset {
                    path: "index.html".to_owned(),
                    object_key: "versions/by-upload/upload-1/index.html".to_owned(),
                    size_bytes: 5,
                    content_type: "text/html".to_owned(),
                    sha256: "a".repeat(64),
                },
                ManifestAsset {
                    path: "app.js".to_owned(),
                    object_key: "versions/by-upload/upload-1/app.js".to_owned(),
                    size_bytes: 4,
                    content_type: "text/javascript".to_owned(),
                    sha256: "b".repeat(64),
                },
            ],
        ),
        validation_report: ValidationReport {
            primary_issue: None,
            issues: Vec::new(),
            warnings: vec![ValidationNotice::for_code(
                "entry_file_inferred",
                ValidationDetails {
                    entry_file: Some("index.html".to_owned()),
                    ..ValidationDetails::default()
                },
            )],
        },
    }
}

impl TestDatabase {
    async fn create() -> Option<Self> {
        let Ok(database_url) = env::var("DATABASE_URL") else {
            eprintln!("skipping PostgreSQL integration test: DATABASE_URL is not set");
            return None;
        };
        let admin = PgPoolOptions::new()
            .max_connections(4)
            .connect(&database_url)
            .await
            .expect("connect to PostgreSQL");
        let schema = format!("worker_test_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("create schema \"{schema}\""))
            .execute(&admin)
            .await
            .expect("create isolated schema");
        let search_path = schema.clone();
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .after_connect(move |connection, _| {
                let statement = format!("set search_path to \"{search_path}\"");
                Box::pin(async move {
                    sqlx::query(&statement).execute(connection).await?;
                    Ok(())
                })
            })
            .connect(&database_url)
            .await
            .expect("connect to isolated schema");

        let repository_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("worker must be inside the repository");
        for migration in [
            "db/migrations/0001_account_entry.sql",
            "db/migrations/0002_artifact_foundation.sql",
            "db/migrations/0003_artifact_validation_report.sql",
        ] {
            let sql = fs::read_to_string(repository_root.join(migration)).expect("read migration");
            sqlx::raw_sql(&sql)
                .execute(&pool)
                .await
                .expect("apply migration");
        }

        Some(Self {
            admin,
            pool,
            schema,
        })
    }

    async fn seed_job(&self, job_id: &str, max_attempts: i32) {
        sqlx::raw_sql(
            r#"
            insert into "user" (id, name, email)
            values ('user-1', 'Owner', 'owner@example.com');
            insert into artifact (id, owner_user_id, name)
            values ('artifact-1', 'user-1', 'Artifact');
            insert into artifact_upload_session (
              id, artifact_id, policy_revision, archive_size_bytes, expanded_size_bytes,
              file_count, single_file_size_bytes, formats, raw_object_key, raw_sha256,
              raw_size_bytes
            ) values (
              'upload-1', 'artifact-1', 'v0.0.1-default', 52428800, 209715200,
              1000, 52428800, '[]'::jsonb, 'raw/artifact-1/upload-1.zip',
              repeat('a', 64), 10
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .expect("seed upload session");
        sqlx::query(
            "insert into artifact_processing_job (id, upload_session_id, max_attempts) values ($1, 'upload-1', $2)",
        )
        .bind(job_id)
        .bind(max_attempts)
        .execute(&self.pool)
        .await
        .expect("seed job");
    }

    async fn expire_lease(&self) {
        sqlx::query(
            "update artifact_processing_job set lease_expires_at = now() - interval '1 second' where id = 'job-1'",
        )
        .execute(&self.pool)
        .await
        .expect("expire lease");
    }

    async fn job_state(&self) -> String {
        sqlx::query_scalar("select state from artifact_processing_job where id = 'job-1'")
            .fetch_one(&self.pool)
            .await
            .expect("job state")
    }

    async fn upload_state(&self) -> String {
        sqlx::query_scalar("select state from artifact_upload_session where id = 'upload-1'")
            .fetch_one(&self.pool)
            .await
            .expect("upload state")
    }

    async fn drop(self) {
        self.pool.close().await;
        sqlx::query(&format!("drop schema \"{}\" cascade", self.schema))
            .execute(&self.admin)
            .await
            .expect("drop isolated schema");
        self.admin.close().await;
    }
}
