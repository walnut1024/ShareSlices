use std::{
    io::{Cursor, Write},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::Duration,
};

use async_trait::async_trait;
use shareslices_worker::{
    content_fingerprint::FingerprintKey,
    format_rules::PolicySnapshot,
    job_store::{
        CommitOutcome, ContentBundleReservation, ContentBundleReservationOutcome,
        ContentBundleStore, JobStoreError, RawFingerprintCandidate, RawReuseContext, RawReuseHit,
        ReadyContentBundleVersionCommit,
    },
    object_storage::{InMemoryObjectStorage, ObjectReader, ObjectStorage, ObjectStorageError},
    processing::{ProcessingAttemptInput, ProcessingError, process_attempt},
};
use tokio::sync::Mutex;
use zip::{ZipWriter, write::SimpleFileOptions};

const CONTENT_IDENTITY_REVISION: &str = "content-identity-v1";

#[tokio::test]
async fn writes_path_sorted_manifest_with_hashes_content_types_and_bounded_concurrency() {
    let storage = TrackingStorage::new(Duration::from_millis(15));
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[
                ("z.js", b"export default 1;"),
                ("index.html", b"<html></html>"),
                ("assets/a.css", b"body {}"),
                ("assets/b.js", b"export default 2;"),
            ]),
        )
        .await;
    let versions = RecordingBundleStore::default();

    let completion = process_attempt(&storage, &versions, input(2))
        .await
        .expect("processing succeeds");

    assert_eq!(completion.commit_outcome, CommitOutcome::Committed);
    assert_eq!(completion.removed_staging_objects, 5);
    assert_eq!(
        completion
            .manifest
            .files
            .iter()
            .map(|asset| asset.path.as_str())
            .collect::<Vec<_>>(),
        ["assets/a.css", "assets/b.js", "index.html", "z.js"]
    );
    let index = completion
        .manifest
        .files
        .iter()
        .find(|asset| asset.path == "index.html")
        .expect("entry asset");
    assert_eq!(index.content_type, "text/html");
    assert_eq!(
        index.sha256,
        "b633a587c652d02386c4f16f8c6f6aab7352d97f16367c3c40576214372dd628"
    );
    assert!(storage.max_active.load(Ordering::SeqCst) <= 2);
    assert!(storage.max_active.load(Ordering::SeqCst) >= 2);
    assert!(
        storage
            .inner
            .committed_object_for_test(&format!(
                "content-bundles/{}/attempts/attempt-1/files/index.html",
                versions.commits.lock().await[0].bundle_id
            ))
            .await
            .is_some()
    );
    let bundle_id = versions.commits.lock().await[0].bundle_id.clone();
    assert_eq!(
        storage
            .inner
            .committed_object_for_test(&format!(
                "content-bundles/{bundle_id}/attempts/attempt-1/manifest.json"
            ))
            .await
            .expect("committed private Manifest")
            .bytes,
        completion.manifest.to_json().expect("serialize Manifest")
    );
    assert_eq!(versions.commits.lock().await.len(), 1);
}

#[tokio::test]
async fn named_entry_uses_source_paths_for_extraction_and_effective_paths_for_storage() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[
                ("report/腾讯文档盘点分析报告.html", b"<html></html>"),
                (
                    "report/assets/app.js",
                    b"document.body.dataset.ready='true'",
                ),
                (
                    "report/__MACOSX/._腾讯文档盘点分析报告.html",
                    b"binary metadata",
                ),
            ]),
        )
        .await;
    let versions = RecordingBundleStore::default();

    let completion = process_attempt(&storage, &versions, input(2))
        .await
        .expect("processing succeeds");

    assert_eq!(completion.manifest.entry_path, "腾讯文档盘点分析报告.html");
    assert_eq!(completion.reuse_telemetry.outcome.as_str(), "full_process");
    assert_eq!(
        completion
            .reuse_telemetry
            .fallback_reason
            .map(shareslices_worker::processing::ReuseFallbackReason::as_str),
        Some("no_compatible_canonical_match")
    );
    assert_eq!(
        completion
            .manifest
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        ["assets/app.js", "腾讯文档盘点分析报告.html"]
    );
    assert_eq!(
        storage
            .inner
            .committed_object_for_test(&format!(
                "content-bundles/{}/attempts/attempt-1/files/腾讯文档盘点分析报告.html",
                versions.commits.lock().await[0].bundle_id
            ))
            .await
            .expect("committed entry")
            .bytes,
        b"<html></html>"
    );
    let commit = versions.commits.lock().await;
    assert!(commit[0].version.validation_report.primary_issue.is_none());
    assert_eq!(commit[0].version.validation_report.warnings.len(), 3);
}

#[tokio::test]
async fn canonical_identity_ignores_zip_order_compression_timestamps_and_wrapper_metadata() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/first.zip",
            archive_with_options(
                &[
                    ("index.html", b"<html></html>"),
                    ("assets/app.js", b"export default 1;"),
                ],
                zip::CompressionMethod::Stored,
                (2020, 1, 2, 3, 4, 6),
            ),
        )
        .await;
    storage
        .inner
        .put_raw_for_test(
            "raw/second.zip",
            archive_with_options(
                &[
                    ("report/__MACOSX/._index.html", b"ignored metadata"),
                    ("report/assets/app.js", b"export default 1;"),
                    ("report/index.html", b"<html></html>"),
                ],
                zip::CompressionMethod::Deflated,
                (2025, 6, 7, 8, 9, 10),
            ),
        )
        .await;
    let versions = RecordingBundleStore::default();

    let first = process_attempt(
        &storage,
        &versions,
        input_for("upload-first", "raw/first.zip", "attempt-first"),
    )
    .await
    .expect("first processing succeeds");
    let second = process_attempt(
        &storage,
        &versions,
        input_for("upload-second", "raw/second.zip", "attempt-second"),
    )
    .await
    .expect("second processing succeeds");

    assert_eq!(
        first.manifest.content_identity(CONTENT_IDENTITY_REVISION),
        second.manifest.content_identity(CONTENT_IDENTITY_REVISION)
    );
}

#[tokio::test]
async fn canonical_identity_changes_when_normalized_content_changes() {
    let first = shareslices_worker::manifest::ReadyManifest::new(
        "index.html".to_owned(),
        vec![shareslices_worker::manifest::ManifestAsset {
            path: "index.html".to_owned(),
            object_key: "opaque/first".to_owned(),
            size_bytes: 1,
            content_type: "text/html".to_owned(),
            sha256: "a".repeat(64),
        }],
    );
    let second = shareslices_worker::manifest::ReadyManifest::new(
        "index.html".to_owned(),
        vec![shareslices_worker::manifest::ManifestAsset {
            path: "index.html".to_owned(),
            object_key: "opaque/second".to_owned(),
            size_bytes: 1,
            content_type: "text/html".to_owned(),
            sha256: "b".repeat(64),
        }],
    );

    assert_ne!(
        first.content_identity(CONTENT_IDENTITY_REVISION),
        second.content_identity(CONTENT_IDENTITY_REVISION)
    );
}

#[tokio::test]
async fn ready_bundle_hit_skips_promotion_and_commits_a_new_version_reference() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[("index.html", b"<html></html>")]),
        )
        .await;
    let bundles = FixedBundleStore::ready("existing-bundle");

    let completion = process_attempt(&storage, &bundles, input(2))
        .await
        .expect("ready hit succeeds");

    assert_eq!(completion.commit_outcome, CommitOutcome::Committed);
    assert_eq!(completion.reuse_telemetry.outcome.as_str(), "canonical_hit");
    assert_eq!(completion.reuse_telemetry.avoided_write_count, 1);
    assert!(completion.reuse_telemetry.avoided_write_bytes > 0);
    assert!(
        storage
            .inner
            .committed_object_for_test(
                "content-bundles/existing-bundle/attempts/attempt-1/files/index.html"
            )
            .await
            .is_none()
    );
    assert_eq!(bundles.commits.lock().await[0].bundle_id, "existing-bundle");
    assert_eq!(completion.removed_staging_objects, 1);
}

#[tokio::test]
async fn compatible_raw_hit_skips_archive_read_and_reuses_worker_validation_evidence() {
    let storage = TrackingStorage::new(Duration::ZERO);
    let report = shareslices_worker::validation_report::ValidationReport {
        primary_issue: None,
        issues: Vec::new(),
        warnings: vec![
            shareslices_worker::validation_report::ValidationNotice::for_code(
                "entry_file_inferred",
                shareslices_worker::validation_report::ValidationDetails {
                    entry_file: Some("index.html".to_owned()),
                    ..Default::default()
                },
            ),
        ],
    };
    let bundles = FixedBundleStore::raw_hit("raw-bundle", report.clone());

    let completion = process_attempt(&storage, &bundles, input(2))
        .await
        .expect("raw hit succeeds without raw object");

    assert_eq!(storage.read_calls.load(Ordering::SeqCst), 0);
    assert_eq!(completion.reuse_telemetry.outcome.as_str(), "raw_hit");
    assert_eq!(completion.reuse_telemetry.fallback_reason, None);
    assert_eq!(completion.reuse_telemetry.avoided_stage_count, 2);
    let commits = bundles.commits.lock().await;
    assert_eq!(commits[0].bundle_id, "raw-bundle");
    assert_eq!(commits[0].version.validation_report, report);
    assert_eq!(completion.removed_staging_objects, 0);
}

#[tokio::test]
async fn lease_loss_after_writes_cannot_publish_bundle_metadata() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[("index.html", b"<html></html>")]),
        )
        .await;
    let bundles = FixedBundleStore::lease_lost();

    let error = process_attempt(&storage, &bundles, input(2))
        .await
        .expect_err("stale attempt must fail");

    assert!(matches!(error, ProcessingError::LeaseLost));
    assert!(bundles.commits.lock().await.is_empty());
    assert!(
        storage
            .inner
            .staging_bytes_for_test("staging/upload-1/attempt-1/index.html")
            .await
            .is_none()
    );
}

#[tokio::test]
async fn failed_attempt_cleans_only_its_isolated_staging_prefix() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[
                ("index.html", b"<html></html>"),
                ("assets/app.js", b"export default 1;"),
            ]),
        )
        .await;
    storage
        .inner
        .write_staging_object(
            "staging/upload-1/other-attempt/index.html",
            4,
            "text/html",
            Box::pin(Cursor::new(b"keep".to_vec())),
        )
        .await
        .expect("seed sibling attempt");
    *storage.fail_path.lock().await = Some("assets/app.js".to_owned());
    let versions = RecordingBundleStore::default();

    let error = process_attempt(&storage, &versions, input(2))
        .await
        .expect_err("staging failure must fail the attempt");

    assert!(matches!(error, ProcessingError::Storage(_)));
    assert!(
        storage
            .inner
            .staging_bytes_for_test("staging/upload-1/attempt-1/index.html")
            .await
            .is_none()
    );
    assert_eq!(
        storage
            .inner
            .staging_bytes_for_test("staging/upload-1/other-attempt/index.html")
            .await,
        Some(b"keep".to_vec())
    );
    assert!(versions.commits.lock().await.is_empty());
}

#[tokio::test]
async fn invalid_archive_stages_nothing_and_still_runs_cleanup() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[("notes.txt", b"no root HTML entry")]),
        )
        .await;
    let versions = RecordingBundleStore::default();

    let error = process_attempt(&storage, &versions, input(2))
        .await
        .expect_err("missing root entry must fail");

    assert!(matches!(error, ProcessingError::Archive(_)));
    assert_eq!(storage.cleanup_calls.load(Ordering::SeqCst), 1);
    assert!(versions.commits.lock().await.is_empty());
}

#[tokio::test]
async fn raw_archive_copy_stops_at_limit_plus_one_and_returns_typed_failure() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test("raw/upload-1.zip", vec![0; 1024 * 1024 + 32])
        .await;
    let versions = RecordingBundleStore::default();

    let error = process_attempt(&storage, &versions, input(2))
        .await
        .expect_err("oversized raw archive must fail before ZIP validation");

    let ProcessingError::Archive(failure) = error else {
        panic!("unexpected error: {error}");
    };
    assert_eq!(
        failure.report.primary_issue.as_ref().unwrap().code,
        "archive_too_large"
    );
    assert_eq!(
        failure
            .report
            .primary_issue
            .as_ref()
            .unwrap()
            .details
            .actual_bytes,
        Some(1024 * 1024 + 1)
    );
    assert_eq!(storage.cleanup_calls.load(Ordering::SeqCst), 1);
    assert!(versions.commits.lock().await.is_empty());
}

#[tokio::test]
async fn cleanup_failure_preserves_the_primary_failure_for_reconciliation_handoff() {
    let storage = TrackingStorage::new(Duration::ZERO);
    storage
        .inner
        .put_raw_for_test(
            "raw/upload-1.zip",
            archive(&[("notes.txt", b"no root HTML entry")]),
        )
        .await;
    storage.fail_cleanup.store(true, Ordering::SeqCst);
    let versions = RecordingBundleStore::default();

    let error = process_attempt(&storage, &versions, input(2))
        .await
        .expect_err("validation and cleanup failures must be reported together");

    let ProcessingError::FailureCleanup { primary, cleanup } = error else {
        panic!("unexpected error: {error}");
    };
    let ProcessingError::Archive(failure) = primary.as_ref() else {
        panic!("typed validation primary was lost: {primary}");
    };
    assert_eq!(
        failure.report.primary_issue.as_ref().unwrap().code,
        "missing_entry_file"
    );
    assert!(cleanup.contains("injected cleanup failure"));
}

fn input(write_concurrency: usize) -> ProcessingAttemptInput {
    ProcessingAttemptInput {
        job_id: "job-1".to_owned(),
        worker_id: "worker-1".to_owned(),
        upload_session_id: "upload-1".to_owned(),
        attempt_id: "attempt-1".to_owned(),
        version_id: "version-1".to_owned(),
        raw_object_key: "raw/upload-1.zip".to_owned(),
        requested_entry: None,
        staging_prefix: "staging/upload-1/attempt-1/".to_owned(),
        policy: PolicySnapshot::new(
            1024 * 1024,
            1024 * 1024,
            20,
            1024 * 1024,
            [".html", ".css", ".js"],
        )
        .expect("policy"),
        write_concurrency,
        lease_duration: Duration::from_secs(30),
        content_identity_revision: CONTENT_IDENTITY_REVISION.to_owned(),
        content_fingerprint_key: FingerprintKey::new("fingerprint-v1", vec![b'k'; 32])
            .expect("test fingerprint key"),
        previous_content_fingerprint_key: None,
        renderer_revision: "renderer-v1".to_owned(),
        raw_reuse: RawReuseContext {
            requested_entry_key: String::new(),
            policy_revision: "v0.0.1-default".to_owned(),
            processing_revision: "processing-v1".to_owned(),
            content_identity_revision: CONTENT_IDENTITY_REVISION.to_owned(),
            candidates: vec![RawFingerprintCandidate {
                key_revision: "raw-key-v1".to_owned(),
                fingerprint: "d".repeat(64),
            }],
        },
    }
}

fn input_for(
    upload_session_id: &str,
    raw_object_key: &str,
    attempt_id: &str,
) -> ProcessingAttemptInput {
    let mut input = input(2);
    upload_session_id.clone_into(&mut input.upload_session_id);
    raw_object_key.clone_into(&mut input.raw_object_key);
    input.staging_prefix = format!("staging/{upload_session_id}/{attempt_id}/");
    attempt_id.clone_into(&mut input.attempt_id);
    input
}

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (path, body) in entries {
        writer
            .start_file(*path, SimpleFileOptions::default())
            .expect("start entry");
        writer.write_all(body).expect("write entry");
    }
    writer.finish().expect("finish archive").into_inner()
}

fn archive_with_options(
    entries: &[(&str, &[u8])],
    compression: zip::CompressionMethod,
    timestamp: (u16, u8, u8, u8, u8, u8),
) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let modified = zip::DateTime::from_date_and_time(
        timestamp.0,
        timestamp.1,
        timestamp.2,
        timestamp.3,
        timestamp.4,
        timestamp.5,
    )
    .expect("valid ZIP timestamp");
    for (path, body) in entries {
        writer
            .start_file(
                *path,
                SimpleFileOptions::default()
                    .compression_method(compression)
                    .last_modified_time(modified),
            )
            .expect("start entry");
        writer.write_all(body).expect("write entry");
    }
    writer.finish().expect("finish archive").into_inner()
}

#[derive(Default)]
struct RecordingBundleStore {
    commits: Mutex<Vec<ReadyContentBundleVersionCommit>>,
}

#[async_trait]
impl ContentBundleStore for RecordingBundleStore {
    async fn reserve_content_bundle(
        &self,
        reservation: &ContentBundleReservation,
    ) -> Result<ContentBundleReservationOutcome, JobStoreError> {
        Ok(ContentBundleReservationOutcome::Reserved {
            bundle_id: reservation.bundle_id.clone(),
        })
    }

    async fn commit_content_bundle_version(
        &self,
        commit: &ReadyContentBundleVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError> {
        self.commits.lock().await.push(commit.clone());
        Ok(CommitOutcome::Committed)
    }
}

struct FixedBundleStore {
    reservation: ContentBundleReservationOutcome,
    commit_outcome: CommitOutcome,
    commits: Mutex<Vec<ReadyContentBundleVersionCommit>>,
    raw_hit: Option<RawReuseHit>,
}

impl FixedBundleStore {
    fn ready(bundle_id: &str) -> Self {
        Self {
            reservation: ContentBundleReservationOutcome::Ready {
                bundle_id: bundle_id.to_owned(),
            },
            commit_outcome: CommitOutcome::Committed,
            commits: Mutex::new(Vec::new()),
            raw_hit: None,
        }
    }

    fn lease_lost() -> Self {
        Self {
            reservation: ContentBundleReservationOutcome::Reserved {
                bundle_id: "reserved-bundle".to_owned(),
            },
            commit_outcome: CommitOutcome::LeaseLost,
            commits: Mutex::new(Vec::new()),
            raw_hit: None,
        }
    }

    fn raw_hit(
        bundle_id: &str,
        validation_report: shareslices_worker::validation_report::ValidationReport,
    ) -> Self {
        Self {
            reservation: ContentBundleReservationOutcome::Ready {
                bundle_id: bundle_id.to_owned(),
            },
            commit_outcome: CommitOutcome::Committed,
            commits: Mutex::new(Vec::new()),
            raw_hit: Some(RawReuseHit {
                bundle_id: bundle_id.to_owned(),
                validation_report,
            }),
        }
    }
}

#[async_trait]
impl ContentBundleStore for FixedBundleStore {
    async fn lookup_raw_reuse(
        &self,
        _attempt_id: &str,
        _context: &RawReuseContext,
    ) -> Result<Option<RawReuseHit>, JobStoreError> {
        Ok(self.raw_hit.clone())
    }

    async fn reserve_content_bundle(
        &self,
        _reservation: &ContentBundleReservation,
    ) -> Result<ContentBundleReservationOutcome, JobStoreError> {
        Ok(self.reservation.clone())
    }

    async fn commit_content_bundle_version(
        &self,
        commit: &ReadyContentBundleVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError> {
        if self.commit_outcome != CommitOutcome::LeaseLost {
            self.commits.lock().await.push(commit.clone());
        }
        Ok(self.commit_outcome.clone())
    }
}

struct TrackingStorage {
    inner: InMemoryObjectStorage,
    active: AtomicUsize,
    max_active: AtomicUsize,
    cleanup_calls: AtomicUsize,
    read_calls: AtomicUsize,
    fail_cleanup: AtomicBool,
    delay: Duration,
    fail_path: Mutex<Option<String>>,
}

impl TrackingStorage {
    fn new(delay: Duration) -> Self {
        Self {
            inner: InMemoryObjectStorage::new(),
            active: AtomicUsize::new(0),
            max_active: AtomicUsize::new(0),
            cleanup_calls: AtomicUsize::new(0),
            read_calls: AtomicUsize::new(0),
            fail_cleanup: AtomicBool::new(false),
            delay,
            fail_path: Mutex::new(None),
        }
    }

    async fn track(&self) -> ActiveOperation<'_> {
        let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active.fetch_max(active, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        ActiveOperation { storage: self }
    }
}

struct ActiveOperation<'a> {
    storage: &'a TrackingStorage,
}

impl Drop for ActiveOperation<'_> {
    fn drop(&mut self) {
        self.storage.active.fetch_sub(1, Ordering::SeqCst);
    }
}

#[async_trait]
impl ObjectStorage for TrackingStorage {
    async fn read_raw_archive(&self, key: &str) -> Result<ObjectReader, ObjectStorageError> {
        self.read_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.read_raw_archive(key).await
    }

    async fn write_staging_object(
        &self,
        key: &str,
        content_length: u64,
        content_type: &str,
        body: ObjectReader,
    ) -> Result<(), ObjectStorageError> {
        let _active = self.track().await;
        if self
            .fail_path
            .lock()
            .await
            .as_deref()
            .is_some_and(|path| key.ends_with(path))
        {
            return Err(ObjectStorageError::Write {
                key: key.to_owned(),
                message: "injected failure".to_owned(),
            });
        }
        self.inner
            .write_staging_object(key, content_length, content_type, body)
            .await
    }

    async fn promote_staging_object(
        &self,
        source_key: &str,
        destination_key: &str,
        content_length: u64,
        content_type: &str,
    ) -> Result<(), ObjectStorageError> {
        let _active = self.track().await;
        self.inner
            .promote_staging_object(source_key, destination_key, content_length, content_type)
            .await
    }

    async fn remove_staging_prefix(&self, prefix: &str) -> Result<u64, ObjectStorageError> {
        self.cleanup_calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_cleanup.load(Ordering::SeqCst) {
            return Err(ObjectStorageError::Cleanup {
                prefix: prefix.to_owned(),
                message: "injected cleanup failure".to_owned(),
            });
        }
        self.inner.remove_staging_prefix(prefix).await
    }
}
