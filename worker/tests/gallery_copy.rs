use shareslices_worker::gallery_copy_job::{
    CopyLifecycleAction, CopySourceEvent, copy_lifecycle_action, should_retry,
};

#[test]
fn accepted_snapshot_survives_non_governance_source_changes() {
    for event in [
        CopySourceEvent::Updated,
        CopySourceEvent::CreatorWithdrawal,
        CopySourceEvent::ArtifactDeleted,
        CopySourceEvent::DistinctSourceAccountDeleted,
    ] {
        assert_eq!(
            copy_lifecycle_action(event),
            CopyLifecycleAction::ContinueFixedSnapshot
        );
    }
}
#[test]
fn ready_commit_is_cancelled_by_expanding_or_copier_blocks() {
    for event in [
        CopySourceEvent::AdministratorRemoval,
        CopySourceEvent::Takedown,
        CopySourceEvent::Restriction,
        CopySourceEvent::GalleryUnavailable,
        CopySourceEvent::CopierAccountDeleted,
    ] {
        assert_eq!(
            copy_lifecycle_action(event),
            CopyLifecycleAction::CancelBeforeReady
        );
    }
}
#[test]
fn transient_failures_retry_only_with_attempts_remaining() {
    assert!(should_retry("source_unavailable", 1, 3));
    assert!(!should_retry("source_unavailable", 3, 3));
    assert!(!should_retry("invalid_input", 1, 3));
}
