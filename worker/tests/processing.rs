use std::{
    io::{Cursor, Write},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::Duration,
};

use async_trait::async_trait;
use shareslices_worker::{
    format_rules::PolicySnapshot,
    job_store::{CommitOutcome, JobStoreError, ReadyVersionCommit, ReadyVersionStore},
    object_storage::{InMemoryObjectStorage, ObjectReader, ObjectStorage, ObjectStorageError},
    processing::{ProcessingAttemptInput, ProcessingError, process_attempt},
};
use tokio::sync::Mutex;
use zip::{ZipWriter, write::SimpleFileOptions};

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
    let versions = RecordingVersionStore::default();

    let completion = process_attempt(&storage, &versions, input(2))
        .await
        .expect("processing succeeds");

    assert_eq!(completion.commit_outcome, CommitOutcome::Committed);
    assert_eq!(completion.removed_staging_objects, 4);
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
            .committed_object_for_test("versions/by-upload/upload-1/index.html")
            .await
            .is_some()
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
    let versions = RecordingVersionStore::default();

    let completion = process_attempt(&storage, &versions, input(2))
        .await
        .expect("processing succeeds");

    assert_eq!(completion.manifest.entry_path, "腾讯文档盘点分析报告.html");
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
            .committed_object_for_test("versions/by-upload/upload-1/腾讯文档盘点分析报告.html")
            .await
            .expect("committed entry")
            .bytes,
        b"<html></html>"
    );
    let commit = versions.commits.lock().await;
    assert!(commit[0].validation_report.primary_issue.is_none());
    assert_eq!(commit[0].validation_report.warnings.len(), 3);
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
    let versions = RecordingVersionStore::default();

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
    let versions = RecordingVersionStore::default();

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
    let versions = RecordingVersionStore::default();

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
    let versions = RecordingVersionStore::default();

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
    }
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

#[derive(Default)]
struct RecordingVersionStore {
    commits: Mutex<Vec<ReadyVersionCommit>>,
}

#[async_trait]
impl ReadyVersionStore for RecordingVersionStore {
    async fn commit_ready_version(
        &self,
        commit: &ReadyVersionCommit,
    ) -> Result<CommitOutcome, JobStoreError> {
        self.commits.lock().await.push(commit.clone());
        Ok(CommitOutcome::Committed)
    }
}

struct TrackingStorage {
    inner: InMemoryObjectStorage,
    active: AtomicUsize,
    max_active: AtomicUsize,
    cleanup_calls: AtomicUsize,
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
