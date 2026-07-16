use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorEvidence {
    pub code: String,
    pub message: String,
    pub request_id: Option<String>,
    pub action: Option<String>,
    pub fields: Option<serde_json::Value>,
    pub details: Option<serde_json::Value>,
    pub retry_after_seconds: Option<u64>,
    pub status: u16,
}

impl std::fmt::Display for ApiErrorEvidence {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if !self.message.is_empty() {
            return formatter.write_str(&self.message);
        }
        formatter.write_str(match self.code.as_str() {
            "unauthenticated" => "Not signed in. Run shareslices auth login.",
            "cli_upgrade_required" => "Update ShareSlices CLI before continuing.",
            "version_not_ready" => {
                "The selected Version is not ready. Wait for processing to finish, then try again."
            }
            "invalid_artifact_state" => {
                "The Artifact's current state does not allow this operation."
            }
            _ => "ShareSlices returned an unexpected response.",
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct User {
    pub name: String,
    pub email: String,
}

#[derive(Clone, Debug)]
pub struct Authorization {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Clone, Debug)]
pub struct Exchange {
    pub access_token: String,
    pub user: User,
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Not signed in.")]
    Unauthenticated,
    #[error("Authorization is still pending.")]
    Pending,
    #[error("Polling too quickly.")]
    SlowDown,
    #[error("Authorization expired. Run shareslices auth login again.")]
    Expired,
    #[error("Authorization denied.")]
    Denied,
    #[error("Update ShareSlices CLI before continuing.\nCurrent: {current}\nMinimum: {minimum}")]
    UpgradeRequired { current: String, minimum: String },
    #[error("Could not reach ShareSlices: {0}")]
    Network(String),
    #[error("ShareSlices returned an unexpected response.")]
    Server,
    #[error("{0}")]
    ServerEvidence(Box<ApiErrorEvidence>),
    #[error("The operating system credential store is unavailable: {0}")]
    CredentialStore(String),
    #[error("Invalid ShareSlices API URL.")]
    InvalidApiUrl,
}

impl AuthError {
    #[must_use]
    pub fn has_server_code(&self, expected: &str) -> bool {
        matches!(self, Self::ServerEvidence(evidence) if evidence.code == expected)
    }
}

pub trait CredentialStore: Send + Sync {
    /// Reads the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when the operating-system store cannot be read.
    fn get(&self) -> Result<Option<String>, AuthError>;
    /// Stores the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when secure storage fails.
    fn set(&self, value: &str) -> Result<(), AuthError>;
    /// Removes the credential for the selected API origin.
    ///
    /// # Errors
    /// Returns [`AuthError::CredentialStore`] when secure deletion fails.
    fn delete(&self) -> Result<(), AuthError>;
}

#[async_trait]
pub trait AuthApi: Send + Sync {
    async fn current_user(&self, token: &str) -> Result<User, AuthError>;
    async fn start_authorization(&self) -> Result<Authorization, AuthError>;
    async fn exchange(&self, device_code: &str) -> Result<Exchange, AuthError>;
    async fn revoke(&self, token: &str) -> Result<(), AuthError>;
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub name: String,
    pub updated_at: String,
    pub processing_state: String,
    pub share_link: Option<ArtifactShareLink>,
    #[serde(default)]
    pub publication_status: PublicationStatus,
    pub publication: Option<ArtifactPublication>,
    #[serde(default)]
    pub ready_version: Option<ReadyVersion>,
    #[serde(default)]
    pub validation_report: Option<serde_json::Value>,
    #[serde(default)]
    pub failure: Option<ArtifactFailure>,
    #[serde(default)]
    pub allowed_actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactShareLink {
    pub url: String,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPublication {
    pub id: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub expiration_kind: Option<String>,
    #[serde(default)]
    pub duration_seconds: Option<u64>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
    #[serde(default)]
    pub end_reason: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicationStatus {
    #[default]
    NotPublished,
    Published,
    Expired,
    Unpublished,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ExpirationPolicy {
    Permanent,
    Duration { duration_seconds: u64 },
    Exact { expires_at: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadyArtifactVersion {
    pub id: String,
    pub version_number: u64,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDetail {
    pub id: String,
    pub name: String,
    pub share_link: Option<ArtifactShareLink>,
    #[serde(default)]
    pub publication_status: PublicationStatus,
    pub publication: Option<ArtifactPublication>,
    #[serde(default)]
    pub processing_state: String,
    #[serde(default)]
    pub ready_version: Option<ReadyVersion>,
    #[serde(default)]
    pub validation_report: Option<serde_json::Value>,
    #[serde(default)]
    pub failure: Option<ArtifactFailure>,
    #[serde(default)]
    pub allowed_actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationResult {
    pub id: String,
    pub version_id: String,
    pub published_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublishedResult {
    pub publication: PublicationResult,
    pub share_link: ArtifactShareLink,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAccepted {
    pub artifact_id: String,
    pub upload_session_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactState {
    #[serde(default)]
    pub name: String,
    pub processing_state: String,
    pub ready_version: Option<ReadyVersion>,
    #[serde(default)]
    pub publication: Option<ArtifactPublication>,
    pub failure: Option<ArtifactFailure>,
    #[serde(default)]
    pub validation_report: Option<serde_json::Value>,
    #[serde(default)]
    pub allowed_actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ReadyVersion {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPermissionGrant {
    pub version: String,
    #[serde(alias = "text")]
    pub exact_text: String,
    #[serde(default)]
    pub text_digest: Option<String>,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub requires_renewal_on_next_proposal: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPermissionEvidence {
    pub grant_version: String,
    pub accepted_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryMetadata {
    pub title: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryCommittedRevision {
    pub revision: u64,
    pub version_id: String,
    pub metadata: GalleryMetadata,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryProposedRevision {
    pub id: String,
    pub state: String,
    pub base_listing_revision: u64,
    pub version_id: String,
    pub metadata: GalleryMetadata,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryListingResource {
    pub id: String,
    pub artifact_id: String,
    pub lifecycle: String,
    pub review_state: String,
    pub closure_reason: Option<String>,
    pub revision: u64,
    pub committed: Option<GalleryCommittedRevision>,
    pub proposal: Option<GalleryProposedRevision>,
    #[serde(default)]
    pub current_grant_evidence: Option<GalleryPermissionEvidence>,
    #[serde(default)]
    pub historical_grant_evidence: Vec<GalleryPermissionEvidence>,
    pub effective_access: GalleryEffectiveAccess,
    #[serde(default)]
    pub allowed_actions: Vec<String>,
    pub public_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryEffectiveAccess {
    pub accessible: bool,
    #[serde(default)]
    pub restrictions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryViewResult {
    pub artifact_id: String,
    pub listing: Option<GalleryListingResource>,
    pub current_grant: Option<GalleryPermissionGrant>,
    pub historical_grant_evidence: Vec<GalleryPermissionEvidence>,
    pub grant_availability: String,
    #[serde(default)]
    pub profile_requirement: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ArtifactFailure {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub recoverable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadPolicy {
    pub revision: String,
    pub max_archive_bytes: u64,
    pub max_expanded_bytes: u64,
    pub max_file_count: usize,
    pub max_file_bytes: u64,
    pub enabled_extensions: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    #[error("Accept the exact current Gallery permission terms with --accept-permission.")]
    PermissionAcceptanceRequired,
    #[error("This irreversible operation requires its explicit confirmation flag.")]
    ConfirmationRequired,
    #[error("Not signed in. Run shareslices auth login.")]
    Unauthenticated,
    #[error("Unsupported JSON field: {0}")]
    UnsupportedField(String),
    #[error("Upload requires --name or --artifact when interactive prompting is unavailable.")]
    SelectionUnavailable,
    #[error("Artifact selection was cancelled.")]
    Cancelled,
    #[error("Invalid --jq expression.")]
    InvalidJq,
    #[error("Invalid Go template expression.")]
    InvalidTemplate,
    #[error("Could not reach ShareSlices: {0}")]
    Network(String),
    #[error("Update ShareSlices CLI before continuing.\nCurrent: {current}\nMinimum: {minimum}")]
    UpgradeRequired { current: String, minimum: String },
    #[error("ShareSlices returned an unexpected response.")]
    Server,
    #[error("{0}")]
    ServerEvidence(Box<ApiErrorEvidence>),
    #[error("Upload input must be one readable .zip file.")]
    InvalidZipInput,
    #[error("Invalid upload input: {0}")]
    InvalidUploadInput(String),
    #[error("The ZIP has multiple possible entry files; pass --entry <path>.")]
    AmbiguousEntry,
    #[error("The requested entry is not an HTML file in the ZIP.")]
    InvalidEntry,
    #[error("Artifact processing failed: {0}")]
    ProcessingFailed(String),
    #[error("Artifact processing is still in progress.")]
    ProcessingInProgress {
        artifact_id: String,
        upload_session_id: String,
    },
    #[error(
        "Upload was sent, but ShareSlices could not confirm acceptance after safe retries. Check artifact list before retrying."
    )]
    UploadConfirmationPending,
    #[error(
        "Publish requires ARTIFACT_ID and --version when interactive prompting is unavailable."
    )]
    PublishSelectionUnavailable,
    #[error("Unpublish requires ARTIFACT_ID when interactive prompting is unavailable.")]
    UnpublishSelectionUnavailable,
    #[error("Share view requires ARTIFACT_ID when interactive prompting is unavailable.")]
    ShareViewSelectionUnavailable,
    #[error(
        "Share edit requires ARTIFACT_ID and --expires-at when interactive prompting is unavailable."
    )]
    ShareEditSelectionUnavailable,
    #[error("--expires-at must be a future RFC 3339 timestamp or 'never'.")]
    InvalidShareExpiration,
    #[error(
        "Publication expiration must be permanent, a positive duration, or a future RFC 3339 timestamp."
    )]
    InvalidPublicationExpiration,
    #[error("No ready Version is available for this Artifact.")]
    NoReadyVersion,
    #[error("Delete requires an Artifact ID when interactive prompting is unavailable.")]
    DeleteSelectionUnavailable,
    #[error("Delete confirmation is required. Pass --yes with an explicit Artifact ID.")]
    DeleteConfirmationRequired,
    #[error("Artifact cannot be deleted while processing.")]
    DeleteProcessingActive,
    #[error("Artifact not found.")]
    ArtifactNotFound,
    #[error(
        "The delete request was sent, but ShareSlices could not confirm the result. Check artifact list, then retry the same explicit delete once; ShareSlices will safely resume pending cleanup."
    )]
    DeleteConfirmationPending,
    #[error("Export requires ARTIFACT_ID and --version when interactive prompting is unavailable.")]
    ExportSelectionUnavailable,
    #[error("The selected Version is not ready. Wait for processing to finish, then try again.")]
    VersionNotReady,
    #[error("The Artifact's current state does not allow this operation.")]
    InvalidArtifactState,
    #[error("The output parent directory does not exist.")]
    OutputParentMissing,
    #[error("The output file already exists; pass --clobber to replace it.")]
    OutputExists,
    #[error("Could not write the exported ZIP.")]
    OutputWrite,
}
