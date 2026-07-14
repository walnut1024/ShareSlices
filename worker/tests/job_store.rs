// cspell:ignore sqlx
use std::{env, fs, path::Path, time::Duration};

use serde_json::json;
use shareslices_worker::{
    job_store::{
        CommitOutcome, ContentBundleIntegrity, ContentBundleReservation,
        ContentBundleReservationOutcome, ContentBundleStore, JobFailure, JobStore,
        PostgresJobStore, RawFingerprintCandidate, RawReuseContext,
        ReadyContentBundleVersionCommit, ReadyVersionCommit,
    },
    manifest::{ManifestAsset, ReadyManifest},
    thumbnail::requeue_failed_browser_jobs,
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
async fn equivalent_same_user_reservations_create_one_ready_bundle_and_two_versions() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_two_jobs_same_user().await;
    let first_store = PostgresJobStore::new(database.pool.clone());
    let second_store = first_store.clone();
    let first_claim = first_store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("first claim")
        .expect("first job");
    let second_claim = second_store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim")
        .expect("second job");
    let first_reservation = bundle_reservation("bundle-a", &first_claim.attempt_id);
    let second_reservation = bundle_reservation("bundle-b", &second_claim.attempt_id);

    let (first, second) = tokio::join!(
        first_store.reserve_content_bundle(&first_reservation),
        second_store.reserve_content_bundle(&second_reservation)
    );
    let outcomes = [
        first.expect("first reserve"),
        second.expect("second reserve"),
    ];
    let winner = outcomes
        .iter()
        .find_map(|outcome| match outcome {
            ContentBundleReservationOutcome::Reserved { bundle_id } => Some(bundle_id.clone()),
            _ => None,
        })
        .expect("one reservation wins");
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, ContentBundleReservationOutcome::Reserved { .. }))
            .count(),
        1
    );

    let (winner_claim, winner_worker, winner_job, winner_upload, winner_version) =
        if winner == "bundle-a" {
            (&first_claim, "worker-a", "job-1", "upload-1", "version-1")
        } else {
            (&second_claim, "worker-b", "job-2", "upload-2", "version-2")
        };
    let winner_commit = bundle_commit(
        &winner,
        &winner_claim.attempt_id,
        winner_worker,
        winner_job,
        winner_upload,
        winner_version,
    );
    assert_eq!(
        first_store
            .commit_content_bundle_version(&winner_commit)
            .await
            .expect("publish winner"),
        CommitOutcome::Committed
    );

    let (loser_claim, loser_worker, loser_job, loser_upload, loser_version) =
        if winner == "bundle-a" {
            (&second_claim, "worker-b", "job-2", "upload-2", "version-2")
        } else {
            (&first_claim, "worker-a", "job-1", "upload-1", "version-1")
        };
    assert_eq!(
        second_store
            .reserve_content_bundle(&bundle_reservation("bundle-retry", &loser_claim.attempt_id))
            .await
            .expect("reload ready winner"),
        ContentBundleReservationOutcome::Ready {
            bundle_id: winner.clone()
        }
    );
    assert_eq!(
        second_store
            .commit_content_bundle_version(&bundle_commit(
                &winner,
                &loser_claim.attempt_id,
                loser_worker,
                loser_job,
                loser_upload,
                loser_version,
            ))
            .await
            .expect("commit reused Version"),
        CommitOutcome::Committed
    );

    assert_one_bundle_with_two_versions(&database.pool, &winner).await;

    assert_retired_alias_allows_replacement(&database, &first_store, &winner).await;
    database.drop().await;
}

#[tokio::test]
async fn equivalent_fingerprints_are_isolated_by_user() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_two_jobs_different_users().await;
    let store = PostgresJobStore::new(database.pool.clone());
    let first = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("first claim")
        .expect("first job");
    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim")
        .expect("second job");

    assert!(matches!(
        store
            .reserve_content_bundle(&bundle_reservation("bundle-user-1", &first.attempt_id))
            .await
            .expect("first reservation"),
        ContentBundleReservationOutcome::Reserved { .. }
    ));
    assert!(matches!(
        store
            .reserve_content_bundle(&bundle_reservation("bundle-user-2", &second.attempt_id))
            .await
            .expect("second reservation"),
        ContentBundleReservationOutcome::Reserved { .. }
    ));
    let owners: Vec<String> =
        sqlx::query_scalar("select owner_user_id from content_bundle order by owner_user_id")
            .fetch_all(&database.pool)
            .await
            .expect("bundle owners");
    assert_eq!(owners, ["user-1", "user-2"]);
    database.drop().await;
}

#[tokio::test]
async fn rotation_backfills_the_current_alias_and_quarantine_retires_reuse() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_two_jobs_same_user().await;
    let store = PostgresJobStore::new(database.pool.clone());
    let first = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("first claim")
        .expect("first job");
    let mut old = bundle_reservation("bundle-old", &first.attempt_id);
    old.fingerprint_key_revision = "fingerprint-v1".to_owned();
    old.reuse_fingerprint = "a".repeat(64);
    assert_eq!(
        store
            .reserve_content_bundle(&old)
            .await
            .expect("old reserve"),
        ContentBundleReservationOutcome::Reserved {
            bundle_id: "bundle-old".to_owned()
        }
    );
    assert_eq!(
        store
            .commit_content_bundle_version(&bundle_commit(
                "bundle-old",
                &first.attempt_id,
                "worker-a",
                "job-1",
                "upload-1",
                "version-1",
            ))
            .await
            .expect("old commit"),
        CommitOutcome::Committed
    );

    let reindex_candidates = store
        .list_bundle_alias_reindex_candidates("fingerprint-v2", 10)
        .await
        .expect("reindex candidates");
    assert_eq!(reindex_candidates.len(), 1);
    assert_eq!(reindex_candidates[0].bundle_id, "bundle-old");
    assert!(
        store
            .install_reindexed_bundle_alias(
                &reindex_candidates[0],
                "fingerprint-v2",
                &"b".repeat(64),
            )
            .await
            .expect("install reindexed alias")
    );
    sqlx::query(
        "update content_bundle_fingerprint_alias set retired_at = now() where bundle_id = 'bundle-old' and fingerprint_key_revision = 'fingerprint-v2' and retired_at is null",
    )
    .execute(&database.pool)
    .await
    .expect("retire test current alias before lazy rotation lookup");

    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim")
        .expect("second job");
    let mut rotated = bundle_reservation("bundle-new", &second.attempt_id);
    rotated.fingerprint_key_revision = "fingerprint-v2".to_owned();
    rotated.reuse_fingerprint = "b".repeat(64);
    rotated.previous_fingerprint = Some(("fingerprint-v1".to_owned(), "a".repeat(64)));
    assert_eq!(
        store
            .reserve_content_bundle(&rotated)
            .await
            .expect("rotated lookup"),
        ContentBundleReservationOutcome::Ready {
            bundle_id: "bundle-old".to_owned()
        }
    );
    let current_aliases: i64 = sqlx::query_scalar(
        "select count(*) from content_bundle_fingerprint_alias where bundle_id = 'bundle-old' and fingerprint_key_revision = 'fingerprint-v2' and retired_at is null",
    )
    .fetch_one(&database.pool)
    .await
    .expect("current alias count");
    assert_eq!(current_aliases, 1);

    assert_bundle_quarantine(&database, &store, "bundle-old").await;

    database.drop().await;
}

async fn assert_bundle_quarantine(
    database: &TestDatabase,
    store: &PostgresJobStore,
    bundle_id: &str,
) {
    assert!(
        store
            .quarantine_content_bundle(bundle_id, ContentBundleIntegrity::Suspect)
            .await
            .expect("quarantine")
    );
    let bundle_state: String =
        sqlx::query_scalar("select integrity_state from content_bundle where id = $1")
            .bind(bundle_id)
            .fetch_one(&database.pool)
            .await
            .expect("bundle integrity");
    let active_aliases: i64 = sqlx::query_scalar(
        "select (select count(*) from content_bundle_fingerprint_alias where bundle_id = $1 and retired_at is null) + (select count(*) from raw_input_fingerprint_alias where bundle_id = $1 and retired_at is null)",
    )
    .bind(bundle_id)
    .fetch_one(&database.pool)
    .await
    .expect("active aliases");
    assert_eq!(bundle_state, "suspect");
    assert_eq!(active_aliases, 0);
}

#[tokio::test]
async fn expired_creator_is_replaced_and_stale_creator_cannot_commit() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_two_jobs_same_user().await;
    let store = PostgresJobStore::new(database.pool.clone());
    let first = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("first claim")
        .expect("first job");
    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim")
        .expect("second job");
    store
        .reserve_content_bundle(&bundle_reservation("bundle-1", &first.attempt_id))
        .await
        .expect("first reservation");
    sqlx::query(
        "update content_bundle set creator_lease_expires_at = now() - interval '1 second' where id = 'bundle-1'",
    )
    .execute(&database.pool)
    .await
    .expect("expire creator");

    assert_eq!(
        store
            .reserve_content_bundle(&bundle_reservation("unused", &second.attempt_id))
            .await
            .expect("take over"),
        ContentBundleReservationOutcome::Reserved {
            bundle_id: "bundle-1".to_owned()
        }
    );
    assert_eq!(
        store
            .commit_content_bundle_version(&bundle_commit(
                "bundle-1",
                &first.attempt_id,
                "worker-a",
                "job-1",
                "upload-1",
                "version-stale",
            ))
            .await
            .expect("stale commit rejected"),
        CommitOutcome::LeaseLost
    );
    assert_eq!(
        store
            .commit_content_bundle_version(&bundle_commit(
                "bundle-1",
                &second.attempt_id,
                "worker-b",
                "job-2",
                "upload-2",
                "version-current",
            ))
            .await
            .expect("current creator commits"),
        CommitOutcome::Committed
    );
    database.drop().await;
}

#[tokio::test]
async fn raw_alias_hit_requires_compatible_revision_and_canonical_worker_evidence() {
    let Some(database) = TestDatabase::create().await else {
        return;
    };
    database.seed_two_jobs_same_user().await;
    let store = PostgresJobStore::new(database.pool.clone());
    let first = store
        .claim_next("worker-a", Duration::from_secs(30))
        .await
        .expect("first claim")
        .expect("first job");
    let second = store
        .claim_next("worker-b", Duration::from_secs(30))
        .await
        .expect("second claim")
        .expect("second job");
    store
        .reserve_content_bundle(&bundle_reservation("bundle-raw", &first.attempt_id))
        .await
        .expect("reserve bundle");
    let commit = bundle_commit(
        "bundle-raw",
        &first.attempt_id,
        "worker-a",
        "job-1",
        "upload-1",
        "version-raw",
    );
    store
        .commit_content_bundle_version(&commit)
        .await
        .expect("commit source Version");

    assert_eq!(
        store
            .lookup_raw_reuse(&second.attempt_id, &commit.raw_reuse)
            .await
            .expect("lookup compatible alias")
            .expect("compatible alias hit")
            .bundle_id,
        "bundle-raw"
    );
    let mut retired_key = commit.raw_reuse.clone();
    retired_key.candidates[0].key_revision = "retired-key".to_owned();
    assert!(
        store
            .lookup_raw_reuse(&second.attempt_id, &retired_key)
            .await
            .expect("retired-key lookup")
            .is_none()
    );
    sqlx::query(
        "update raw_input_fingerprint_alias set validation_evidence = jsonb_set(validation_evidence, '{issues}', validation_evidence->'warnings')",
    )
    .execute(&database.pool)
    .await
    .expect("add blocking cached evidence");
    assert!(
        store
            .lookup_raw_reuse(&second.attempt_id, &commit.raw_reuse)
            .await
            .expect("corrupt-evidence lookup")
            .is_none()
    );
    database.drop().await;
}

#[tokio::test]
async fn requeue_only_resets_terminal_browser_failures_without_a_thumbnail() {
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
    store
        .reserve_content_bundle(&bundle_reservation("bundle-1", &claim.attempt_id))
        .await
        .expect("reserve bundle");
    store
        .commit_content_bundle_version(&bundle_commit(
            "bundle-1",
            &claim.attempt_id,
            "worker-a",
            "job-1",
            "upload-1",
            "version-1",
        ))
        .await
        .expect("ready bundle Version");
    sqlx::query(
        "update content_bundle_thumbnail_job set state = 'failed', attempt_count = 3, failure_reason_code = 'thumbnail_image_invalid' where bundle_id = 'bundle-1' and renderer_revision = 'renderer-v1'",
    )
    .execute(&database.pool)
    .await
    .expect("failed thumbnail job");

    assert_eq!(
        requeue_failed_browser_jobs(&database.pool)
            .await
            .expect("leave deterministic failure terminal"),
        0
    );
    sqlx::raw_sql(
        "update content_bundle_thumbnail_job set failure_reason_code = 'thumbnail_browser_failed' where bundle_id = 'bundle-1'; insert into content_bundle_thumbnail_attempt (id, job_id, attempt_number, capture_version_id, object_key, state, lease_expires_at, write_deadline_at, finished_at) select 'thumbnail-attempt-1', id, 1, 'version-1', 'content-bundles/bundle-1/thumbnails/renderer-v1/attempt-1.webp', 'succeeded', now(), now(), now() from content_bundle_thumbnail_job where bundle_id = 'bundle-1'; insert into content_bundle_thumbnail (bundle_id, owner_user_id, renderer_revision, winning_attempt_id, object_key, content_type, size_bytes, width, height, sha256) values ('bundle-1', 'user-1', 'renderer-v1', 'thumbnail-attempt-1', 'content-bundles/bundle-1/thumbnails/renderer-v1/attempt-1.webp', 'image/webp', 1, 480, 300, repeat('a', 64))",
    )
    .execute(&database.pool)
    .await
    .expect("stored thumbnail");
    assert_eq!(
        requeue_failed_browser_jobs(&database.pool)
            .await
            .expect("leave completed thumbnail terminal"),
        0
    );
    sqlx::query("delete from content_bundle_thumbnail where bundle_id = 'bundle-1'")
        .execute(&database.pool)
        .await
        .expect("remove stored thumbnail");
    assert_eq!(
        requeue_failed_browser_jobs(&database.pool)
            .await
            .expect("requeue browser failures"),
        1
    );
    let state: (String, i32, Option<String>, Option<String>) = sqlx::query_as(
        "select state, attempt_count, failure_reason_code, lease_owner from content_bundle_thumbnail_job where bundle_id = 'bundle-1' and renderer_revision = 'renderer-v1'",
    )
    .fetch_one(&database.pool)
    .await
    .expect("thumbnail job state");
    assert_eq!(state, ("queued".to_owned(), 0, None, None));

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

fn bundle_reservation(bundle_id: &str, attempt_id: &str) -> ContentBundleReservation {
    ContentBundleReservation {
        bundle_id: bundle_id.to_owned(),
        attempt_id: attempt_id.to_owned(),
        content_identity_revision: "content-identity-v1".to_owned(),
        fingerprint_key_revision: "fingerprint-v1".to_owned(),
        reuse_fingerprint: "c".repeat(64),
        previous_fingerprint: None,
        lease_duration: Duration::from_secs(30),
    }
}

fn bundle_commit(
    bundle_id: &str,
    attempt_id: &str,
    worker_id: &str,
    job_id: &str,
    upload_session_id: &str,
    version_id: &str,
) -> ReadyContentBundleVersionCommit {
    let mut version = ready_version_commit();
    worker_id.clone_into(&mut version.worker_id);
    job_id.clone_into(&mut version.job_id);
    upload_session_id.clone_into(&mut version.upload_session_id);
    version_id.clone_into(&mut version.version_id);
    for asset in &mut version.manifest.files {
        asset.object_key = format!(
            "content-bundles/{bundle_id}/attempts/{attempt_id}/files/{}",
            asset.path
        );
    }
    ReadyContentBundleVersionCommit {
        bundle_id: bundle_id.to_owned(),
        attempt_id: attempt_id.to_owned(),
        renderer_revision: "renderer-v1".to_owned(),
        version,
        raw_reuse: RawReuseContext {
            requested_entry_key: String::new(),
            policy_revision: "v0.0.1-default".to_owned(),
            processing_revision: "processing-v1".to_owned(),
            content_identity_revision: "content-identity-v1".to_owned(),
            candidates: vec![RawFingerprintCandidate {
                key_revision: "raw-key-v1".to_owned(),
                fingerprint: "e".repeat(64),
            }],
        },
    }
}

async fn assert_one_bundle_with_two_versions(pool: &PgPool, bundle_id: &str) {
    let bundle_count: i64 = sqlx::query_scalar("select count(*) from content_bundle")
        .fetch_one(pool)
        .await
        .expect("bundle count");
    let version_count: i64 =
        sqlx::query_scalar("select count(*) from artifact_version where content_bundle_id = $1")
            .bind(bundle_id)
            .fetch_one(pool)
            .await
            .expect("version count");
    assert_eq!(bundle_count, 1);
    assert_eq!(version_count, 2);
    let thumbnail_job_count: i64 = sqlx::query_scalar(
        "select count(*) from content_bundle_thumbnail_job where bundle_id = $1 and renderer_revision = 'renderer-v1'",
    )
    .bind(bundle_id)
    .fetch_one(pool)
    .await
    .expect("bundle thumbnail job count");
    assert_eq!(thumbnail_job_count, 1);
}

async fn assert_retired_alias_allows_replacement(
    database: &TestDatabase,
    store: &PostgresJobStore,
    bundle_id: &str,
) {
    sqlx::query(
        "update content_bundle_fingerprint_alias set retired_at = now() where bundle_id = $1",
    )
    .bind(bundle_id)
    .execute(&database.pool)
    .await
    .expect("retire winner alias");
    database.seed_additional_same_user_job().await;
    let claim = store
        .claim_next("worker-c", Duration::from_secs(30))
        .await
        .expect("replacement claim")
        .expect("replacement job");
    assert_eq!(
        store
            .reserve_content_bundle(&bundle_reservation(
                "bundle-after-retirement",
                &claim.attempt_id,
            ))
            .await
            .expect("reserve after alias retirement"),
        ContentBundleReservationOutcome::Reserved {
            bundle_id: "bundle-after-retirement".to_owned()
        }
    );
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
            "db/migrations/0010_artifact_thumbnail.sql",
            "db/migrations/0012_content_bundle_foundation.sql",
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
              id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
              file_count, single_file_size_bytes, formats, raw_object_key,
              raw_size_bytes
            ) values (
              'upload-1', 'artifact-1', 'user-1', 'v0.0.1-default', 52428800, 209715200,
              1000, 52428800, '[]'::jsonb, 'raw/artifact-1/upload-1.zip', 10
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

    async fn seed_two_jobs_same_user(&self) {
        self.seed_two_jobs(false).await;
    }

    async fn seed_two_jobs_different_users(&self) {
        self.seed_two_jobs(true).await;
    }

    async fn seed_additional_same_user_job(&self) {
        sqlx::raw_sql(
            r"
            insert into artifact_upload_session (
              id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
              file_count, single_file_size_bytes, formats, raw_object_key,
              raw_size_bytes
            ) values (
              'upload-3', 'artifact-1', 'user-1', 'v0.0.1-default', 52428800, 209715200,
              1000, 52428800, '[]'::jsonb, 'raw/three.zip', 10
            );
            insert into artifact_processing_job (id, upload_session_id, max_attempts)
            values ('job-3', 'upload-3', 3);
            ",
        )
        .execute(&self.pool)
        .await
        .expect("seed additional same-User job");
    }

    async fn seed_two_jobs(&self, different_users: bool) {
        let second_owner = if different_users { "user-2" } else { "user-1" };
        sqlx::raw_sql(&format!(
            r#"
            insert into "user" (id, name, email) values
              ('user-1', 'Owner One', 'one@example.com'),
              ('user-2', 'Owner Two', 'two@example.com');
            insert into artifact (id, owner_user_id, name) values
              ('artifact-1', 'user-1', 'First'),
              ('artifact-2', '{second_owner}', 'Second');
            insert into artifact_upload_session (
              id, artifact_id, owner_user_id, policy_revision, archive_size_bytes, expanded_size_bytes,
              file_count, single_file_size_bytes, formats, raw_object_key,
              raw_size_bytes
            ) values
              ('upload-1', 'artifact-1', 'user-1', 'v0.0.1-default', 52428800, 209715200,
               1000, 52428800, '[]'::jsonb, 'raw/one.zip', 10),
              ('upload-2', 'artifact-2', '{second_owner}', 'v0.0.1-default', 52428800, 209715200,
               1000, 52428800, '[]'::jsonb, 'raw/two.zip', 10);
            insert into artifact_processing_job (id, upload_session_id, max_attempts) values
              ('job-1', 'upload-1', 3), ('job-2', 'upload-2', 3);
            "#,
        ))
        .execute(&self.pool)
        .await
        .expect("seed two jobs");
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
