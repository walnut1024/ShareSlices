use shareslices_worker::gallery_safety::{
    GallerySafetyPolicy, SafetyDecision, inspect_self_contained, overall_decision,
};

const POLICY: &str =
    include_str!("../../db/contracts/gallery-safety/gallery-safety-policy-v1.json");

fn policy() -> GallerySafetyPolicy {
    serde_json::from_str(POLICY).expect("checked safety policy")
}

#[test]
fn packaged_relative_content_passes_without_claiming_runtime_proof() {
    let findings = inspect_self_contained(
        r#"<script type="module" src="./app.js"></script><img src="images/a.png">"#,
        &policy(),
    );
    assert!(findings.is_empty());
    assert_eq!(overall_decision(&findings), SafetyDecision::Pass);
}

#[test]
fn known_external_resources_and_programmatic_requests_reject() {
    for content in [
        r#"<script src="https://cdn.example/app.js"></script>"#,
        r"<style>.hero{background:url(https://example.test/a.png)}</style>",
        r#"<script>fetch("https://example.test/data")</script>"#,
        r#"<form action="https://example.test/collect"></form>"#,
    ] {
        assert_eq!(
            overall_decision(&inspect_self_contained(content, &policy())),
            SafetyDecision::Reject
        );
    }
}

#[test]
fn uncertain_dynamic_construction_routes_to_review() {
    let findings = inspect_self_contained("<script>eval(userCode)</script>", &policy());
    assert_eq!(overall_decision(&findings), SafetyDecision::Review);
    assert_eq!(findings[0].code, "executable_dynamic_construction");
}

#[test]
fn policy_is_versioned_and_replay_requires_exact_revision() {
    let policy = policy();
    assert_eq!(policy.policy_revision, "gallery-safety/v1");
    assert_eq!(policy.evidence_digest_algorithm, "sha256");
    assert!(policy.replay_requires_exact_policy_revision);
}
