use std::{
    fs::File as StdFile,
    io::{self, Write},
    path::{Path, PathBuf},
};

use futures_util::{StreamExt, TryStreamExt, stream};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    archive_validation::{
        ArchiveError, ArchiveValidationFailure, ValidatedEntry, validate_zip_with_entry,
    },
    content_fingerprint::FingerprintKey,
    format_rules::PolicySnapshot,
    job_store::{
        CommitOutcome, ContentBundleReservation, ContentBundleReservationOutcome,
        ContentBundleStore, JobStoreError, RawReuseContext, ReadyContentBundleVersionCommit,
        ReadyVersionCommit,
    },
    manifest::{ManifestAsset, ReadyManifest},
    object_storage::{ObjectStorage, ObjectStorageError},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessingAttemptInput {
    pub job_id: String,
    pub worker_id: String,
    pub upload_session_id: String,
    pub attempt_id: String,
    pub version_id: String,
    pub raw_object_key: String,
    pub requested_entry: Option<String>,
    pub staging_prefix: String,
    pub policy: PolicySnapshot,
    pub write_concurrency: usize,
    pub lease_duration: std::time::Duration,
    pub content_identity_revision: String,
    pub content_fingerprint_key: FingerprintKey,
    pub previous_content_fingerprint_key: Option<FingerprintKey>,
    pub renderer_revision: String,
    pub raw_reuse: RawReuseContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptCompletion {
    pub commit_outcome: CommitOutcome,
    pub manifest: ReadyManifest,
    pub removed_staging_objects: u64,
    pub reuse_telemetry: ReuseTelemetry,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReuseOutcome {
    RawHit,
    CanonicalHit,
    FullProcess,
}

impl ReuseOutcome {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RawHit => "raw_hit",
            Self::CanonicalHit => "canonical_hit",
            Self::FullProcess => "full_process",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReuseFallbackReason {
    NoCompatibleRawMatch,
    NoCompatibleCanonicalMatch,
}

impl ReuseFallbackReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NoCompatibleRawMatch => "no_compatible_raw_match",
            Self::NoCompatibleCanonicalMatch => "no_compatible_canonical_match",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReuseTelemetry {
    pub outcome: ReuseOutcome,
    pub fallback_reason: Option<ReuseFallbackReason>,
    pub avoided_stage_count: u64,
    pub avoided_write_count: u64,
    pub avoided_write_bytes: u64,
}

#[derive(Debug, Error)]
pub enum ProcessingError {
    #[error("expanded-file write concurrency must be greater than zero")]
    InvalidConcurrency,
    #[error("attempt staging prefix is not isolated to this upload session")]
    InvalidStagingPrefix,
    #[error("temporary archive operation failed: {0}")]
    TemporaryArchive(#[source] io::Error),
    #[error(transparent)]
    Archive(Box<ArchiveValidationFailure>),
    #[error("archive extraction task failed: {0}")]
    ExtractionTask(String),
    #[error("archive entry {path} changed between validation and expansion")]
    EntryChanged { path: String },
    #[error(transparent)]
    Storage(#[from] ObjectStorageError),
    #[error(transparent)]
    Commit(#[from] JobStoreError),
    #[error("ready-Version commit lost its active processing lease")]
    LeaseLost,
    #[error("equivalent Content bundle is still being created")]
    BundleCreating,
    #[error("canonical Content identity failed: {0}")]
    ContentIdentity(String),
    #[error("private Manifest serialization failed: {0}")]
    ManifestSerialization(String),
    #[error("attempt failed ({primary}) and staging cleanup also failed ({cleanup})")]
    FailureCleanup {
        primary: Box<ProcessingError>,
        cleanup: String,
    },
    #[error("ready Version committed but staging cleanup failed: {0}")]
    CleanupAfterCommit(String),
}

/// Processes one claimed attempt using disk-backed archive and file buffers.
///
/// The `PostgreSQL` ready-Version transaction is the visibility boundary. Failed attempts
/// remove only their own staging prefix; stable committed keys remain unreachable until
/// the manifest transaction succeeds.
///
/// # Errors
///
/// Returns validation, object-storage, lease, database, or cleanup failures.
pub async fn process_attempt(
    storage: &dyn ObjectStorage,
    content_bundles: &dyn ContentBundleStore,
    input: ProcessingAttemptInput,
) -> Result<AttemptCompletion, ProcessingError> {
    validate_input(&input)?;
    if let Some(completion) = try_raw_reuse(storage, content_bundles, &input).await? {
        return Ok(completion);
    }
    let result = prepare_manifest(storage, &input).await;
    let (manifest, validation_report) = match result {
        Ok(prepared) => prepared,
        Err(error) => return cleanup_failed_attempt(storage, &input.staging_prefix, error).await,
    };

    let identity = manifest
        .content_identity(&input.content_identity_revision)
        .map_err(|error| ProcessingError::ContentIdentity(error.to_string()))?;
    let alias = input.content_fingerprint_key.alias(identity.as_bytes());
    let previous_alias = input
        .previous_content_fingerprint_key
        .as_ref()
        .map(|key| key.alias(identity.as_bytes()));
    let proposed_bundle_id = Uuid::new_v4().to_string();
    let reservation = content_bundles
        .reserve_content_bundle(&ContentBundleReservation {
            bundle_id: proposed_bundle_id,
            attempt_id: input.attempt_id.clone(),
            content_identity_revision: input.content_identity_revision.clone(),
            fingerprint_key_revision: alias.key_revision,
            reuse_fingerprint: alias.value,
            previous_fingerprint: previous_alias.map(|alias| (alias.key_revision, alias.value)),
            lease_duration: input.lease_duration,
        })
        .await?;
    let (bundle_id, publish_objects) = match reservation {
        ContentBundleReservationOutcome::Reserved { bundle_id } => (bundle_id, true),
        ContentBundleReservationOutcome::Ready { bundle_id } => (bundle_id, false),
        ContentBundleReservationOutcome::Creating { .. } => {
            return cleanup_failed_attempt(
                storage,
                &input.staging_prefix,
                ProcessingError::BundleCreating,
            )
            .await;
        }
    };
    let mut manifest = manifest;
    if publish_objects {
        if !content_bundles
            .prepare_bundle_writes(&input.attempt_id, &bundle_id, input.lease_duration)
            .await?
        {
            return cleanup_failed_attempt(
                storage,
                &input.staging_prefix,
                ProcessingError::LeaseLost,
            )
            .await;
        }
        for asset in &mut manifest.files {
            asset.object_key = format!(
                "content-bundles/{bundle_id}/attempts/{}/files/{}",
                input.attempt_id, asset.path
            );
        }
        if let Err(error) = promote_manifest(storage, &input, &bundle_id, &manifest).await {
            content_bundles
                .mark_attempt_cleanup_eligible(&input.attempt_id)
                .await?;
            return cleanup_failed_attempt(storage, &input.staging_prefix, error).await;
        }
    }

    let version = ReadyVersionCommit {
        job_id: input.job_id.clone(),
        worker_id: input.worker_id.clone(),
        upload_session_id: input.upload_session_id.clone(),
        version_id: input.version_id.clone(),
        manifest: manifest.clone(),
        validation_report,
    };
    let commit = ReadyContentBundleVersionCommit {
        bundle_id,
        attempt_id: input.attempt_id.clone(),
        renderer_revision: input.renderer_revision.clone(),
        version,
        raw_reuse: input.raw_reuse.clone(),
    };
    let outcome = commit_bundle_version(storage, content_bundles, &input, &commit).await?;

    let removed_staging_objects = storage
        .remove_staging_prefix(&input.staging_prefix)
        .await
        .map_err(|error| ProcessingError::CleanupAfterCommit(error.to_string()))?;
    let reuse_telemetry = completion_telemetry(publish_objects, &manifest);
    Ok(AttemptCompletion {
        commit_outcome: outcome,
        manifest,
        removed_staging_objects,
        reuse_telemetry,
    })
}

fn completion_telemetry(published_objects: bool, manifest: &ReadyManifest) -> ReuseTelemetry {
    if published_objects {
        return ReuseTelemetry {
            outcome: ReuseOutcome::FullProcess,
            fallback_reason: Some(ReuseFallbackReason::NoCompatibleCanonicalMatch),
            avoided_stage_count: 0,
            avoided_write_count: 0,
            avoided_write_bytes: 0,
        };
    }
    ReuseTelemetry {
        outcome: ReuseOutcome::CanonicalHit,
        fallback_reason: Some(ReuseFallbackReason::NoCompatibleRawMatch),
        avoided_stage_count: 0,
        avoided_write_count: u64::try_from(manifest.files.len()).unwrap_or(u64::MAX),
        avoided_write_bytes: manifest.total_size_bytes(),
    }
}

async fn try_raw_reuse(
    storage: &dyn ObjectStorage,
    content_bundles: &dyn ContentBundleStore,
    input: &ProcessingAttemptInput,
) -> Result<Option<AttemptCompletion>, ProcessingError> {
    let Some(hit) = content_bundles
        .lookup_raw_reuse(&input.attempt_id, &input.raw_reuse)
        .await?
    else {
        return Ok(None);
    };
    let manifest = ReadyManifest::new(String::new(), Vec::new());
    let commit = ReadyContentBundleVersionCommit {
        bundle_id: hit.bundle_id,
        attempt_id: input.attempt_id.clone(),
        renderer_revision: input.renderer_revision.clone(),
        version: ReadyVersionCommit {
            job_id: input.job_id.clone(),
            worker_id: input.worker_id.clone(),
            upload_session_id: input.upload_session_id.clone(),
            version_id: input.version_id.clone(),
            manifest: manifest.clone(),
            validation_report: hit.validation_report,
        },
        raw_reuse: input.raw_reuse.clone(),
    };
    let outcome = commit_bundle_version(storage, content_bundles, input, &commit).await?;
    let removed_staging_objects = storage
        .remove_staging_prefix(&input.staging_prefix)
        .await
        .map_err(|error| ProcessingError::CleanupAfterCommit(error.to_string()))?;
    Ok(Some(AttemptCompletion {
        commit_outcome: outcome,
        manifest,
        removed_staging_objects,
        reuse_telemetry: ReuseTelemetry {
            outcome: ReuseOutcome::RawHit,
            fallback_reason: None,
            avoided_stage_count: 2,
            avoided_write_count: 0,
            avoided_write_bytes: 0,
        },
    }))
}

async fn commit_bundle_version(
    storage: &dyn ObjectStorage,
    content_bundles: &dyn ContentBundleStore,
    input: &ProcessingAttemptInput,
    commit: &ReadyContentBundleVersionCommit,
) -> Result<CommitOutcome, ProcessingError> {
    match content_bundles.commit_content_bundle_version(commit).await {
        Ok(CommitOutcome::LeaseLost) => {
            content_bundles
                .mark_attempt_cleanup_eligible(&input.attempt_id)
                .await?;
            cleanup_failed_attempt(storage, &input.staging_prefix, ProcessingError::LeaseLost).await
        }
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            content_bundles
                .mark_attempt_cleanup_eligible(&input.attempt_id)
                .await?;
            cleanup_failed_attempt(
                storage,
                &input.staging_prefix,
                ProcessingError::Commit(error),
            )
            .await
        }
    }
}

fn validate_input(input: &ProcessingAttemptInput) -> Result<(), ProcessingError> {
    if input.write_concurrency == 0 {
        return Err(ProcessingError::InvalidConcurrency);
    }
    let required_prefix = format!("staging/{}/", input.upload_session_id);
    if !input.staging_prefix.starts_with(&required_prefix)
        || !input.staging_prefix.ends_with('/')
        || input.staging_prefix == required_prefix
    {
        return Err(ProcessingError::InvalidStagingPrefix);
    }
    Ok(())
}

async fn prepare_manifest(
    storage: &dyn ObjectStorage,
    input: &ProcessingAttemptInput,
) -> Result<(ReadyManifest, crate::validation_report::ValidationReport), ProcessingError> {
    let archive_file = NamedTempFile::new().map_err(ProcessingError::TemporaryArchive)?;
    let mut archive_writer = tokio::fs::File::from_std(
        archive_file
            .reopen()
            .map_err(ProcessingError::TemporaryArchive)?,
    );
    let limit = input.policy.archive_size_bytes();
    let mut raw = storage
        .read_raw_archive(&input.raw_object_key)
        .await?
        .take(limit + 1);
    let copied = tokio::io::copy(&mut raw, &mut archive_writer)
        .await
        .map_err(ProcessingError::TemporaryArchive)?;
    if copied > limit {
        return Err(ProcessingError::Archive(Box::new(
            ArchiveValidationFailure {
                error: ArchiveError::Format(crate::format_rules::FormatError::ArchiveSizeExceeded),
                report: crate::validation_report::ValidationReport::failure(
                    crate::validation_report::ValidationNotice::for_code(
                        "archive_too_large",
                        crate::validation_report::ValidationDetails {
                            actual_bytes: Some(copied),
                            limit_bytes: Some(limit),
                            ..Default::default()
                        },
                    ),
                    Vec::new(),
                ),
            },
        )));
    }
    archive_writer
        .flush()
        .await
        .map_err(ProcessingError::TemporaryArchive)?;
    drop(archive_writer);

    let archive_path = archive_file.path().to_owned();
    let validation_path = archive_path.clone();
    let policy = input.policy.clone();
    let requested_entry = input.requested_entry.clone();
    let validated = tokio::task::spawn_blocking(move || {
        let file = StdFile::open(validation_path).map_err(ProcessingError::TemporaryArchive)?;
        validate_zip_with_entry(file, &policy, requested_entry.as_deref())
            .map_err(|failure| ProcessingError::Archive(Box::new(failure)))
    })
    .await
    .map_err(|error| ProcessingError::ExtractionTask(error.to_string()))??;

    let entry_path = validated.entry_path().to_owned();
    let validation_report = crate::validation_report::ValidationReport {
        primary_issue: None,
        issues: Vec::new(),
        warnings: validated.warnings().to_vec(),
    };
    let staging_prefix = input.staging_prefix.clone();
    let mut assets =
        stream::iter(validated.entries().iter().cloned().map(|entry| {
            stage_entry(storage, archive_path.clone(), staging_prefix.clone(), entry)
        }))
        .buffer_unordered(input.write_concurrency)
        .try_collect::<Vec<_>>()
        .await?;
    assets.sort_by(|left, right| left.path.cmp(&right.path));
    Ok((ReadyManifest::new(entry_path, assets), validation_report))
}

async fn stage_entry(
    storage: &dyn ObjectStorage,
    archive_path: PathBuf,
    staging_prefix: String,
    entry: ValidatedEntry,
) -> Result<ManifestAsset, ProcessingError> {
    let path = entry.effective_path().to_owned();
    let extraction_path = entry.source_path().to_owned();
    let expected_size = entry.size_bytes();
    let extracted = tokio::task::spawn_blocking(move || {
        extract_entry(&archive_path, &extraction_path, expected_size)
    })
    .await
    .map_err(|error| ProcessingError::ExtractionTask(error.to_string()))??;
    let staging_key = format!("{staging_prefix}{path}");
    let reader = tokio::fs::File::from_std(
        extracted
            .file
            .reopen()
            .map_err(ProcessingError::TemporaryArchive)?,
    );
    storage
        .write_staging_object(
            &staging_key,
            expected_size,
            entry.content_type(),
            Box::pin(reader),
        )
        .await?;

    Ok(ManifestAsset {
        path: path.clone(),
        object_key: String::new(),
        size_bytes: expected_size,
        content_type: entry.content_type().to_owned(),
        sha256: extracted.sha256,
    })
}

async fn promote_manifest(
    storage: &dyn ObjectStorage,
    input: &ProcessingAttemptInput,
    bundle_id: &str,
    manifest: &ReadyManifest,
) -> Result<(), ProcessingError> {
    stream::iter(manifest.files.iter().map(|asset| async move {
        storage
            .promote_staging_object(
                &format!("{}{}", input.staging_prefix, asset.path),
                &asset.object_key,
                asset.size_bytes,
                &asset.content_type,
            )
            .await
    }))
    .buffer_unordered(input.write_concurrency)
    .try_collect::<Vec<_>>()
    .await?;
    let manifest_bytes = manifest
        .to_json()
        .map_err(|error| ProcessingError::ManifestSerialization(error.to_string()))?;
    let staging_manifest_key = format!("{}manifest.json", input.staging_prefix);
    storage
        .write_staging_object(
            &staging_manifest_key,
            u64::try_from(manifest_bytes.len()).expect("Manifest length always fits u64"),
            "application/json",
            Box::pin(io::Cursor::new(manifest_bytes.clone())),
        )
        .await?;
    storage
        .promote_staging_object(
            &staging_manifest_key,
            &format!(
                "content-bundles/{}/attempts/{}/manifest.json",
                bundle_id, input.attempt_id
            ),
            u64::try_from(manifest_bytes.len()).expect("Manifest length always fits u64"),
            "application/json",
        )
        .await?;
    Ok(())
}

async fn cleanup_failed_attempt<T>(
    storage: &dyn ObjectStorage,
    staging_prefix: &str,
    primary: ProcessingError,
) -> Result<T, ProcessingError> {
    match storage.remove_staging_prefix(staging_prefix).await {
        Ok(_) => Err(primary),
        Err(cleanup) => Err(ProcessingError::FailureCleanup {
            primary: Box::new(primary),
            cleanup: cleanup.to_string(),
        }),
    }
}

struct ExtractedEntry {
    file: NamedTempFile,
    sha256: String,
}

fn extract_entry(
    archive_path: &Path,
    entry_path: &str,
    expected_size: u64,
) -> Result<ExtractedEntry, ProcessingError> {
    let archive_file = StdFile::open(archive_path).map_err(ProcessingError::TemporaryArchive)?;
    let mut archive = ZipArchive::new(archive_file).map_err(|_| {
        ProcessingError::Archive(Box::new(ArchiveValidationFailure {
            error: ArchiveError::InvalidZip,
            report: crate::validation_report::ValidationReport::failure(
                crate::validation_report::ValidationNotice::for_code(
                    "invalid_zip",
                    crate::validation_report::ValidationDetails::default(),
                ),
                Vec::new(),
            ),
        }))
    })?;
    let mut entry = archive
        .by_name(entry_path)
        .map_err(|_| ProcessingError::EntryChanged {
            path: entry_path.to_owned(),
        })?;
    let mut file = NamedTempFile::new().map_err(ProcessingError::TemporaryArchive)?;
    let mut hasher = Sha256::new();
    let copied = {
        let mut writer = HashingWriter {
            inner: file.as_file_mut(),
            hasher: &mut hasher,
        };
        io::copy(&mut entry, &mut writer).map_err(ProcessingError::TemporaryArchive)?
    };
    if copied != expected_size {
        return Err(ProcessingError::EntryChanged {
            path: entry_path.to_owned(),
        });
    }
    file.as_file_mut()
        .flush()
        .map_err(ProcessingError::TemporaryArchive)?;
    Ok(ExtractedEntry {
        file,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

struct HashingWriter<'a, W> {
    inner: W,
    hasher: &'a mut Sha256,
}

impl<W: Write> Write for HashingWriter<'_, W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buffer)?;
        self.hasher.update(&buffer[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
