use crate::{ApiClient, ArtifactError, ArtifactGalleryCommand, CredentialStore};
use std::io::Write;

/// Executes one Gallery owner command through the checked HTTP client.
///
/// # Errors
/// Returns an Artifact error when credentials, required evidence, confirmation, or the Server fail.
pub async fn run_gallery_command(
    command: ArtifactGalleryCommand,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let structured = match &command {
        ArtifactGalleryCommand::View(args) => args.agent_mode,
        ArtifactGalleryCommand::Share(args) | ArtifactGalleryCommand::Update(args) => {
            args.agent_mode
        }
        ArtifactGalleryCommand::Withdraw(args) => args.agent_mode,
    };
    let value = execute_gallery_command(command, api, store).await?;
    if structured {
        serde_json::to_writer_pretty(&mut *output, &value).map_err(|_| ArtifactError::Server)?;
        writeln!(output).map_err(|_| ArtifactError::Server)
    } else {
        write_human_gallery_result(&value, output)
    }
}

async fn execute_gallery_command(
    command: ArtifactGalleryCommand,
    api: &ApiClient,
    store: &dyn CredentialStore,
) -> Result<serde_json::Value, ArtifactError> {
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    Ok(match command {
        ArtifactGalleryCommand::View(args) => {
            serde_json::to_value(api.gallery_view(&token, &args.artifact).await?)
                .map_err(|_| ArtifactError::Server)?
        }
        ArtifactGalleryCommand::Share(args) => {
            ensure_permission(args.accept_permission)?;
            let body = mutation_body(&args);
            api.gallery_mutate(
                &token,
                reqwest::Method::POST,
                &format!("/api/artifacts/{}/gallery-listing", args.artifact),
                Some(&body),
                &args.idempotency_key,
                None,
            )
            .await?
        }
        ArtifactGalleryCommand::Update(args) => {
            ensure_permission(args.accept_permission)?;
            let listing_id = args
                .listing_id
                .as_deref()
                .ok_or(ArtifactError::SelectionUnavailable)?;
            let revision = args
                .listing_revision
                .ok_or(ArtifactError::SelectionUnavailable)?;
            let body = mutation_body(&args);
            api.gallery_mutate(
                &token,
                reqwest::Method::PATCH,
                &format!("/api/gallery-listings/{listing_id}"),
                Some(&body),
                &args.idempotency_key,
                Some(revision),
            )
            .await?
        }
        ArtifactGalleryCommand::Withdraw(args) => {
            if !args.confirm_withdraw {
                return Err(ArtifactError::ConfirmationRequired);
            }
            api.gallery_mutate(
                &token,
                reqwest::Method::DELETE,
                &format!("/api/gallery-listings/{}", args.listing_id),
                None,
                &args.idempotency_key,
                Some(args.listing_revision),
            )
            .await?
        }
    })
}

fn write_human_gallery_result(
    value: &serde_json::Value,
    output: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if let Some(listing) = value.get("listing") {
        if listing.is_null() {
            return writeln!(output, "Gallery: not shared").map_err(|_| ArtifactError::Server);
        }
        return writeln!(
            output,
            "Gallery: {} (revision {})",
            listing
                .get("lifecycle")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("unknown"),
            listing
                .get("revision")
                .and_then(serde_json::Value::as_u64)
                .map_or_else(|| "unknown".to_owned(), |revision| revision.to_string())
        )
        .map_err(|_| ArtifactError::Server);
    }
    let historical = value
        .get("historicalOutcome")
        .unwrap_or(&serde_json::Value::Null);
    let current = value.get("current").unwrap_or(&serde_json::Value::Null);
    writeln!(
        output,
        "Gallery {}: {} — {} (revision {})",
        historical
            .get("operation")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("operation"),
        historical
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("accepted"),
        current
            .get("lifecycle")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown"),
        current
            .get("revision")
            .and_then(serde_json::Value::as_u64)
            .map_or_else(|| "unknown".to_owned(), |revision| revision.to_string())
    )
    .map_err(|_| ArtifactError::Server)
}

fn ensure_permission(accepted: bool) -> Result<(), ArtifactError> {
    if accepted {
        Ok(())
    } else {
        Err(ArtifactError::PermissionAcceptanceRequired)
    }
}

fn mutation_body(args: &crate::ArtifactGalleryMutationArgs) -> serde_json::Value {
    serde_json::json!({
        "versionId": args.version,
        "profile": {"displayName": args.display_name, "biography": args.biography, "avatar": null, "expectedRevision": args.profile_revision},
        "permission": {"grantVersion": args.grant_version, "accepted": true},
        "metadata": {"title": args.title, "description": args.description, "tags": args.tags},
        "confirmedReplacement": args.confirm_replacement
    })
}
