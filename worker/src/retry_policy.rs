use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessingError {
    Validation(ValidationFailure),
    ObjectStoreTimeout,
    ObjectStoreUnavailable,
    DatabaseTimeout,
    DatabaseUnavailable,
    LeaseLost,
    WorkerInfrastructure,
    Unclassified,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ValidationFailure {
    InvalidZip,
    DuplicateArchivePath,
    ArchivePathTraversal,
    UnsupportedFileType,
    NestedArchive,
    MissingRootIndex,
    UnsupportedExtension,
    InvalidContent,
    ArchiveSizeExceeded,
    ExpandedSizeExceeded,
    FileCountExceeded,
    SingleFileSizeExceeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessingOperation {
    ReadRawArchive,
    ValidateArchive,
    WriteStagingObject,
    CommitReadyVersion,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetryDecision {
    RetryAfter(Duration),
    Terminal(TerminalOutcome),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalOutcome {
    RecoverableFailure,
    ReplaceFileRequired,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RetryClass {
    Transient,
    DeterministicValidation,
    Unclassified,
}

pub struct RetryPolicy<J> {
    jitter: J,
}

impl<J> RetryPolicy<J>
where
    J: Fn(Duration) -> Duration,
{
    #[must_use]
    pub const fn new(jitter: J) -> Self {
        Self { jitter }
    }

    #[must_use]
    pub fn decide(
        &self,
        _operation: ProcessingOperation,
        attempt: u32,
        error: &ProcessingError,
    ) -> RetryDecision {
        match classify(*error).class {
            RetryClass::DeterministicValidation => {
                RetryDecision::Terminal(TerminalOutcome::ReplaceFileRequired)
            }
            RetryClass::Unclassified | RetryClass::Transient if attempt == 1 => {
                RetryDecision::RetryAfter((self.jitter)(Duration::from_secs(1)))
            }
            RetryClass::Transient if attempt == 2 => {
                RetryDecision::RetryAfter((self.jitter)(Duration::from_secs(5)))
            }
            RetryClass::Unclassified | RetryClass::Transient => {
                RetryDecision::Terminal(TerminalOutcome::RecoverableFailure)
            }
        }
    }

    #[must_use]
    pub fn log_fields(
        &self,
        operation: ProcessingOperation,
        attempt: u32,
        error: &ProcessingError,
        decision: &RetryDecision,
    ) -> RetryLogFields {
        let classification = classify(*error);
        let event_name = match decision {
            RetryDecision::RetryAfter(_) => "shareslices.artifact.processing.retry_scheduled",
            RetryDecision::Terminal(TerminalOutcome::RecoverableFailure) => {
                "shareslices.artifact.processing.retry_exhausted"
            }
            RetryDecision::Terminal(TerminalOutcome::ReplaceFileRequired) => {
                "shareslices.artifact.processing.validation_failed"
            }
        };
        RetryLogFields {
            event_name,
            reason_code: classification.reason_code,
            failure_summary: classification.failure_summary,
            operation: operation.as_str(),
            attempt,
            maximum_attempts: classification.maximum_attempts,
            next_delay_ms: match decision {
                RetryDecision::RetryAfter(delay) => Some(delay.as_millis()),
                RetryDecision::Terminal(_) => None,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Classification {
    class: RetryClass,
    reason_code: &'static str,
    failure_summary: &'static str,
    maximum_attempts: u32,
}

fn classify(error: ProcessingError) -> Classification {
    let (class, reason_code, failure_summary, maximum_attempts) = match error {
        ProcessingError::Validation(failure) => (
            RetryClass::DeterministicValidation,
            failure.reason_code(),
            failure.failure_summary(),
            1,
        ),
        ProcessingError::ObjectStoreTimeout => (
            RetryClass::Transient,
            "object_store_timeout",
            "Processing timed out while accessing storage.",
            3,
        ),
        ProcessingError::ObjectStoreUnavailable => (
            RetryClass::Transient,
            "object_store_unavailable",
            "Processing could not access storage.",
            3,
        ),
        ProcessingError::DatabaseTimeout => (
            RetryClass::Transient,
            "database_timeout",
            "Processing timed out while saving progress.",
            3,
        ),
        ProcessingError::DatabaseUnavailable => (
            RetryClass::Transient,
            "database_unavailable",
            "Processing could not save progress.",
            3,
        ),
        ProcessingError::LeaseLost => (
            RetryClass::Transient,
            "processing_lease_lost",
            "Processing was interrupted.",
            3,
        ),
        ProcessingError::WorkerInfrastructure => (
            RetryClass::Transient,
            "worker_infrastructure_failure",
            "Processing could not be completed.",
            3,
        ),
        ProcessingError::Unclassified => (
            RetryClass::Unclassified,
            "unclassified_error",
            "Processing could not be completed.",
            2,
        ),
    };
    Classification {
        class,
        reason_code,
        failure_summary,
        maximum_attempts,
    }
}

impl ValidationFailure {
    const fn reason_code(self) -> &'static str {
        match self {
            Self::InvalidZip => "invalid_zip",
            Self::DuplicateArchivePath => "duplicate_archive_path",
            Self::ArchivePathTraversal => "archive_path_traversal",
            Self::UnsupportedFileType => "unsupported_file_type",
            Self::NestedArchive => "nested_archive",
            Self::MissingRootIndex => "missing_root_index",
            Self::UnsupportedExtension => "unsupported_extension",
            Self::InvalidContent => "invalid_content",
            Self::ArchiveSizeExceeded => "archive_size_exceeded",
            Self::ExpandedSizeExceeded => "expanded_size_exceeded",
            Self::FileCountExceeded => "file_count_exceeded",
            Self::SingleFileSizeExceeded => "single_file_size_exceeded",
        }
    }

    const fn failure_summary(self) -> &'static str {
        match self {
            Self::InvalidZip => "The ZIP file is invalid.",
            Self::DuplicateArchivePath => "The ZIP contains duplicate file paths.",
            Self::ArchivePathTraversal => "The ZIP contains an unsafe file path.",
            Self::UnsupportedFileType => "The ZIP contains an unsupported file type.",
            Self::NestedArchive => "The ZIP contains another archive.",
            Self::MissingRootIndex => "The ZIP must contain index.html at its root.",
            Self::UnsupportedExtension => "The ZIP contains a file type that is not allowed.",
            Self::InvalidContent => "The ZIP contains a file with invalid content.",
            Self::ArchiveSizeExceeded => "The ZIP exceeds the upload size limit.",
            Self::ExpandedSizeExceeded => "The extracted files exceed the total size limit.",
            Self::FileCountExceeded => "The ZIP contains too many files.",
            Self::SingleFileSizeExceeded => "A file in the ZIP exceeds the per-file size limit.",
        }
    }
}

impl ProcessingOperation {
    const fn as_str(self) -> &'static str {
        match self {
            Self::ReadRawArchive => "read_raw_archive",
            Self::ValidateArchive => "validate_archive",
            Self::WriteStagingObject => "write_staging_object",
            Self::CommitReadyVersion => "commit_ready_version",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetryLogFields {
    event_name: &'static str,
    reason_code: &'static str,
    failure_summary: &'static str,
    operation: &'static str,
    attempt: u32,
    maximum_attempts: u32,
    next_delay_ms: Option<u128>,
}

impl RetryLogFields {
    #[must_use]
    pub const fn event_name(self) -> &'static str {
        self.event_name
    }

    #[must_use]
    pub const fn reason_code(self) -> &'static str {
        self.reason_code
    }

    #[must_use]
    pub const fn failure_summary(self) -> &'static str {
        self.failure_summary
    }

    #[must_use]
    pub const fn operation(self) -> &'static str {
        self.operation
    }

    #[must_use]
    pub const fn attempt(self) -> u32 {
        self.attempt
    }

    #[must_use]
    pub const fn maximum_attempts(self) -> u32 {
        self.maximum_attempts
    }

    #[must_use]
    pub const fn next_delay_ms(self) -> Option<u128> {
        self.next_delay_ms
    }
}
