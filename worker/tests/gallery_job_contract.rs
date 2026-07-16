use shareslices_worker::gallery_job_contract::{
    GalleryJobEnvelope, GalleryJobKind, SUPPORTED_CONTRACT_VERSIONS,
};

const V1: &str = include_str!("../../db/contracts/gallery-jobs/fixtures/gallery-job-v1.json");
const V0: &str = include_str!("../../db/contracts/gallery-jobs/fixtures/gallery-job-v0.json");

#[test]
fn current_and_previous_contract_fixtures_are_compatible() {
    assert_eq!(
        GalleryJobEnvelope::parse_json(V1).expect("v1").job_kind,
        GalleryJobKind::Copy
    );
    assert_eq!(
        GalleryJobEnvelope::parse_json(V0).expect("v0").job_kind,
        GalleryJobKind::Safety
    );
    assert_eq!(
        SUPPORTED_CONTRACT_VERSIONS,
        ["gallery-job/v1", "gallery-job/v0"]
    );
}

#[test]
fn future_contract_version_is_rejected() {
    let future = V1.replace("gallery-job/v1", "gallery-job/v2");
    assert_eq!(
        GalleryJobEnvelope::parse_json(&future),
        Err("incompatible_contract".to_owned())
    );
}

#[test]
fn copy_requires_complete_api_owned_admission_snapshot() {
    let incomplete = V1.replace(", \"sourceRetentionReferenceId\": \"retention-1\"", "");
    assert_eq!(
        GalleryJobEnvelope::parse_json(&incomplete),
        Err("copy_input_snapshot_incomplete".to_owned())
    );
}
