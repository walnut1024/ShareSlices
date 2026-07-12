// cspell:ignore eocd rposition
use std::collections::BTreeSet;
use std::io::{self, Read, Seek, SeekFrom};

use thiserror::Error;
use zip::ZipArchive;

use crate::format_rules::{FormatError, PolicySnapshot};
use crate::validation_report::{ValidationDetails, ValidationNotice, ValidationReport};

const UNIX_FILE_TYPE_MASK: u32 = 0o170_000;
const UNIX_REGULAR_FILE: u32 = 0o100_000;
const UNIX_DIRECTORY: u32 = 0o040_000;
const END_OF_CENTRAL_DIRECTORY_SIZE: usize = 22;
const MAX_ZIP_COMMENT_SIZE: usize = u16::MAX as usize;
const NESTED_ARCHIVE_EXTENSIONS: [&str; 8] =
    [".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedArchive {
    entry_path: String,
    entries: Vec<ValidatedEntry>,
    warnings: Vec<ValidationNotice>,
}

impl ValidatedArchive {
    #[must_use]
    pub fn entry_path(&self) -> &str {
        &self.entry_path
    }
    #[must_use]
    pub fn entries(&self) -> &[ValidatedEntry] {
        &self.entries
    }
    #[must_use]
    pub fn warnings(&self) -> &[ValidationNotice] {
        &self.warnings
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedEntry {
    source_path: String,
    effective_path: String,
    size_bytes: u64,
    content_type: &'static str,
}

impl ValidatedEntry {
    #[must_use]
    pub fn source_path(&self) -> &str {
        &self.source_path
    }
    #[must_use]
    pub fn effective_path(&self) -> &str {
        &self.effective_path
    }
    #[must_use]
    pub fn path(&self) -> &str {
        &self.effective_path
    }
    #[must_use]
    pub const fn size_bytes(&self) -> u64 {
        self.size_bytes
    }
    #[must_use]
    pub const fn content_type(&self) -> &'static str {
        self.content_type
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ArchiveError {
    #[error("ZIP data is invalid or unsupported")]
    InvalidZip,
    #[error("ZIP contains an unsafe or non-normalized path")]
    UnsafePath,
    #[error("ZIP contains duplicate file paths")]
    DuplicatePath,
    #[error("ZIP contains a link or special file")]
    UnsupportedFileType,
    #[error("ZIP contains a nested archive")]
    NestedArchive,
    #[error("ZIP does not contain a root HTML entry")]
    MissingEntryFile,
    #[error("ZIP contains multiple root HTML entries")]
    AmbiguousEntryFile,
    #[error(transparent)]
    Format(#[from] FormatError),
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{error}")]
pub struct ArchiveValidationFailure {
    pub error: ArchiveError,
    pub report: ValidationReport,
}

#[derive(Clone, Debug)]
struct EffectiveEntry {
    source_path: String,
    effective_path: String,
    size_bytes: u64,
}

/// Validates and normalizes a ZIP against an immutable policy snapshot.
///
/// # Errors
/// Returns a typed operational error together with a safe validation report.
#[allow(clippy::result_large_err)]
pub fn validate_zip<R: Read + Seek>(
    mut reader: R,
    policy: &PolicySnapshot,
) -> Result<ValidatedArchive, ArchiveValidationFailure> {
    validate_zip_inner(&mut reader, policy, None)
        .map_err(|(error, report)| ArchiveValidationFailure { error, report })
}

/// Validates an archive, strictly using `requested_entry` when supplied.
///
/// # Errors
/// Returns the validation failure and structured report for invalid archives or entries.
#[allow(clippy::result_large_err)]
pub fn validate_zip_with_entry<R: Read + Seek>(
    mut reader: R,
    policy: &PolicySnapshot,
    requested_entry: Option<&str>,
) -> Result<ValidatedArchive, ArchiveValidationFailure> {
    validate_zip_inner(&mut reader, policy, requested_entry)
        .map_err(|(error, report)| ArchiveValidationFailure { error, report })
}

#[allow(clippy::result_large_err, clippy::too_many_lines)]
fn validate_zip_inner<R: Read + Seek>(
    reader: &mut R,
    policy: &PolicySnapshot,
    requested_entry: Option<&str>,
) -> Result<ValidatedArchive, (ArchiveError, ValidationReport)> {
    let archive_size = reader.seek(SeekFrom::End(0)).map_err(|_| {
        failure(
            ArchiveError::InvalidZip,
            "invalid_zip",
            ValidationDetails::default(),
            vec![],
        )
    })?;
    if let Err(error) = policy.check_archive_size(archive_size) {
        return Err(failure(
            error.into(),
            "archive_too_large",
            ValidationDetails {
                actual_bytes: Some(archive_size),
                limit_bytes: Some(policy.archive_size_bytes()),
                ..Default::default()
            },
            vec![],
        ));
    }
    reader.seek(SeekFrom::Start(0)).map_err(|_| {
        failure(
            ArchiveError::InvalidZip,
            "invalid_zip",
            ValidationDetails::default(),
            vec![],
        )
    })?;
    let declared = declared_entry_count(reader, archive_size)
        .map_err(|e| failure(e, code_for(e), ValidationDetails::default(), vec![]))?;
    // Every ZIP entry consumes central-directory bytes in the already bounded raw archive.
    // Reject impossible declarations before allocating path sets or effective-entry storage.
    if declared > archive_size / 22 {
        return Err(failure(
            ArchiveError::InvalidZip,
            "invalid_zip",
            ValidationDetails::default(),
            vec![],
        ));
    }
    reader.seek(SeekFrom::Start(0)).map_err(|_| {
        failure(
            ArchiveError::InvalidZip,
            "invalid_zip",
            ValidationDetails::default(),
            vec![],
        )
    })?;
    let mut archive = ZipArchive::new(reader).map_err(|_| {
        failure(
            ArchiveError::InvalidZip,
            "invalid_zip",
            ValidationDetails::default(),
            vec![],
        )
    })?;
    if archive.len() as u64 != declared {
        return Err(failure(
            ArchiveError::DuplicatePath,
            "duplicate_archive_path",
            ValidationDetails::default(),
            vec![],
        ));
    }

    let mut raw_paths = BTreeSet::new();
    let mut effective = Vec::new();
    let mut ignored_count = 0_u64;
    let mut ignored_samples = Vec::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|_| {
            failure(
                ArchiveError::InvalidZip,
                "invalid_zip",
                ValidationDetails::default(),
                vec![],
            )
        })?;
        let path = normalize_path(file.name(), file.is_dir())
            .map_err(|e| failure(e, code_for(e), ValidationDetails::default(), vec![]))?;
        validate_file_type(file.unix_mode(), file.is_dir(), file.is_symlink()).map_err(|e| {
            failure(
                e,
                code_for(e),
                ValidationDetails {
                    path: Some(path.clone()),
                    ..Default::default()
                },
                vec![],
            )
        })?;
        if !raw_paths.insert(path.clone()) {
            return Err(failure(
                ArchiveError::DuplicatePath,
                "duplicate_archive_path",
                ValidationDetails {
                    path: Some(path),
                    ..Default::default()
                },
                vec![],
            ));
        }
        if file.is_dir() {
            continue;
        }
        if is_ignored_metadata(&path) {
            ignored_count = ignored_count.saturating_add(1);
            if ignored_samples.len() < 20 {
                ignored_samples.push(path);
            }
            continue;
        }
        effective.push(EffectiveEntry {
            source_path: path.clone(),
            effective_path: path,
            size_bytes: file.size(),
        });
    }
    let mut warnings = Vec::new();
    if ignored_count != 0 {
        warnings.push(ValidationNotice::for_code(
            "ignored_system_metadata",
            ValidationDetails {
                ignored_count: Some(ignored_count),
                paths: Some(ignored_samples),
                ..Default::default()
            },
        ));
    }
    remove_wrapper(&mut effective, &mut warnings).map_err(|e| {
        failure(
            e,
            code_for(e),
            ValidationDetails::default(),
            warnings.clone(),
        )
    })?;
    effective.sort_by(|a, b| a.effective_path.cmp(&b.effective_path));
    let entry_path = if let Some(requested) = requested_entry {
        if requested.is_empty()
            || requested.starts_with('/')
            || requested.contains('\\')
            || requested
                .split('/')
                .any(|part| part == ".." || part.is_empty())
            || !effective
                .iter()
                .any(|entry| entry.effective_path == requested)
            || !has_html_extension(requested)
        {
            return Err(failure(
                ArchiveError::MissingEntryFile,
                "missing_entry_file",
                ValidationDetails {
                    entry_file: Some(requested.to_owned()),
                    ..Default::default()
                },
                warnings,
            ));
        }
        requested.to_owned()
    } else {
        resolve_entry(&effective, &mut warnings)
            .map_err(|(e, d)| failure(e, code_for(e), d, warnings.clone()))?
    };

    let mut entries = Vec::new();
    let mut expanded = 0_u64;
    for (index, item) in effective.into_iter().enumerate() {
        let count = u64::try_from(index).unwrap_or(u64::MAX);
        if is_nested_archive(&item.effective_path) {
            return Err(failure(
                ArchiveError::NestedArchive,
                "nested_archive",
                path_details(&item.effective_path),
                warnings,
            ));
        }
        if let Err(error) =
            policy.check_entry(&item.effective_path, item.size_bytes, count, expanded)
        {
            let details = format_details(
                error,
                &item.effective_path,
                item.size_bytes,
                count + 1,
                expanded.saturating_add(item.size_bytes),
                policy,
            );
            return Err(failure(error.into(), format_code(error), details, warnings));
        }
        let mut file = archive.by_name(&item.source_path).map_err(|_| {
            failure(
                ArchiveError::InvalidZip,
                "invalid_zip",
                ValidationDetails::default(),
                warnings.clone(),
            )
        })?;
        let remaining = policy.expanded_size_bytes().saturating_sub(expanded);
        let limit = policy.single_file_size_bytes().min(remaining);
        let mut bounded = BoundedReader::new(&mut file, limit);
        let format = match policy.validate_file(&item.effective_path, &mut bounded) {
            Err(FormatError::ReadFailed) if bounded.limit_exceeded() => {
                let error = if policy.single_file_size_bytes() <= remaining {
                    FormatError::SingleFileSizeExceeded
                } else {
                    FormatError::ExpandedSizeExceeded
                };
                return Err(failure(
                    error.into(),
                    format_code(error),
                    format_details(
                        error,
                        &item.effective_path,
                        item.size_bytes,
                        count + 1,
                        expanded.saturating_add(item.size_bytes),
                        policy,
                    ),
                    warnings,
                ));
            }
            Err(error) => {
                return Err(failure(
                    error.into(),
                    format_code(error),
                    format_details(
                        error,
                        &item.effective_path,
                        item.size_bytes,
                        count + 1,
                        expanded.saturating_add(item.size_bytes),
                        policy,
                    ),
                    warnings,
                ));
            }
            Ok(format) => format,
        };
        let actual = bounded.bytes_read();
        expanded += actual;
        entries.push(ValidatedEntry {
            source_path: item.source_path,
            effective_path: item.effective_path,
            size_bytes: actual,
            content_type: format.content_type(),
        });
    }
    Ok(ValidatedArchive {
        entry_path,
        entries,
        warnings,
    })
}

fn remove_wrapper(
    entries: &mut [EffectiveEntry],
    warnings: &mut Vec<ValidationNotice>,
) -> Result<(), ArchiveError> {
    let Some(first) = entries
        .first()
        .and_then(|e| e.effective_path.split_once('/').map(|v| v.0.to_owned()))
    else {
        return Ok(());
    };
    if !entries
        .iter()
        .all(|e| e.effective_path.starts_with(&format!("{first}/")))
    {
        return Ok(());
    }
    let mut stripped = BTreeSet::new();
    for entry in entries.iter_mut() {
        let next = entry.effective_path[first.len() + 1..].to_owned();
        if next.is_empty() || !stripped.insert(next.clone()) {
            return Err(ArchiveError::DuplicatePath);
        }
        entry.effective_path = next;
    }
    warnings.push(ValidationNotice::for_code(
        "wrapper_directory_removed",
        ValidationDetails {
            directory: Some(first),
            ..Default::default()
        },
    ));
    Ok(())
}

#[allow(clippy::result_large_err)]
fn resolve_entry(
    entries: &[EffectiveEntry],
    warnings: &mut Vec<ValidationNotice>,
) -> Result<String, (ArchiveError, ValidationDetails)> {
    if entries.iter().any(|e| e.effective_path == "index.html") {
        return Ok("index.html".to_owned());
    }
    let roots: Vec<String> = entries
        .iter()
        .filter(|e| !e.effective_path.contains('/') && has_html_extension(&e.effective_path))
        .map(|e| e.effective_path.clone())
        .collect();
    if roots.len() == 1 {
        let entry = roots[0].clone();
        warnings.push(ValidationNotice::for_code(
            "entry_file_inferred",
            ValidationDetails {
                entry_file: Some(entry.clone()),
                ..Default::default()
            },
        ));
        return Ok(entry);
    }
    if roots.len() > 1 {
        return Err((
            ArchiveError::AmbiguousEntryFile,
            ValidationDetails {
                candidates: Some(roots),
                ..Default::default()
            },
        ));
    }
    let nested = entries
        .iter()
        .filter(|e| has_html_extension(&e.effective_path))
        .map(|e| e.effective_path.clone())
        .collect();
    Err((
        ArchiveError::MissingEntryFile,
        ValidationDetails {
            candidates: Some(nested),
            ..Default::default()
        },
    ))
}

fn has_html_extension(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("html"))
}

fn failure(
    error: ArchiveError,
    code: &'static str,
    details: ValidationDetails,
    warnings: Vec<ValidationNotice>,
) -> (ArchiveError, ValidationReport) {
    (
        error,
        ValidationReport::failure(ValidationNotice::for_code(code, details), warnings),
    )
}
fn path_details(path: &str) -> ValidationDetails {
    ValidationDetails {
        path: Some(path.to_owned()),
        ..Default::default()
    }
}
fn code_for(error: ArchiveError) -> &'static str {
    match error {
        ArchiveError::InvalidZip => "invalid_zip",
        ArchiveError::UnsafePath => "unsafe_archive_path",
        ArchiveError::DuplicatePath => "duplicate_archive_path",
        ArchiveError::UnsupportedFileType => "unsupported_file_type",
        ArchiveError::NestedArchive => "nested_archive",
        ArchiveError::MissingEntryFile => "missing_entry_file",
        ArchiveError::AmbiguousEntryFile => "ambiguous_entry_file",
        ArchiveError::Format(e) => format_code(e),
    }
}
fn format_code(error: FormatError) -> &'static str {
    match error {
        FormatError::ArchiveSizeExceeded => "archive_too_large",
        FormatError::ExpandedSizeExceeded => "expanded_size_exceeded",
        FormatError::FileCountExceeded => "file_count_exceeded",
        FormatError::SingleFileSizeExceeded => "single_file_too_large",
        FormatError::UnsupportedExtension | FormatError::ExtensionDisabled => "unsupported_format",
        FormatError::InvalidContent | FormatError::ReadFailed => "invalid_file_content",
    }
}
fn format_details(
    error: FormatError,
    path: &str,
    size: u64,
    count: u64,
    expanded: u64,
    policy: &PolicySnapshot,
) -> ValidationDetails {
    let mut d = path_details(path);
    match error {
        FormatError::ArchiveSizeExceeded => {
            d.actual_bytes = Some(size);
            d.limit_bytes = Some(policy.archive_size_bytes());
        }
        FormatError::ExpandedSizeExceeded => {
            d.actual_bytes = Some(expanded);
            d.limit_bytes = Some(policy.expanded_size_bytes());
        }
        FormatError::FileCountExceeded => {
            d.actual_count = Some(count);
            d.limit_count = Some(policy.file_count());
        }
        FormatError::SingleFileSizeExceeded => {
            d.actual_bytes = Some(size);
            d.limit_bytes = Some(policy.single_file_size_bytes());
        }
        FormatError::UnsupportedExtension | FormatError::ExtensionDisabled => {
            d.extension = path.rsplit_once('.').map(|(_, ext)| format!(".{ext}"));
        }
        FormatError::InvalidContent | FormatError::ReadFailed => {
            d.validation_kind = Some("content".to_owned());
        }
    }
    d
}

fn is_ignored_metadata(path: &str) -> bool {
    path.starts_with("__MACOSX/")
        || path
            .rsplit('/')
            .next()
            .is_some_and(|name| name.starts_with("._") || name == ".DS_Store")
}
fn normalize_path(raw: &str, directory: bool) -> Result<String, ArchiveError> {
    if raw.is_empty()
        || raw.contains('\0')
        || raw.contains('\\')
        || raw.starts_with('/')
        || has_windows_drive_prefix(raw)
    {
        return Err(ArchiveError::UnsafePath);
    }
    let normalized = if directory {
        raw.strip_suffix('/').unwrap_or(raw)
    } else {
        raw
    };
    if normalized.is_empty()
        || normalized
            .split('/')
            .any(|c| c.is_empty() || c == "." || c == "..")
    {
        return Err(ArchiveError::UnsafePath);
    }
    Ok(normalized.to_owned())
}
fn has_windows_drive_prefix(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}
fn validate_file_type(
    mode: Option<u32>,
    directory: bool,
    symlink: bool,
) -> Result<(), ArchiveError> {
    if symlink {
        return Err(ArchiveError::UnsupportedFileType);
    }
    if let Some(mode) = mode {
        let kind = mode & UNIX_FILE_TYPE_MASK;
        if kind != 0 && kind != UNIX_REGULAR_FILE && !(directory && kind == UNIX_DIRECTORY) {
            return Err(ArchiveError::UnsupportedFileType);
        }
    }
    Ok(())
}
fn is_nested_archive(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    NESTED_ARCHIVE_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn declared_entry_count<R: Read + Seek>(
    reader: &mut R,
    archive_size: u64,
) -> Result<u64, ArchiveError> {
    let tail_size = archive_size.min((END_OF_CENTRAL_DIRECTORY_SIZE + MAX_ZIP_COMMENT_SIZE) as u64);
    reader
        .seek(SeekFrom::End(
            -i64::try_from(tail_size).map_err(|_| ArchiveError::InvalidZip)?,
        ))
        .map_err(|_| ArchiveError::InvalidZip)?;
    let mut tail = vec![0; usize::try_from(tail_size).map_err(|_| ArchiveError::InvalidZip)?];
    reader
        .read_exact(&mut tail)
        .map_err(|_| ArchiveError::InvalidZip)?;
    let eocd = tail
        .windows(4)
        .rposition(|b| b == b"PK\x05\x06")
        .ok_or(ArchiveError::InvalidZip)?;
    if eocd + 22 > tail.len() {
        return Err(ArchiveError::InvalidZip);
    }
    let comment = u16::from_le_bytes([tail[eocd + 20], tail[eocd + 21]]) as usize;
    if eocd + 22 + comment != tail.len() {
        return Err(ArchiveError::InvalidZip);
    }
    let count = u16::from_le_bytes([tail[eocd + 10], tail[eocd + 11]]);
    if count != u16::MAX {
        return Ok(u64::from(count));
    }
    zip64_entry_count(reader, archive_size, &tail, eocd)
}
fn zip64_entry_count<R: Read + Seek>(
    reader: &mut R,
    archive_size: u64,
    tail: &[u8],
    eocd: usize,
) -> Result<u64, ArchiveError> {
    let start = eocd.checked_sub(20).ok_or(ArchiveError::InvalidZip)?;
    if &tail[start..start + 4] != b"PK\x06\x07" {
        return Err(ArchiveError::InvalidZip);
    }
    let offset = u64::from_le_bytes(
        tail[start + 8..start + 16]
            .try_into()
            .map_err(|_| ArchiveError::InvalidZip)?,
    );
    if offset >= archive_size {
        return Err(ArchiveError::InvalidZip);
    }
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|_| ArchiveError::InvalidZip)?;
    let mut header = [0; 56];
    reader
        .read_exact(&mut header)
        .map_err(|_| ArchiveError::InvalidZip)?;
    if &header[..4] != b"PK\x06\x06" {
        return Err(ArchiveError::InvalidZip);
    }
    Ok(u64::from_le_bytes(
        header[32..40]
            .try_into()
            .map_err(|_| ArchiveError::InvalidZip)?,
    ))
}

struct BoundedReader<R> {
    inner: R,
    limit: u64,
    bytes_read: u64,
    limit_exceeded: bool,
}
impl<R> BoundedReader<R> {
    const fn new(inner: R, limit: u64) -> Self {
        Self {
            inner,
            limit,
            bytes_read: 0,
            limit_exceeded: false,
        }
    }
    const fn bytes_read(&self) -> u64 {
        self.bytes_read
    }
    const fn limit_exceeded(&self) -> bool {
        self.limit_exceeded
    }
}
impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        if b.is_empty() {
            return Ok(0);
        }
        let remaining = self.limit.saturating_sub(self.bytes_read);
        if remaining == 0 {
            let mut probe = [0; 1];
            if self.inner.read(&mut probe)? == 0 {
                return Ok(0);
            }
            self.limit_exceeded = true;
            return Err(io::Error::other("expanded file exceeds policy snapshot"));
        }
        let allowed = usize::try_from(remaining)
            .unwrap_or(usize::MAX)
            .min(b.len());
        let n = self.inner.read(&mut b[..allowed])?;
        self.bytes_read += n as u64;
        Ok(n)
    }
}
