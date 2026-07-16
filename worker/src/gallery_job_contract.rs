use serde::Deserialize;

pub const SUPPORTED_CONTRACT_VERSIONS: [&str; 2] = ["gallery-job/v1", "gallery-job/v0"];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GalleryJobEnvelope {
    pub contract_version: String,
    pub job_kind: GalleryJobKind,
    pub job_id: String,
    pub attempt: GalleryJobAttempt,
    pub input: GalleryJobInput,
    pub result: GalleryJobResult,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GalleryJobKind {
    Cover,
    Safety,
    Copy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GalleryJobAttempt {
    pub attempt_id: String,
    pub attempt_number: u32,
    pub fence_token: u64,
    pub lease_expires_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GalleryJobInput {
    pub snapshot_digest: String,
    pub listing_id: String,
    pub listing_revision: u64,
    pub version_id: String,
    pub object_layout_revision: String,
    pub policy_revision: String,
    pub destination_owner_user_id: Option<String>,
    pub destination_artifact_id: Option<String>,
    pub reserved_artifact_count: Option<u64>,
    pub reserved_storage_bytes: Option<u64>,
    pub source_retention_reference_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GalleryJobResult {
    pub state: GalleryJobState,
    pub terminal_result: Option<GalleryTerminalResult>,
    pub failure_code: Option<GalleryFailureCode>,
    pub output_object_key: Option<String>,
    pub evidence_digest: Option<String>,
    pub quota_effect: QuotaEffect,
    pub source_retention_effect: SourceRetentionEffect,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GalleryJobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Indeterminate,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GalleryTerminalResult {
    CoverReady,
    SafetyPass,
    SafetyReject,
    SafetyReview,
    CopyReady,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GalleryFailureCode {
    InvalidInput,
    PolicyRejected,
    RenderFailed,
    SourceUnavailable,
    QuotaUnavailable,
    IncompatibleContract,
    LeaseLost,
    Cancelled,
    InternalFailure,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum QuotaEffect {
    None,
    Hold,
    Commit,
    Release,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SourceRetentionEffect {
    None,
    Hold,
    Release,
}

impl GalleryJobEnvelope {
    /// Parses a checked current or N-1 Gallery job and enforces job-specific ownership.
    ///
    /// # Errors
    /// Returns stable validation text for incompatible or inconsistent envelopes.
    pub fn parse_json(value: &str) -> Result<Self, String> {
        let job: Self = serde_json::from_str(value).map_err(|error| error.to_string())?;
        if !SUPPORTED_CONTRACT_VERSIONS.contains(&job.contract_version.as_str()) {
            return Err("incompatible_contract".to_owned());
        }
        let copy_fields = [
            job.input.destination_owner_user_id.is_some(),
            job.input.destination_artifact_id.is_some(),
            job.input.reserved_artifact_count.is_some(),
            job.input.reserved_storage_bytes.is_some(),
            job.input.source_retention_reference_id.is_some(),
        ];
        match job.job_kind {
            GalleryJobKind::Copy if copy_fields.iter().any(|present| !present) => {
                Err("copy_input_snapshot_incomplete".to_owned())
            }
            GalleryJobKind::Cover | GalleryJobKind::Safety
                if copy_fields.iter().any(|present| *present) =>
            {
                Err("worker_forbidden_admission_input".to_owned())
            }
            _ => Ok(job),
        }
    }
}
