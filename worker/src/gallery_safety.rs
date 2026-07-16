use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GallerySafetyPolicy {
    pub policy_revision: String,
    pub max_file_count: u64,
    pub max_total_bytes: u64,
    pub max_single_file_bytes: u64,
    pub finding_decisions: FindingDecisions,
    pub evidence_digest_algorithm: String,
    pub replay_requires_exact_policy_revision: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FindingDecisions {
    pub external_resource_dependency: SafetyDecision,
    pub external_programmatic_request: SafetyDecision,
    pub external_form_action: SafetyDecision,
    pub executable_dynamic_construction: SafetyDecision,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum SafetyDecision {
    Pass,
    Review,
    Reject,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SafetyFinding {
    pub code: &'static str,
    pub decision: SafetyDecision,
}

#[must_use]
pub fn inspect_self_contained(content: &str, policy: &GallerySafetyPolicy) -> Vec<SafetyFinding> {
    let normalized = content.to_ascii_lowercase().replace(' ', "");
    let mut findings = Vec::new();
    if contains_any(
        &normalized,
        &[
            "src=\"http://",
            "src=\"https://",
            "src=\"//",
            "href=\"http://",
            "href=\"https://",
            "url(http://",
            "url(https://",
            "@import\"http",
        ],
    ) {
        findings.push(SafetyFinding {
            code: "external_resource_dependency",
            decision: policy.finding_decisions.external_resource_dependency,
        });
    }
    if contains_any(
        &normalized,
        &[
            "fetch(\"http",
            "fetch('http",
            "newwebsocket(\"",
            "newwebsocket('",
            "eventsource(\"http",
            "navigator.sendbeacon(\"http",
        ],
    ) {
        findings.push(SafetyFinding {
            code: "external_programmatic_request",
            decision: policy.finding_decisions.external_programmatic_request,
        });
    }
    if contains_any(
        &normalized,
        &[
            "action=\"http://",
            "action=\"https://",
            "formaction=\"http://",
            "formaction=\"https://",
        ],
    ) {
        findings.push(SafetyFinding {
            code: "external_form_action",
            decision: policy.finding_decisions.external_form_action,
        });
    }
    if contains_any(&normalized, &["eval(", "newfunction(", "document.write("]) {
        findings.push(SafetyFinding {
            code: "executable_dynamic_construction",
            decision: policy.finding_decisions.executable_dynamic_construction,
        });
    }
    findings
}

#[must_use]
pub fn overall_decision(findings: &[SafetyFinding]) -> SafetyDecision {
    findings
        .iter()
        .map(|finding| finding.decision)
        .max()
        .unwrap_or(SafetyDecision::Pass)
}

fn contains_any(content: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| content.contains(pattern))
}
