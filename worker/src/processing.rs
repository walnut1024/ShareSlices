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
use zip::ZipArchive;

use crate::{
    archive_validation::{ArchiveError, ArchiveValidationFailure, ValidatedEntry, validate_zip},
    format_rules::PolicySnapshot,
    job_store::{CommitOutcome, JobStoreError, ReadyVersionCommit, ReadyVersionStore},
    manifest::{ManifestAsset, ReadyManifest},
    object_storage::{ObjectStorage, ObjectStorageError},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProcessingAttemptInput {
    pub job_id: String,
    pub worker_id: String,
    pub upload_session_id: String,
    pub version_id: String,
    pub raw_object_key: String,
    pub staging_prefix: String,
    pub policy: PolicySnapshot,
    pub write_concurrency: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptCompletion {
    pub commit_outcome: CommitOutcome,
    pub manifest: ReadyManifest,
    pub removed_staging_objects: u64,
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
    ready_versions: &dyn ReadyVersionStore,
    input: ProcessingAttemptInput,
) -> Result<AttemptCompletion, ProcessingError> {
    validate_input(&input)?;
    let result = prepare_manifest(storage, &input).await;
    let (manifest, validation_report) = match result {
        Ok(prepared) => prepared,
        Err(error) => return cleanup_failed_attempt(storage, &input.staging_prefix, error).await,
    };

    if let Err(error) = promote_manifest(storage, &input, &manifest).await {
        return cleanup_failed_attempt(storage, &input.staging_prefix, error).await;
    }

    let commit = ReadyVersionCommit {
        job_id: input.job_id,
        worker_id: input.worker_id,
        upload_session_id: input.upload_session_id,
        version_id: input.version_id,
        manifest: manifest.clone(),
        validation_report,
    };
    let outcome = match ready_versions.commit_ready_version(&commit).await {
        Ok(CommitOutcome::LeaseLost) => {
            return cleanup_failed_attempt(
                storage,
                &input.staging_prefix,
                ProcessingError::LeaseLost,
            )
            .await;
        }
        Ok(outcome) => outcome,
        Err(error) => {
            return cleanup_failed_attempt(
                storage,
                &input.staging_prefix,
                ProcessingError::Commit(error),
            )
            .await;
        }
    };

    let removed_staging_objects = storage
        .remove_staging_prefix(&input.staging_prefix)
        .await
        .map_err(|error| ProcessingError::CleanupAfterCommit(error.to_string()))?;
    Ok(AttemptCompletion {
        commit_outcome: outcome,
        manifest,
        removed_staging_objects,
    })
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
    let validated = tokio::task::spawn_blocking(move || {
        let file = StdFile::open(validation_path).map_err(ProcessingError::TemporaryArchive)?;
        validate_zip(file, &policy).map_err(|failure| ProcessingError::Archive(Box::new(failure)))
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
    let committed_prefix = format!("versions/by-upload/{}/", input.upload_session_id);
    let mut assets = stream::iter(validated.entries().iter().cloned().map(|entry| {
        stage_entry(
            storage,
            archive_path.clone(),
            staging_prefix.clone(),
            committed_prefix.clone(),
            entry,
        )
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
    committed_prefix: String,
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
        object_key: format!("{committed_prefix}{path}"),
        size_bytes: expected_size,
        content_type: entry.content_type().to_owned(),
        sha256: extracted.sha256,
    })
}

async fn promote_manifest(
    storage: &dyn ObjectStorage,
    input: &ProcessingAttemptInput,
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
