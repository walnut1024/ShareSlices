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
    maximum_attempts: u32,
}

fn classify(error: ProcessingError) -> Classification {
    let (class, reason_code, maximum_attempts) = match error {
        ProcessingError::Validation(failure) => (
            RetryClass::DeterministicValidation,
            failure.reason_code(),
            1,
        ),
        ProcessingError::ObjectStoreTimeout => (RetryClass::Transient, "object_store_timeout", 3),
        ProcessingError::ObjectStoreUnavailable => {
            (RetryClass::Transient, "object_store_unavailable", 3)
        }
        ProcessingError::DatabaseTimeout => (RetryClass::Transient, "database_timeout", 3),
        ProcessingError::DatabaseUnavailable => (RetryClass::Transient, "database_unavailable", 3),
        ProcessingError::LeaseLost => (RetryClass::Transient, "processing_lease_lost", 3),
        ProcessingError::WorkerInfrastructure => {
            (RetryClass::Transient, "worker_infrastructure_failure", 3)
        }
        ProcessingError::Unclassified => (RetryClass::Unclassified, "unclassified_error", 2),
    };
    Classification {
        class,
        reason_code,
        maximum_attempts,
    }
}

impl ValidationFailure {
    const fn reason_code(self) -> &'static str {
        match self {
            Self::InvalidZip => "invalid_zip",
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
