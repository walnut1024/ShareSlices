use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
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
    #[error("The operating system credential store is unavailable: {0}")]
    CredentialStore(String),
    #[error("Invalid ShareSlices API URL.")]
    InvalidApiUrl,
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
    pub share_link: ArtifactShareLink,
    pub publication: Option<ArtifactPublication>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactShareLink {
    #[serde(default)]
    pub url: String,
    pub state: String,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPublication {
    pub id: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
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
    pub share_link: ArtifactShareLink,
    pub publication: Option<ArtifactPublication>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicationResult {
    pub id: String,
    pub version_id: String,
    pub published_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAccepted {
    pub artifact_id: String,
    pub upload_session_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactState {
    #[serde(default)]
    pub name: String,
    pub processing_state: String,
    pub ready_version: Option<ReadyVersion>,
    pub failure: Option<ArtifactFailure>,
    #[serde(default)]
    pub share_link: Option<ArtifactShareLink>,
    #[serde(default)]
    pub publication: Option<ArtifactPublication>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ReadyVersion {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadyVersionSummary {
    pub id: String,
    pub version_number: u64,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ArtifactFailure {
    pub code: String,
    pub message: String,
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
    #[error(
        "Upload was sent, but ShareSlices could not confirm acceptance after safe retries. Check artifact list before retrying."
    )]
    UploadConfirmationPending,
    #[error("Publish requires --artifact and --version when interactive prompting is unavailable.")]
    PublishSelectionUnavailable,
    #[error("Unpublish requires --artifact when interactive prompting is unavailable.")]
    UnpublishSelectionUnavailable,
    #[error("No ready Version is available for this Artifact.")]
    NoReadyVersion,
}
