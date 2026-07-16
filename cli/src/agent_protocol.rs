use serde::Serialize;
use serde_json::{Value, json};

pub const AGENT_PROTOCOL_VERSION: u32 = 1;
pub const PROCESSING_WAIT_SECONDS: u32 = 30;
pub const AGENT_FEATURES: &[&str] = &[
    "outcome_envelope",
    "offline_capabilities",
    "auth_continuation",
];
pub const AGENT_OUTCOMES: &[&str] = &[
    "completed",
    "in_progress",
    "partial",
    "action_required",
    "failed",
    "indeterminate",
    "cancelled",
];
pub const AGENT_ACTION_KINDS: &[&str] = &[
    "authorize",
    "resolve_ambiguity",
    "confirm_irreversible",
    "install_or_upgrade",
    "change_local_input",
    "inspect_state",
    "retry_later",
    "contact_support",
    "accept_permission",
];
pub const AGENT_OPERATIONS: &[&str] = &[
    "capabilities",
    "artifact.publish_local",
    "auth.login",
    "auth.status",
    "auth.logout",
    "artifact.list",
    "artifact.upload",
    "artifact.publish",
    "artifact.unpublish",
    "artifact.delete",
    "artifact.publication.view",
    "artifact.publication.edit",
    "artifact.export",
    "artifact.gallery.view",
    "artifact.gallery.share",
    "artifact.gallery.update",
    "artifact.gallery.withdraw",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub cli_version: &'static str,
    pub supported_protocol_versions: &'static [u32],
    pub protocol_version: u32,
    pub features: &'static [&'static str],
    pub outcomes: &'static [&'static str],
    pub action_kinds: &'static [&'static str],
    pub processing_wait_seconds: u32,
    pub operations: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOutcome {
    Completed,
    InProgress,
    Partial,
    ActionRequired,
    Failed,
    Indeterminate,
    Cancelled,
}

impl AgentOutcome {
    #[must_use]
    pub const fn exit_code(self) -> i32 {
        match self {
            Self::Completed => 0,
            Self::Cancelled => 2,
            Self::ActionRequired => 4,
            Self::InProgress | Self::Partial | Self::Failed | Self::Indeterminate => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActionKind {
    Authorize,
    ResolveAmbiguity,
    ConfirmIrreversible,
    InstallOrUpgrade,
    ChangeLocalInput,
    InspectState,
    RetryLater,
    ContactSupport,
    AcceptPermission,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentNextAction {
    pub kind: AgentActionKind,
    pub instruction: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_report: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recoverability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_actions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContinuation {
    pub id: String,
    pub expires_at: String,
    pub check_after: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnvelope {
    pub protocol_version: u32,
    pub cli_version: &'static str,
    pub operation: &'static str,
    pub outcome: AgentOutcome,
    pub resources: Value,
    pub data: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AgentError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_action: Option<AgentNextAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<AgentContinuation>,
}

impl AgentEnvelope {
    #[must_use]
    pub fn new(operation: &'static str, outcome: AgentOutcome) -> Self {
        Self {
            protocol_version: AGENT_PROTOCOL_VERSION,
            cli_version: env!("CARGO_PKG_VERSION"),
            operation,
            outcome,
            resources: json!({}),
            data: json!({}),
            error: None,
            next_action: None,
            continuation: None,
        }
    }

    #[must_use]
    pub fn completed(operation: &'static str, resources: Value, data: Value) -> Self {
        Self {
            resources,
            data,
            ..Self::new(operation, AgentOutcome::Completed)
        }
    }
}

#[must_use]
pub fn agent_capabilities() -> AgentCapabilities {
    AgentCapabilities {
        cli_version: env!("CARGO_PKG_VERSION"),
        supported_protocol_versions: &[AGENT_PROTOCOL_VERSION],
        protocol_version: AGENT_PROTOCOL_VERSION,
        features: AGENT_FEATURES,
        outcomes: AGENT_OUTCOMES,
        action_kinds: AGENT_ACTION_KINDS,
        processing_wait_seconds: PROCESSING_WAIT_SECONDS,
        operations: AGENT_OPERATIONS,
    }
}

#[must_use]
pub fn failed_agent_envelope(
    operation: &'static str,
    code: &str,
    message: &str,
    data: Value,
) -> AgentEnvelope {
    let mut envelope = AgentEnvelope::new(operation, AgentOutcome::Failed);
    envelope.data = data;
    envelope.error = Some(AgentError {
        code: code.to_owned(),
        message: message.to_owned(),
        request_id: None,
        action: None,
        fields: None,
        details: None,
        validation_report: None,
        recoverability: None,
        allowed_actions: None,
        retry_after_seconds: None,
    });
    envelope
}
