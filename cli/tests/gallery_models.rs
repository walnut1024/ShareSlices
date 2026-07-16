use shareslices_cli::GalleryViewResult;

#[test]
fn gallery_view_preserves_access_closure_actions_and_permission_evidence() {
    let result: GalleryViewResult = serde_json::from_value(serde_json::json!({
        "artifactId": "artifact_1",
        "listing": {
            "id": "glisting_1",
            "artifactId": "artifact_1",
            "lifecycle": "removed",
            "reviewState": "restricted",
            "closureReason": "administrator_removal",
            "revision": 7,
            "committed": {"revision": 6, "versionId": "version_1", "metadata": {"title": "Report", "description": null, "tags": ["demo"]}, "createdAt": "2026-07-16T00:00:00.000Z"},
            "proposal": {"id": "proposal_1", "state": "reviewing", "baseListingRevision": 7, "versionId": "version_2", "metadata": {"title": "Report 2", "description": "Candidate", "tags": []}},
            "currentGrantEvidence": {"grantVersion": "gallery-grant-v1", "acceptedAt": "2026-07-16T00:00:00.000Z"},
            "historicalGrantEvidence": [{"grantVersion": "gallery-grant-v1", "acceptedAt": "2026-07-16T00:00:00.000Z"}],
            "effectiveAccess": {"accessible": false, "restrictions": ["administrator_removal", "appeal_pending"]},
            "allowedActions": ["submit_appeal"],
            "publicUrl": null
        },
        "currentGrant": null,
        "historicalGrantEvidence": [{"grantVersion": "gallery-grant-v1", "acceptedAt": "2026-07-16T00:00:00.000Z"}],
        "grantAvailability": "no_current_grant"
    })).expect("checked Gallery view");

    let listing = result.listing.expect("owner listing");
    assert_eq!(
        listing.closure_reason.as_deref(),
        Some("administrator_removal")
    );
    assert_eq!(
        listing.effective_access.restrictions,
        ["administrator_removal", "appeal_pending"]
    );
    assert_eq!(listing.allowed_actions, ["submit_appeal"]);
    assert_eq!(listing.committed.expect("committed revision").revision, 6);
    assert_eq!(
        listing
            .proposal
            .expect("proposed revision")
            .base_listing_revision,
        7
    );
    assert!(result.current_grant.is_none());
    assert_eq!(result.historical_grant_evidence.len(), 1);
}

#[test]
fn gallery_permission_grant_accepts_exact_text_and_checked_text_alias() {
    for text_field in ["exactText", "text"] {
        let mut grant = serde_json::json!({
            "version": "gallery-grant-v1",
            "permissions": ["view", "gallery_download", "save_a_copy"]
        });
        grant[text_field] = serde_json::json!("Exact reviewed permission text");
        let parsed: shareslices_cli::GalleryPermissionGrant =
            serde_json::from_value(grant).expect("grant evidence");
        assert_eq!(parsed.exact_text, "Exact reviewed permission text");
    }
}
