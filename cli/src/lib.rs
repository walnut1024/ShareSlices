mod agent_protocol;
mod api_client;
mod artifact_commands;
mod auth_commands;
mod auth_continuation;
mod cli_runner;
mod command_line;
mod credential_store;
mod gallery_commands;
mod model;
mod packaging;

pub use agent_protocol::{
    AGENT_ACTION_KINDS, AGENT_FEATURES, AGENT_OPERATIONS, AGENT_OUTCOMES, AGENT_PROTOCOL_VERSION,
    AgentActionKind, AgentCapabilities, AgentContinuation, AgentEnvelope, AgentError,
    AgentNextAction, AgentOutcome, agent_capabilities, failed_agent_envelope,
};
pub use api_client::ApiClient;
pub use artifact_commands::{
    ArtifactInteraction, UploadTargetChoice, artifact_exit_code, run_artifact_command,
    run_artifact_command_with_input, run_artifact_command_with_interaction, run_artifact_delete,
    run_artifact_export_with_interaction, run_artifact_list, run_artifact_publication_edit,
    run_artifact_publication_view, run_artifact_publish, run_artifact_unpublish,
    run_artifact_upload, run_artifact_upload_for_publish, select_artifact, select_owned_artifact,
    select_upload_target,
};
pub use auth_commands::run_auth;
pub use auth_continuation::{
    AuthContinuationRecord, AuthContinuationStore, CONTINUATION_RECORD_VERSION,
    FileAuthContinuationStore, MemoryAuthContinuationStore, format_timestamp, normalized_origin,
    unix_now,
};
pub use cli_runner::{agent_operation_id, run_cli_process};
pub use command_line::{
    ArtifactCommand, ArtifactDeleteArgs, ArtifactExportArgs, ArtifactGalleryCommand,
    ArtifactGalleryMutationArgs, ArtifactGalleryViewArgs, ArtifactGalleryWithdrawArgs,
    ArtifactListArgs, ArtifactPublicationCommand, ArtifactPublicationEditArgs,
    ArtifactPublicationViewArgs, ArtifactPublishArgs, ArtifactUnpublishArgs, ArtifactUploadArgs,
    AuthCommand, Cli, Command, ProcessingFilter, PublicationFilter, PublishArgs,
};
pub use credential_store::KeyringCredentialStore;
pub use gallery_commands::run_gallery_command;
pub use model::{
    ApiErrorEvidence, Artifact, ArtifactAccepted, ArtifactDetail, ArtifactError, ArtifactFailure,
    ArtifactPublication, ArtifactShareLink, ArtifactState, ExpirationPolicy,
    GalleryCommittedRevision, GalleryEffectiveAccess, GalleryListingResource, GalleryMetadata,
    GalleryPermissionEvidence, GalleryPermissionGrant, GalleryProposedRevision, GalleryViewResult,
    PublicationResult, PublicationStatus, PublishedResult, ReadyArtifactVersion, ReadyVersion,
    UploadPolicy,
};
pub use model::{AuthApi, AuthError, Authorization, CredentialStore, Exchange, User};
