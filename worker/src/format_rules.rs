// cspell:ignore ftyp rfind rsplit

use std::collections::BTreeSet;
use std::io::{BufReader, Read};

use quick_xml::Reader;
use quick_xml::events::Event;
use thiserror::Error;

const MIB: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Validator {
    Utf8,
    Json,
    Png,
    Jpeg,
    Gif,
    Webp,
    Avif,
    Svg,
    Ico,
    Woff,
    Woff2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FormatRule {
    extension: &'static str,
    content_type: &'static str,
    validator: Validator,
}

impl FormatRule {
    #[must_use]
    pub const fn extension(self) -> &'static str {
        self.extension
    }

    #[must_use]
    pub const fn content_type(self) -> &'static str {
        self.content_type
    }
}

const FORMAT_RULES: [FormatRule; 18] = [
    rule(".html", "text/html", Validator::Utf8),
    rule(".css", "text/css", Validator::Utf8),
    rule(".js", "text/javascript", Validator::Utf8),
    rule(".mjs", "text/javascript", Validator::Utf8),
    rule(".json", "application/json", Validator::Json),
    rule(".txt", "text/plain", Validator::Utf8),
    rule(".csv", "text/csv", Validator::Utf8),
    rule(".tsv", "text/tab-separated-values", Validator::Utf8),
    rule(".png", "image/png", Validator::Png),
    rule(".jpg", "image/jpeg", Validator::Jpeg),
    rule(".jpeg", "image/jpeg", Validator::Jpeg),
    rule(".gif", "image/gif", Validator::Gif),
    rule(".webp", "image/webp", Validator::Webp),
    rule(".avif", "image/avif", Validator::Avif),
    rule(".svg", "image/svg+xml", Validator::Svg),
    rule(".ico", "image/x-icon", Validator::Ico),
    rule(".woff", "font/woff", Validator::Woff),
    rule(".woff2", "font/woff2", Validator::Woff2),
];

const fn rule(
    extension: &'static str,
    content_type: &'static str,
    validator: Validator,
) -> FormatRule {
    FormatRule {
        extension,
        content_type,
        validator,
    }
}

#[must_use]
pub const fn default_format_rules() -> &'static [FormatRule] {
    &FORMAT_RULES
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicySnapshot {
    archive_size_bytes: u64,
    expanded_size_bytes: u64,
    file_count: u64,
    single_file_size_bytes: u64,
    enabled_extensions: BTreeSet<String>,
}

impl PolicySnapshot {
    /// Builds the immutable limits and enabled-format view stored by an Upload session.
    ///
    /// # Errors
    ///
    /// Returns an error for zero limits, no enabled formats, or a format unsupported by
    /// the deployed Worker.
    pub fn new<I, S>(
        archive_size_bytes: u64,
        expanded_size_bytes: u64,
        file_count: u64,
        single_file_size_bytes: u64,
        enabled_extensions: I,
    ) -> Result<Self, PolicyError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        if archive_size_bytes == 0
            || expanded_size_bytes == 0
            || file_count == 0
            || single_file_size_bytes == 0
        {
            return Err(PolicyError::InvalidLimit);
        }

        let enabled_extensions = enabled_extensions
            .into_iter()
            .map(|extension| extension.as_ref().to_owned())
            .collect::<BTreeSet<_>>();
        if enabled_extensions.is_empty() {
            return Err(PolicyError::NoEnabledExtensions);
        }
        if enabled_extensions
            .iter()
            .any(|extension| find_rule(extension).is_none())
        {
            return Err(PolicyError::UnsupportedExtension);
        }

        Ok(Self {
            archive_size_bytes,
            expanded_size_bytes,
            file_count,
            single_file_size_bytes,
            enabled_extensions,
        })
    }

    #[must_use]
    pub fn product_defaults() -> Self {
        Self {
            archive_size_bytes: 50 * MIB,
            expanded_size_bytes: 200 * MIB,
            file_count: 1_000,
            single_file_size_bytes: 50 * MIB,
            enabled_extensions: FORMAT_RULES
                .iter()
                .map(|rule| rule.extension.to_owned())
                .collect(),
        }
    }

    /// Checks the raw ZIP size against the accepted Upload session snapshot.
    ///
    /// # Errors
    ///
    /// Returns [`FormatError::ArchiveSizeExceeded`] when the ZIP is too large.
    pub fn check_archive_size(&self, size_bytes: u64) -> Result<(), FormatError> {
        if size_bytes > self.archive_size_bytes {
            return Err(FormatError::ArchiveSizeExceeded);
        }
        Ok(())
    }

    /// Checks one regular file against the enabled extensions and cumulative limits.
    ///
    /// # Errors
    ///
    /// Returns the matching format or numeric-limit violation.
    pub fn check_entry(
        &self,
        path: &str,
        size_bytes: u64,
        current_file_count: u64,
        current_expanded_size: u64,
    ) -> Result<(), FormatError> {
        self.rule_for_path(path)?;
        if size_bytes > self.single_file_size_bytes {
            return Err(FormatError::SingleFileSizeExceeded);
        }
        if current_file_count
            .checked_add(1)
            .is_none_or(|count| count > self.file_count)
        {
            return Err(FormatError::FileCountExceeded);
        }
        if current_expanded_size
            .checked_add(size_bytes)
            .is_none_or(|size| size > self.expanded_size_bytes)
        {
            return Err(FormatError::ExpandedSizeExceeded);
        }
        Ok(())
    }

    /// Streams one file through its centralized content validator.
    ///
    /// # Errors
    ///
    /// Returns an error when the extension is unavailable, content is invalid, or reading fails.
    pub fn validate_file<R: Read>(
        &self,
        path: &str,
        reader: R,
    ) -> Result<ValidatedFormat, FormatError> {
        let rule = self.rule_for_path(path)?;
        validate_content(rule.validator, reader)?;
        Ok(ValidatedFormat {
            content_type: rule.content_type,
        })
    }

    fn rule_for_path(&self, path: &str) -> Result<FormatRule, FormatError> {
        let extension = extension(path).ok_or(FormatError::UnsupportedExtension)?;
        let rule = find_rule(extension).ok_or(FormatError::UnsupportedExtension)?;
        if !self.enabled_extensions.contains(extension) {
            return Err(FormatError::ExtensionDisabled);
        }
        Ok(rule)
    }

    pub(crate) const fn expanded_size_bytes(&self) -> u64 {
        self.expanded_size_bytes
    }

    pub(crate) const fn single_file_size_bytes(&self) -> u64 {
        self.single_file_size_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ValidatedFormat {
    content_type: &'static str,
}

impl ValidatedFormat {
    #[must_use]
    pub const fn content_type(self) -> &'static str {
        self.content_type
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PolicyError {
    #[error("upload policy limits must be positive")]
    InvalidLimit,
    #[error("upload policy must enable at least one extension")]
    NoEnabledExtensions,
    #[error("upload policy enables an extension unsupported by this worker")]
    UnsupportedExtension,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum FormatError {
    #[error("archive exceeds its snapshotted size limit")]
    ArchiveSizeExceeded,
    #[error("expanded archive exceeds its snapshotted size limit")]
    ExpandedSizeExceeded,
    #[error("archive exceeds its snapshotted regular-file limit")]
    FileCountExceeded,
    #[error("expanded file exceeds its snapshotted size limit")]
    SingleFileSizeExceeded,
    #[error("file extension is not supported by this worker")]
    UnsupportedExtension,
    #[error("file extension is disabled by the upload policy snapshot")]
    ExtensionDisabled,
    #[error("file content does not match its format rule")]
    InvalidContent,
    #[error("file content could not be read")]
    ReadFailed,
}

fn extension(path: &str) -> Option<&str> {
    let file_name = path.rsplit('/').next()?;
    let dot = file_name.rfind('.')?;
    if dot == 0 {
        return None;
    }
    Some(&file_name[dot..])
}

fn find_rule(extension: &str) -> Option<FormatRule> {
    FORMAT_RULES
        .iter()
        .copied()
        .find(|rule| rule.extension == extension)
}

fn validate_content<R: Read>(validator: Validator, reader: R) -> Result<(), FormatError> {
    let valid = match validator {
        Validator::Utf8 => validate_utf8(reader)?,
        Validator::Json => match serde_json::from_reader::<_, serde_json::Value>(reader) {
            Ok(_) => true,
            Err(error) if error.is_io() => return Err(FormatError::ReadFailed),
            Err(_) => false,
        },
        Validator::Svg => validate_svg(reader)?,
        Validator::Png => validate_prefix(reader, |bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))?,
        Validator::Jpeg => validate_prefix(reader, |bytes| bytes.starts_with(b"\xff\xd8\xff"))?,
        Validator::Gif => validate_prefix(reader, |bytes| {
            bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
        })?,
        Validator::Webp => validate_prefix(reader, |bytes| {
            bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
        })?,
        Validator::Avif => validate_prefix(reader, has_avif_brand)?,
        Validator::Ico => validate_prefix(reader, |bytes| bytes.starts_with(b"\0\0\x01\0"))?,
        Validator::Woff => validate_prefix(reader, |bytes| bytes.starts_with(b"wOFF"))?,
        Validator::Woff2 => validate_prefix(reader, |bytes| bytes.starts_with(b"wOF2"))?,
    };
    if valid {
        Ok(())
    } else {
        Err(FormatError::InvalidContent)
    }
}

fn validate_utf8<R: Read>(mut reader: R) -> Result<bool, FormatError> {
    let mut pending = Vec::with_capacity(4);
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|_| FormatError::ReadFailed)?;
        if read == 0 {
            return Ok(pending.is_empty());
        }
        pending.extend_from_slice(&chunk[..read]);
        match std::str::from_utf8(&pending) {
            Ok(_) => pending.clear(),
            Err(error) if error.error_len().is_none() => {
                pending.drain(..error.valid_up_to());
                if pending.len() > 3 {
                    return Ok(false);
                }
            }
            Err(_) => return Ok(false),
        }
    }
}

fn validate_svg<R: Read>(reader: R) -> Result<bool, FormatError> {
    let mut xml = Reader::from_reader(BufReader::new(reader));
    let mut buffer = Vec::new();
    let mut root_is_svg = None;
    loop {
        match xml.read_event_into(&mut buffer) {
            Ok(Event::Start(element) | Event::Empty(element)) if root_is_svg.is_none() => {
                root_is_svg = Some(element.local_name().as_ref() == b"svg");
            }
            Ok(Event::Text(text))
                if root_is_svg.is_none() && !text.as_ref().iter().all(u8::is_ascii_whitespace) =>
            {
                return Ok(false);
            }
            Ok(Event::Eof) => return Ok(root_is_svg == Some(true)),
            Ok(_) => {}
            Err(_) => return Ok(false),
        }
        buffer.clear();
    }
}

fn validate_prefix<R: Read, F: FnOnce(&[u8]) -> bool>(
    mut reader: R,
    predicate: F,
) -> Result<bool, FormatError> {
    let mut prefix = Vec::with_capacity(64);
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader
            .read(&mut chunk)
            .map_err(|_| FormatError::ReadFailed)?;
        if read == 0 {
            break;
        }
        let remaining = 64_usize.saturating_sub(prefix.len());
        prefix.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    Ok(predicate(&prefix))
}

fn has_avif_brand(bytes: &[u8]) -> bool {
    if bytes.get(4..8) != Some(b"ftyp") || bytes.len() < 16 {
        return false;
    }
    bytes[8..12] == *b"avif"
        || bytes[8..12] == *b"avis"
        || bytes[16..]
            .chunks_exact(4)
            .any(|brand| brand == b"avif" || brand == b"avis")
}
