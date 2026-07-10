// cspell:ignore eocd rposition
use std::collections::BTreeSet;
use std::io::{self, Read, Seek, SeekFrom};

use thiserror::Error;
use zip::ZipArchive;

use crate::format_rules::{FormatError, PolicySnapshot};

const UNIX_FILE_TYPE_MASK: u32 = 0o170_000;
const UNIX_REGULAR_FILE: u32 = 0o100_000;
const UNIX_DIRECTORY: u32 = 0o040_000;
const END_OF_CENTRAL_DIRECTORY_SIZE: usize = 22;
const MAX_ZIP_COMMENT_SIZE: usize = u16::MAX as usize;
const NESTED_ARCHIVE_EXTENSIONS: [&str; 8] =
    [".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedArchive {
    entries: Vec<ValidatedEntry>,
}

impl ValidatedArchive {
    #[must_use]
    pub fn entries(&self) -> &[ValidatedEntry] {
        &self.entries
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedEntry {
    path: String,
    size_bytes: u64,
    content_type: &'static str,
}

impl ValidatedEntry {
    #[must_use]
    pub fn path(&self) -> &str {
        &self.path
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
    #[error("ZIP does not contain index.html at its root")]
    MissingRootIndex,
    #[error(transparent)]
    Format(#[from] FormatError),
}

/// Validates ZIP structure, paths, snapshotted limits, and file formats.
///
/// # Errors
///
/// Returns the first deterministic archive or format violation encountered.
pub fn validate_zip<R: Read + Seek>(
    mut reader: R,
    policy: &PolicySnapshot,
) -> Result<ValidatedArchive, ArchiveError> {
    let archive_size = reader
        .seek(SeekFrom::End(0))
        .map_err(|_| ArchiveError::InvalidZip)?;
    policy.check_archive_size(archive_size)?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| ArchiveError::InvalidZip)?;

    let declared_entry_count = declared_entry_count(&mut reader, archive_size)?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| ArchiveError::InvalidZip)?;
    let mut archive = ZipArchive::new(reader).map_err(|_| ArchiveError::InvalidZip)?;
    if u64::try_from(archive.len()).map_err(|_| ArchiveError::InvalidZip)? != declared_entry_count {
        return Err(ArchiveError::DuplicatePath);
    }
    let mut paths = BTreeSet::new();
    let mut entries = Vec::new();
    let mut expanded_size = 0_u64;
    let mut file_count = 0_u64;
    let mut has_root_index = false;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| ArchiveError::InvalidZip)?;
        let path = normalize_path(file.name(), file.is_dir())?;
        validate_file_type(file.unix_mode(), file.is_dir(), file.is_symlink())?;
        if file.is_dir() {
            continue;
        }
        if is_nested_archive(&path) {
            return Err(ArchiveError::NestedArchive);
        }
        if !paths.insert(path.clone()) {
            return Err(ArchiveError::DuplicatePath);
        }

        let size_bytes = file.size();
        policy.check_entry(&path, size_bytes, file_count, expanded_size)?;
        let remaining_expanded = policy.expanded_size_bytes().saturating_sub(expanded_size);
        let byte_limit = policy.single_file_size_bytes().min(remaining_expanded);
        let mut bounded = BoundedReader::new(&mut file, byte_limit);
        let format = match policy.validate_file(&path, &mut bounded) {
            Err(FormatError::ReadFailed) if bounded.limit_exceeded() => {
                if policy.single_file_size_bytes() <= remaining_expanded {
                    return Err(FormatError::SingleFileSizeExceeded.into());
                }
                return Err(FormatError::ExpandedSizeExceeded.into());
            }
            result => result?,
        };
        let actual_size = bounded.bytes_read();
        file_count += 1;
        expanded_size += actual_size;
        has_root_index |= path == "index.html";
        entries.push(ValidatedEntry {
            path,
            size_bytes: actual_size,
            content_type: format.content_type(),
        });
    }

    if !has_root_index {
        return Err(ArchiveError::MissingRootIndex);
    }
    Ok(ValidatedArchive { entries })
}

fn declared_entry_count<R: Read + Seek>(
    reader: &mut R,
    archive_size: u64,
) -> Result<u64, ArchiveError> {
    let tail_size = archive_size.min(
        u64::try_from(END_OF_CENTRAL_DIRECTORY_SIZE + MAX_ZIP_COMMENT_SIZE)
            .expect("ZIP tail size fits u64"),
    );
    reader
        .seek(SeekFrom::End(
            -i64::try_from(tail_size).map_err(|_| ArchiveError::InvalidZip)?,
        ))
        .map_err(|_| ArchiveError::InvalidZip)?;
    let mut tail = vec![0_u8; usize::try_from(tail_size).map_err(|_| ArchiveError::InvalidZip)?];
    reader
        .read_exact(&mut tail)
        .map_err(|_| ArchiveError::InvalidZip)?;
    let eocd = tail
        .windows(4)
        .rposition(|bytes| bytes == b"PK\x05\x06")
        .ok_or(ArchiveError::InvalidZip)?;
    if eocd + END_OF_CENTRAL_DIRECTORY_SIZE > tail.len() {
        return Err(ArchiveError::InvalidZip);
    }
    let comment_size = usize::from(u16::from_le_bytes([tail[eocd + 20], tail[eocd + 21]]));
    if eocd + END_OF_CENTRAL_DIRECTORY_SIZE + comment_size != tail.len() {
        return Err(ArchiveError::InvalidZip);
    }
    let entries = u16::from_le_bytes([tail[eocd + 10], tail[eocd + 11]]);
    if entries != u16::MAX {
        return Ok(u64::from(entries));
    }
    zip64_entry_count(reader, archive_size, &tail, eocd)
}

fn zip64_entry_count<R: Read + Seek>(
    reader: &mut R,
    archive_size: u64,
    tail: &[u8],
    eocd: usize,
) -> Result<u64, ArchiveError> {
    let locator_start = eocd.checked_sub(20).ok_or(ArchiveError::InvalidZip)?;
    if &tail[locator_start..locator_start + 4] != b"PK\x06\x07" {
        return Err(ArchiveError::InvalidZip);
    }
    let zip64_offset = u64::from_le_bytes(
        tail[locator_start + 8..locator_start + 16]
            .try_into()
            .map_err(|_| ArchiveError::InvalidZip)?,
    );
    if zip64_offset >= archive_size {
        return Err(ArchiveError::InvalidZip);
    }
    reader
        .seek(SeekFrom::Start(zip64_offset))
        .map_err(|_| ArchiveError::InvalidZip)?;
    let mut header = [0_u8; 56];
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
            .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return Err(ArchiveError::UnsafePath);
    }
    Ok(normalized.to_owned())
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn validate_file_type(
    unix_mode: Option<u32>,
    directory: bool,
    symlink: bool,
) -> Result<(), ArchiveError> {
    if symlink {
        return Err(ArchiveError::UnsupportedFileType);
    }
    if let Some(mode) = unix_mode {
        let file_type = mode & UNIX_FILE_TYPE_MASK;
        if file_type != 0
            && file_type != UNIX_REGULAR_FILE
            && !(directory && file_type == UNIX_DIRECTORY)
        {
            return Err(ArchiveError::UnsupportedFileType);
        }
    }
    Ok(())
}

fn is_nested_archive(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    NESTED_ARCHIVE_EXTENSIONS
        .iter()
        .any(|extension| lower.ends_with(extension))
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
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if buffer.is_empty() {
            return Ok(0);
        }
        let remaining = self.limit.saturating_sub(self.bytes_read);
        if remaining == 0 {
            let mut probe = [0_u8; 1];
            if self.inner.read(&mut probe)? == 0 {
                return Ok(0);
            }
            self.limit_exceeded = true;
            return Err(io::Error::other("expanded file exceeds policy snapshot"));
        }
        let allowed = usize::try_from(remaining)
            .unwrap_or(usize::MAX)
            .min(buffer.len());
        let read = self.inner.read(&mut buffer[..allowed])?;
        self.bytes_read += u64::try_from(read).expect("read length fits u64");
        Ok(read)
    }
}
