use std::time::Duration;

use shareslices_worker::retry_policy::{
    ProcessingError, ProcessingOperation, RetryDecision, RetryPolicy, TerminalOutcome,
    ValidationFailure,
};

#[test]
fn classified_transient_failures_use_the_two_injected_delays() {
    let policy = RetryPolicy::new(|base| base + Duration::from_millis(250));
    let error = ProcessingError::ObjectStoreTimeout;

    let first = policy.decide(ProcessingOperation::ReadRawArchive, 1, &error);
    let second = policy.decide(ProcessingOperation::ReadRawArchive, 2, &error);
    let third = policy.decide(ProcessingOperation::ReadRawArchive, 3, &error);

    assert_eq!(
        first,
        RetryDecision::RetryAfter(Duration::from_millis(1_250))
    );
    assert_eq!(
        second,
        RetryDecision::RetryAfter(Duration::from_millis(5_250))
    );
    assert_eq!(
        third,
        RetryDecision::Terminal(TerminalOutcome::RecoverableFailure)
    );
    let fields = policy.log_fields(ProcessingOperation::ReadRawArchive, 2, &error, &second);
    assert_eq!(fields.reason_code(), "object_store_timeout");
    assert_eq!(fields.operation(), "read_raw_archive");
    assert_eq!(fields.attempt(), 2);
    assert_eq!(fields.maximum_attempts(), 3);
    assert_eq!(fields.next_delay_ms(), Some(5_250));
    assert_eq!(
        fields.event_name(),
        "shareslices.artifact.processing.retry_scheduled"
    );
}

#[test]
fn unclassified_errors_receive_one_conservative_retry() {
    let policy = RetryPolicy::new(|base| base);
    let error = ProcessingError::Unclassified;

    assert_eq!(
        policy.decide(ProcessingOperation::ValidateArchive, 1, &error),
        RetryDecision::RetryAfter(Duration::from_secs(1))
    );
    let terminal = policy.decide(ProcessingOperation::ValidateArchive, 2, &error);
    assert_eq!(
        terminal,
        RetryDecision::Terminal(TerminalOutcome::RecoverableFailure)
    );
    let fields = policy.log_fields(ProcessingOperation::ValidateArchive, 2, &error, &terminal);
    assert_eq!(fields.reason_code(), "unclassified_error");
    assert_eq!(fields.maximum_attempts(), 2);
    assert_eq!(fields.next_delay_ms(), None);
    assert_eq!(
        fields.event_name(),
        "shareslices.artifact.processing.retry_exhausted"
    );
}

#[test]
fn deterministic_validation_failures_never_retry() {
    let policy = RetryPolicy::new(|_| panic!("jitter must not run"));
    let error = ProcessingError::Validation(ValidationFailure::ArchivePathTraversal);
    let terminal = policy.decide(ProcessingOperation::ValidateArchive, 1, &error);

    assert_eq!(
        terminal,
        RetryDecision::Terminal(TerminalOutcome::ReplaceFileRequired)
    );
    let fields = policy.log_fields(ProcessingOperation::ValidateArchive, 1, &error, &terminal);
    assert_eq!(fields.reason_code(), "archive_path_traversal");
    assert_eq!(fields.maximum_attempts(), 1);
    assert_eq!(
        fields.event_name(),
        "shareslices.artifact.processing.validation_failed"
    );
}

#[test]
fn invalid_content_has_a_user_actionable_failure_summary() {
    let policy = RetryPolicy::new(|_| panic!("jitter must not run"));
    let error = ProcessingError::Validation(ValidationFailure::InvalidContent);
    let terminal = policy.decide(ProcessingOperation::ValidateArchive, 1, &error);
    let fields = policy.log_fields(ProcessingOperation::ValidateArchive, 1, &error, &terminal);

    assert_eq!(
        fields.failure_summary(),
        "The ZIP contains a file with invalid content."
    );
    assert_ne!(fields.failure_summary(), fields.reason_code());
}

#[test]
fn duplicate_archive_paths_keep_the_matching_legacy_reason_code() {
    let policy = RetryPolicy::new(|_| panic!("jitter must not run"));
    let error = ProcessingError::Validation(ValidationFailure::DuplicateArchivePath);
    let terminal = policy.decide(ProcessingOperation::ValidateArchive, 1, &error);
    let fields = policy.log_fields(ProcessingOperation::ValidateArchive, 1, &error, &terminal);

    assert_eq!(fields.reason_code(), "duplicate_archive_path");
}

#[test]
fn typed_dependency_failures_have_stable_reason_codes() {
    let policy = RetryPolicy::new(|base| base);
    let cases = [
        (
            ProcessingError::ObjectStoreUnavailable,
            "object_store_unavailable",
        ),
        (ProcessingError::DatabaseTimeout, "database_timeout"),
        (ProcessingError::DatabaseUnavailable, "database_unavailable"),
        (ProcessingError::LeaseLost, "processing_lease_lost"),
        (
            ProcessingError::WorkerInfrastructure,
            "worker_infrastructure_failure",
        ),
    ];

    for (error, reason) in cases {
        let decision = policy.decide(ProcessingOperation::WriteStagingObject, 1, &error);
        let fields = policy.log_fields(
            ProcessingOperation::WriteStagingObject,
            1,
            &error,
            &decision,
        );
        assert_eq!(fields.reason_code(), reason);
    }
}
