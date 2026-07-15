use serde_json::{Value, json};
use shareslices_cli::{AGENT_OPERATIONS, AgentOutcome};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

fn schema() -> Value {
    serde_json::from_str(include_str!("../schema/agent-protocol-v1.schema.json"))
        .expect("checked schema")
}

#[test]
fn every_outcome_has_the_documented_coarse_exit_code() {
    for (outcome, code) in [
        (AgentOutcome::Completed, 0),
        (AgentOutcome::InProgress, 1),
        (AgentOutcome::Partial, 1),
        (AgentOutcome::ActionRequired, 4),
        (AgentOutcome::Failed, 1),
        (AgentOutcome::Indeterminate, 1),
        (AgentOutcome::Cancelled, 2),
    ] {
        assert_eq!(outcome.exit_code(), code);
    }
}

fn validate(schema: &Value, value: &Value) -> bool {
    jsonschema::validator_for(schema)
        .expect("valid schema")
        .is_valid(value)
}

#[test]
fn every_checked_fixture_validates_against_protocol_v1() {
    let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("schema/fixtures");
    for entry in fs::read_dir(fixture_dir).expect("fixture directory") {
        let path = entry.expect("fixture entry").path();
        let fixture: Value = serde_json::from_slice(&fs::read(&path).expect("fixture"))
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(validate(&schema(), &fixture), "{}", path.display());
    }
}

#[test]
fn schema_operation_enum_matches_the_runtime_registry() {
    let checked_schema = schema();
    let schema_operations = checked_schema["$defs"]["operation"]["enum"]
        .as_array()
        .expect("operation enum")
        .iter()
        .map(|value| value.as_str().expect("string operation"))
        .collect::<BTreeSet<_>>();

    assert_eq!(
        schema_operations,
        AGENT_OPERATIONS.iter().copied().collect::<BTreeSet<_>>()
    );
}

#[test]
fn protocol_v1_rejects_breaking_envelope_changes_but_accepts_optional_fields() {
    let base = json!({
        "protocolVersion": 1,
        "cliVersion": "0.1.6",
        "operation": "artifact.list",
        "outcome": "completed",
        "resources": {},
        "data": {}
    });
    assert!(validate(&schema(), &base));

    let mut additive = base.clone();
    additive["futureOptional"] = json!(true);
    assert!(validate(&schema(), &additive));

    let mut removed = base.clone();
    removed.as_object_mut().expect("object").remove("outcome");
    assert!(!validate(&schema(), &removed));

    let mut renamed = base.clone();
    renamed.as_object_mut().expect("object").remove("operation");
    renamed["operationName"] = json!("artifact.list");
    assert!(!validate(&schema(), &renamed));

    let mut retyped = base.clone();
    retyped["protocolVersion"] = json!("1");
    assert!(!validate(&schema(), &retyped));

    let mut missing_resources = base.clone();
    missing_resources
        .as_object_mut()
        .expect("object")
        .remove("resources");
    assert!(!validate(&schema(), &missing_resources));

    let mut invalid_resource = base.clone();
    invalid_resource["resources"] = json!({ "artifact": {} });
    assert!(!validate(&schema(), &invalid_resource));

    let mut invalid_error = base.clone();
    invalid_error["error"] = json!({ "message": "missing stable code" });
    assert!(!validate(&schema(), &invalid_error));

    let mut invalid_next_action = base.clone();
    invalid_next_action["outcome"] = json!("action_required");
    invalid_next_action["nextAction"] = json!({ "kind": "authorize" });
    assert!(!validate(&schema(), &invalid_next_action));

    let mut invalid_continuation = base.clone();
    invalid_continuation["operation"] = json!("auth.login");
    invalid_continuation["continuation"] = json!({ "id": "opaque" });
    assert!(!validate(&schema(), &invalid_continuation));

    let mut newly_required = schema();
    newly_required["$defs"]["envelope"]["required"]
        .as_array_mut()
        .expect("required")
        .push(json!("newRequiredField"));
    assert!(!validate(&newly_required, &base));
}
