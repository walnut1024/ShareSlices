use clap::Parser as _;
use shareslices_cli::{
    AGENT_ACTION_KINDS, AGENT_OPERATIONS, AGENT_OUTCOMES, AuthError, Cli, CredentialStore,
    agent_operation_id, run_cli_process,
};
use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

fn assert_protocol_v1(value: &serde_json::Value) {
    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../schema/agent-protocol-v1.schema.json"))
            .expect("checked schema");
    assert!(
        jsonschema::validator_for(&schema)
            .expect("valid schema")
            .is_valid(value),
        "result must validate against Agent protocol v1: {value}"
    );
}

struct UnusedStore;

impl CredentialStore for UnusedStore {
    fn get(&self) -> Result<Option<String>, AuthError> {
        panic!("offline discovery must not access credentials")
    }

    fn set(&self, _value: &str) -> Result<(), AuthError> {
        panic!("offline discovery must not access credentials")
    }

    fn delete(&self) -> Result<(), AuthError> {
        panic!("offline discovery must not access credentials")
    }
}

#[tokio::test]
async fn capabilities_is_offline_and_unauthenticated() {
    let called = Arc::new(AtomicBool::new(false));
    let factory_called = Arc::clone(&called);
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();

    let code = run_cli_process(
        ["shareslices", "--agent", "capabilities"],
        move |_| {
            factory_called.store(true, Ordering::SeqCst);
            Ok(UnusedStore)
        },
        &mut output,
        &mut diagnostics,
    )
    .await;

    assert_eq!(code, 0);
    assert!(!called.load(Ordering::SeqCst));
    assert!(diagnostics.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output).expect("capabilities JSON");
    assert_protocol_v1(&value);
    assert_eq!(value["cliVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(value["supportedProtocolVersions"], serde_json::json!([1]));
    assert_eq!(value["protocolVersion"], 1);
    assert_eq!(value["processingWaitSeconds"], 30);
    assert_eq!(value["operations"], serde_json::json!(AGENT_OPERATIONS));
    assert_eq!(value["outcomes"], serde_json::json!(AGENT_OUTCOMES));
    assert_eq!(value["actionKinds"], serde_json::json!(AGENT_ACTION_KINDS));
    assert_eq!(
        value["features"],
        serde_json::json!([
            "outcome_envelope",
            "offline_capabilities",
            "auth_continuation"
        ])
    );
}

#[tokio::test]
async fn operational_agent_command_requires_selected_protocol() {
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    let code = run_cli_process(
        ["shareslices", "--agent", "auth", "status"],
        |_| Ok(UnusedStore),
        &mut output,
        &mut diagnostics,
    )
    .await;

    assert_eq!(code, 1);
    assert!(diagnostics.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output).expect("failed envelope");
    assert_protocol_v1(&value);
    assert_eq!(value["operation"], "auth.status");
    assert_eq!(value["outcome"], "failed");
    assert_eq!(value["error"]["code"], "agent_protocol_required");
    assert_eq!(
        value["data"]["supportedProtocolVersions"],
        serde_json::json!([1])
    );
}

#[tokio::test]
async fn capabilities_rejects_a_protocol_selector_with_an_agent_envelope() {
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    let code = run_cli_process(
        [
            "shareslices",
            "--agent",
            "--agent-protocol",
            "1",
            "capabilities",
        ],
        |_| Ok(UnusedStore),
        &mut output,
        &mut diagnostics,
    )
    .await;

    assert_eq!(code, 1);
    assert!(diagnostics.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output).expect("failed envelope");
    assert_protocol_v1(&value);
    assert_eq!(value["operation"], "capabilities");
    assert_eq!(value["error"]["code"], "agent_protocol_not_allowed");
}

#[tokio::test]
async fn unsupported_agent_protocol_fails_locally_with_supported_versions() {
    let store_called = Arc::new(AtomicBool::new(false));
    let factory_called = Arc::clone(&store_called);
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    let code = run_cli_process(
        [
            "shareslices",
            "--agent",
            "--agent-protocol",
            "2",
            "auth",
            "status",
        ],
        move |_| {
            factory_called.store(true, Ordering::SeqCst);
            Ok(UnusedStore)
        },
        &mut output,
        &mut diagnostics,
    )
    .await;

    assert_eq!(code, 1);
    assert!(diagnostics.is_empty());
    assert!(!store_called.load(Ordering::SeqCst));
    let value: serde_json::Value = serde_json::from_slice(&output).expect("failed envelope");
    assert_protocol_v1(&value);
    assert_eq!(value["error"]["code"], "unsupported_agent_protocol");
    assert_eq!(value["data"]["selectedProtocolVersion"], 2);
    assert_eq!(
        value["data"]["supportedProtocolVersions"],
        serde_json::json!([1])
    );
}

#[test]
fn operational_agent_commands_match_capabilities() {
    let commands: &[(&[&str], &str)] = &[
        (
            &["publish", ".", "--name", "Report"],
            "artifact.publish_local",
        ),
        (&["auth", "login"], "auth.login"),
        (&["auth", "status"], "auth.status"),
        (&["auth", "logout"], "auth.logout"),
        (&["artifact", "list"], "artifact.list"),
        (
            &["artifact", "upload", ".", "--name", "Report"],
            "artifact.upload",
        ),
        (&["artifact", "publish", "artifact_123"], "artifact.publish"),
        (
            &["artifact", "unpublish", "artifact_123"],
            "artifact.unpublish",
        ),
        (
            &["artifact", "delete", "artifact_123", "--yes"],
            "artifact.delete",
        ),
        (
            &["artifact", "publication", "view", "artifact_123"],
            "artifact.publication.view",
        ),
        (
            &[
                "artifact",
                "publication",
                "edit",
                "artifact_123",
                "--expires-at",
                "never",
            ],
            "artifact.publication.edit",
        ),
        (&["artifact", "export", "artifact_123"], "artifact.export"),
    ];
    let mut parsed_operations = BTreeSet::from(["capabilities"]);

    for (command, expected_operation) in commands {
        let mut arguments = vec!["shareslices", "--agent", "--agent-protocol", "1"];
        arguments.extend_from_slice(command);
        let parsed = Cli::try_parse_from(arguments).expect("advertised command parses");
        assert_eq!(agent_operation_id(&parsed.command), *expected_operation);
        parsed_operations.insert(expected_operation);
    }

    assert_eq!(
        parsed_operations,
        AGENT_OPERATIONS.iter().copied().collect::<BTreeSet<_>>()
    );
}

#[tokio::test]
async fn agent_rejects_other_presentations_before_credentials_or_network() {
    for flag in ["--json", "--jq", "--template"] {
        let mut arguments = vec![
            "shareslices",
            "--agent",
            "--agent-protocol",
            "1",
            "artifact",
            "list",
        ];
        arguments.extend([flag, if flag == "--json" { "id" } else { "." }]);
        let mut output = Vec::new();
        let code =
            run_cli_process(arguments, |_| Ok(UnusedStore), &mut output, &mut Vec::new()).await;
        assert_eq!(code, 1);
        let value: serde_json::Value = serde_json::from_slice(&output).expect("Agent envelope");
        assert_protocol_v1(&value);
        assert_eq!(value["error"]["code"], "presentation_conflict");
    }
}

#[tokio::test]
async fn unconfirmed_link_replacement_requires_human_action_before_dispatch() {
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    let code = run_cli_process(
        [
            "shareslices",
            "--agent",
            "--agent-protocol",
            "1",
            "artifact",
            "publish",
            "artifact_123",
            "--replace-link",
        ],
        |_| Ok(UnusedStore),
        &mut output,
        &mut diagnostics,
    )
    .await;
    assert_eq!(code, 4);
    assert!(diagnostics.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output).expect("Agent envelope");
    assert_protocol_v1(&value);
    assert_eq!(value["outcome"], "action_required");
    assert_eq!(value["nextAction"]["kind"], "confirm_irreversible");
}
