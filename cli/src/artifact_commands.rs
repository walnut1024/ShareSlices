// cspell:ignore gtmpl noclobber
use crate::packaging::prepare_upload_with_progress;
use crate::{
    ApiClient, Artifact, ArtifactCommand, ArtifactDeleteArgs, ArtifactError, ArtifactExportArgs,
    ArtifactListArgs, ArtifactPublicationCommand, ArtifactPublicationEditArgs,
    ArtifactPublicationViewArgs, ArtifactPublishArgs, ArtifactUnpublishArgs, ArtifactUploadArgs,
    CredentialStore, ExpirationPolicy, PublicationStatus, ReadyArtifactVersion,
};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, IsTerminal, Write};

const FIELDS: &[&str] = &[
    "id",
    "name",
    "processingState",
    "publicationState",
    "expiresAt",
    "updatedAt",
];
const UPLOAD_FIELDS: &[&str] = &["artifact", "version", "publication"];
const EXPORT_FIELDS: &[&str] = &["artifactId", "versionId", "path"];

pub struct ArtifactInteraction<'a> {
    pub prompts_enabled: bool,
    pub is_terminal: bool,
    pub input: &'a mut dyn BufRead,
}

/// Executes one parsed Artifact command through the production command-dispatch path.
///
/// # Errors
/// Returns the command's typed Artifact error.
pub async fn run_artifact_command(
    command: ArtifactCommand,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let stdin = std::io::stdin();
    let mut interaction = ArtifactInteraction {
        prompts_enabled: std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_none(),
        is_terminal: stdin.is_terminal(),
        input: &mut stdin.lock(),
    };
    run_artifact_command_with_interaction(
        command,
        api,
        store,
        &mut interaction,
        output,
        diagnostics,
    )
    .await
}

/// Executes an Artifact command through the production dispatcher with an explicit interaction seam.
///
/// # Errors
/// Returns the command's typed Artifact error.
pub async fn run_artifact_command_with_interaction(
    command: ArtifactCommand,
    api: &ApiClient,
    store: &dyn CredentialStore,
    interaction: &mut ArtifactInteraction<'_>,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    match command {
        ArtifactCommand::List(args) => run_artifact_list(&args, api, store, output).await,
        ArtifactCommand::Upload(args) => run_artifact_upload_with_interaction(
            &args,
            api,
            store,
            interaction,
            output,
            diagnostics,
        )
        .await
        .map(|_| ()),
        ArtifactCommand::Publish(args) => {
            run_artifact_publish(
                &args,
                api,
                store,
                interaction.prompts_enabled && interaction.is_terminal,
                interaction.input,
                output,
                diagnostics,
            )
            .await
        }
        ArtifactCommand::Unpublish(args) => {
            run_artifact_unpublish(
                &args,
                api,
                store,
                interaction.prompts_enabled && interaction.is_terminal,
                interaction.input,
                output,
                diagnostics,
            )
            .await
        }
        ArtifactCommand::Delete(args) => {
            run_artifact_delete(&args, api, store, interaction, output, diagnostics).await
        }
        ArtifactCommand::Publication { command } => match command {
            ArtifactPublicationCommand::View(args) => {
                run_artifact_publication_view(
                    &args,
                    api,
                    store,
                    interaction.prompts_enabled && interaction.is_terminal,
                    interaction.input,
                    output,
                    diagnostics,
                )
                .await
            }
            ArtifactPublicationCommand::Edit(args) => {
                run_artifact_publication_edit(
                    &args,
                    api,
                    store,
                    interaction.prompts_enabled && interaction.is_terminal,
                    interaction.input,
                    output,
                    diagnostics,
                )
                .await
            }
        },
        ArtifactCommand::Export(args) => {
            run_artifact_export_with_interaction(
                &args,
                api,
                store,
                interaction,
                output,
                diagnostics,
            )
            .await
        }
    }
}

fn safe_file_component(value: &str) -> String {
    let mut safe = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_') {
            safe.push(character);
        } else if !safe.ends_with('-') {
            safe.push('-');
        }
    }
    let value = safe.trim_matches(['-', '.']);
    if value.is_empty() {
        "artifact".to_owned()
    } else if matches!(
        value.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        format!("_{value}")
    } else {
        value.to_owned()
    }
}

/// Exports an owned ready Version using the production interaction seam.
///
/// # Errors
/// Returns an Artifact error for selection, authentication, download, or local file failures.
pub async fn run_artifact_export_with_interaction(
    args: &ArtifactExportArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    interaction: &mut ArtifactInteraction<'_>,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let is_terminal = interaction.prompts_enabled && interaction.is_terminal;
    if args.artifact.is_none() && !is_terminal {
        return Err(ArtifactError::ExportSelectionUnavailable);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let (artifact_id, selected_name) = if let Some(id) = &args.artifact {
        (id.clone(), None)
    } else {
        let artifact =
            select_owned_artifact(api, store, true, true, interaction.input, diagnostics).await?;
        (artifact.id, Some(artifact.name))
    };
    let state = api.artifact_state(&token, &artifact_id).await?;
    let artifact_name = selected_name.unwrap_or_else(|| state.name.clone());
    let version_id = if let Some(version) = &args.version {
        version.clone()
    } else if is_terminal {
        select_ready_version(
            &api.list_ready_versions(&token, &artifact_id).await?,
            true,
            interaction.input,
            diagnostics,
        )?
        .id
    } else {
        return Err(ArtifactError::ExportSelectionUnavailable);
    };
    let destination = args.output.clone().unwrap_or_else(|| {
        std::path::PathBuf::from(format!(
            "{}-{}.zip",
            safe_file_component(&artifact_name),
            safe_file_component(&version_id)
        ))
    });
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    if !parent.is_dir() {
        return Err(ArtifactError::OutputParentMissing);
    }
    if destination.exists() && !args.clobber {
        return Err(ArtifactError::OutputExists);
    }
    let response = api
        .export_version(&token, &artifact_id, &version_id)
        .await?;
    persist_export_response(
        response,
        &destination,
        args.clobber,
        args.no_progress,
        diagnostics,
    )
    .await?;
    write_export_output(args, output, &artifact_id, &version_id, &destination)
}

async fn persist_export_response(
    mut response: reqwest::Response,
    destination: &std::path::Path,
    clobber: bool,
    no_progress: bool,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| ArtifactError::OutputWrite)?;
    let mut downloaded = 0_u64;
    loop {
        let next = tokio::select! { next = response.chunk() => next.map_err(|error| ArtifactError::Network(error.to_string()))?, result = tokio::signal::ctrl_c() => { result.map_err(|_| ArtifactError::Server)?; return Err(ArtifactError::Cancelled); } };
        let Some(chunk) = next else { break };
        temporary
            .write_all(&chunk)
            .map_err(|_| ArtifactError::OutputWrite)?;
        downloaded = downloaded.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
        if !no_progress {
            writeln!(diagnostics, "Downloading {downloaded} bytes")
                .map_err(|_| ArtifactError::OutputWrite)?;
        }
    }
    temporary.flush().map_err(|_| ArtifactError::OutputWrite)?;
    if clobber {
        temporary
            .persist(destination)
            .map_err(|_| ArtifactError::OutputWrite)?;
    } else {
        temporary.persist_noclobber(destination).map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                ArtifactError::OutputExists
            } else {
                ArtifactError::OutputWrite
            }
        })?;
    }
    Ok(())
}

fn write_export_output(
    args: &ArtifactExportArgs,
    output: &mut dyn Write,
    artifact_id: &str,
    version_id: &str,
    destination: &std::path::Path,
) -> Result<(), ArtifactError> {
    let Some(fields) = &args.json else {
        return writeln!(
            output,
            "Exported Artifact {artifact_id} Version {version_id} to {}",
            destination.display()
        )
        .map_err(|_| ArtifactError::OutputWrite);
    };
    let fields = parse_fields_from(fields, EXPORT_FIELDS)?;
    let value = serde_json::json!({"artifactId": artifact_id, "versionId": version_id, "path": destination.display().to_string()});
    let selected = Value::Object(
        fields
            .into_iter()
            .map(|field| (field.to_owned(), value[field].clone()))
            .collect(),
    );
    if let Some(expression) = &args.jq {
        write_jq(output, &selected, expression)
    } else if let Some(template) = &args.template {
        write_template(output, &selected, template)
    } else {
        writeln!(
            output,
            "{}",
            serde_json::to_string_pretty(&selected).map_err(|_| ArtifactError::Server)?
        )
        .map_err(|_| ArtifactError::OutputWrite)
    }
}

/// Permanently deletes one explicitly or interactively selected owned Artifact.
///
/// # Errors
/// Returns an Artifact error for unavailable selection or confirmation, cancellation,
/// authentication, state conflict, or an indeterminate mutation result.
pub async fn run_artifact_delete(
    args: &ArtifactDeleteArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    interaction: &mut ArtifactInteraction<'_>,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let interactive = interaction.prompts_enabled && interaction.is_terminal;
    if args.artifact.is_none() && !interactive {
        return Err(ArtifactError::DeleteSelectionUnavailable);
    }
    if args.artifact.is_some() && !args.yes && !interactive {
        return Err(ArtifactError::DeleteConfirmationRequired);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let (artifact_id, artifact_name) = if let Some(id) = args.artifact.as_deref() {
        if args.yes {
            (id.to_owned(), None)
        } else {
            let artifact = api.artifact(&token, id).await?;
            (artifact.id, Some(artifact.name))
        }
    } else {
        let artifact = select_owned_artifact(
            api,
            store,
            interaction.prompts_enabled,
            interaction.is_terminal,
            interaction.input,
            diagnostics,
        )
        .await?;
        (artifact.id, Some(artifact.name))
    };
    // --yes is deliberately effective only with an ID supplied on the command line.
    if args.artifact.is_none() || !args.yes {
        writeln!(
            diagnostics,
            "Permanently delete Artifact \"{}\" ({artifact_id})? This cannot be undone. [y/N]",
            artifact_name.as_deref().unwrap_or(&artifact_id)
        )
        .map_err(|_| ArtifactError::Server)?;
        diagnostics.flush().map_err(|_| ArtifactError::Server)?;
        let mut answer = String::new();
        interaction
            .input
            .read_line(&mut answer)
            .map_err(|_| ArtifactError::Cancelled)?;
        if !matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes") {
            return Err(ArtifactError::Cancelled);
        }
    }
    api.delete_artifact(&token, &artifact_id).await?;
    writeln!(output, "Deleted Artifact {artifact_id}.").map_err(|_| ArtifactError::Server)
}

const SHARE_FIELDS: &[&str] = &[
    "artifactId",
    "url",
    "publicationState",
    "expiresAt",
    "copyEligible",
];

struct SharePresentation<'a> {
    json: Option<&'a str>,
    jq: Option<&'a str>,
    template: Option<&'a str>,
}

fn publication_status(status: &PublicationStatus) -> &'static str {
    match status {
        PublicationStatus::NotPublished => "not_published",
        PublicationStatus::Published => "published",
        PublicationStatus::Expired => "expired",
        PublicationStatus::Unpublished => "unpublished",
    }
}

fn write_share_result(
    output: &mut dyn Write,
    presentation: &SharePresentation<'_>,
    artifact: &crate::ArtifactDetail,
) -> Result<(), ArtifactError> {
    let value = serde_json::json!({
        "artifactId": artifact.id,
        "url": artifact.share_link.as_ref().map(|link| &link.url),
        "publicationState": publication_status(&artifact.publication_status),
        "expiresAt": artifact.publication.as_ref().and_then(|value| value.expires_at.as_deref()),
        "copyEligible": matches!(artifact.publication_status, PublicationStatus::Published),
    });
    if let Some(fields) = presentation.json {
        let fields = parse_fields_from(fields, SHARE_FIELDS)?;
        let selected = Value::Object(
            fields
                .into_iter()
                .map(|field| (field.to_owned(), value[field].clone()))
                .collect(),
        );
        if let Some(expression) = presentation.jq {
            write_jq(output, &selected, expression)
        } else if let Some(template) = presentation.template {
            write_template(output, &selected, template)
        } else {
            writeln!(
                output,
                "{}",
                serde_json::to_string_pretty(&selected).map_err(|_| ArtifactError::Server)?
            )
            .map_err(|_| ArtifactError::Server)
        }
    } else {
        let expires = artifact
            .publication
            .as_ref()
            .and_then(|value| value.expires_at.as_deref())
            .unwrap_or("never");
        writeln!(
            output,
            "Share link: {}",
            artifact
                .share_link
                .as_ref()
                .map_or("none", |link| link.url.as_str())
        )
        .and_then(|()| {
            writeln!(
                output,
                "Publication: {}",
                publication_status(&artifact.publication_status)
            )
        })
        .and_then(|()| writeln!(output, "Expires: {expires}"))
        .and_then(|()| {
            writeln!(
                output,
                "Copy eligible: {}",
                matches!(artifact.publication_status, PublicationStatus::Published)
            )
        })
        .map_err(|_| ArtifactError::Server)
    }
}

/// Reads an owned Artifact's stable Share link and effective access state.
///
/// # Errors
/// Returns an Artifact error for unavailable selection, authentication, formatting, or Server failures.
pub async fn run_artifact_publication_view(
    args: &ArtifactPublicationViewArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let (_, artifact) = resolve_owned_artifact(
        args.artifact.as_deref(),
        api,
        store,
        is_terminal,
        input,
        diagnostics,
        ArtifactError::ShareViewSelectionUnavailable,
    )
    .await?;
    write_share_result(
        output,
        &SharePresentation {
            json: args.json.as_deref(),
            jq: args.jq.as_deref(),
            template: args.template.as_deref(),
        },
        &artifact,
    )
}

fn parse_share_expiration(value: &str) -> Result<Option<String>, ArtifactError> {
    if value == "never" {
        return Ok(None);
    }
    let expiration =
        time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
            .map_err(|_| ArtifactError::InvalidShareExpiration)?;
    if expiration <= time::OffsetDateTime::now_utc() {
        return Err(ArtifactError::InvalidShareExpiration);
    }
    Ok(Some(value.to_owned()))
}

/// Updates only an owned Artifact's Share-link expiration.
///
/// # Errors
/// Returns an Artifact error for unavailable selection, invalid expiration, authentication,
/// formatting, or Server failures.
pub async fn run_artifact_publication_edit(
    args: &ArtifactPublicationEditArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if !is_terminal && (args.artifact.is_none() || args.expires_at.is_none()) {
        return Err(ArtifactError::ShareEditSelectionUnavailable);
    }
    let explicit_expiration = args
        .expires_at
        .as_deref()
        .map(parse_share_expiration)
        .transpose()?;
    let (token, artifact) = resolve_owned_artifact(
        args.artifact.as_deref(),
        api,
        store,
        is_terminal,
        input,
        diagnostics,
        ArtifactError::ShareEditSelectionUnavailable,
    )
    .await?;
    let requested_expiration = if let Some(value) = explicit_expiration {
        value
    } else {
        write!(diagnostics, "Expiration (RFC 3339 or never): ")
            .and_then(|()| diagnostics.flush())
            .map_err(|_| ArtifactError::Server)?;
        let mut value = String::new();
        input
            .read_line(&mut value)
            .map_err(|_| ArtifactError::Cancelled)?;
        let value = value.trim();
        if value.is_empty() {
            return Err(ArtifactError::Cancelled);
        }
        parse_share_expiration(value)?
    };
    let publication_id = artifact
        .publication
        .as_ref()
        .map(|publication| publication.id.as_str())
        .ok_or(ArtifactError::InvalidArtifactState)?;
    let updated = api
        .set_publication_expiration(
            &token,
            &artifact.id,
            publication_id,
            requested_expiration.as_deref(),
        )
        .await?;
    write_share_result(
        output,
        &SharePresentation {
            json: args.json.as_deref(),
            jq: args.jq.as_deref(),
            template: args.template.as_deref(),
        },
        &updated,
    )
}

/// Executes through the production dispatcher with an injectable input and TTY state.
///
/// # Errors
/// Returns the command's typed Artifact error.
pub async fn run_artifact_command_with_input(
    command: ArtifactCommand,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let mut interaction = ArtifactInteraction {
        prompts_enabled: true,
        is_terminal,
        input,
    };
    run_artifact_command_with_interaction(
        command,
        api,
        store,
        &mut interaction,
        output,
        diagnostics,
    )
    .await
}

const PUBLICATION_FIELDS: &[&str] = &[
    "artifactId",
    "versionId",
    "publicationState",
    "expiresAt",
    "url",
    "copyEligible",
];

struct PublicationPresentation<'a> {
    json: Option<&'a str>,
    jq: Option<&'a str>,
    template: Option<&'a str>,
}

struct PublicationOutcome<'a> {
    artifact_id: &'a str,
    version_id: Option<&'a str>,
    access_state: &'a str,
    expires_at: Option<&'a str>,
    url: Option<&'a str>,
}

async fn resolve_owned_artifact(
    requested_id: Option<&str>,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    diagnostics: &mut dyn Write,
    missing_error: ArtifactError,
) -> Result<(String, crate::ArtifactDetail), ArtifactError> {
    if requested_id.is_none() && !is_terminal {
        return Err(missing_error);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let artifact_id = if let Some(id) = requested_id {
        id.to_owned()
    } else {
        select_owned_artifact(api, store, true, true, input, diagnostics)
            .await?
            .id
    };
    let artifact = api.artifact(&token, &artifact_id).await?;
    Ok((token, artifact))
}

fn select_ready_version(
    versions: &[ReadyArtifactVersion],
    is_terminal: bool,
    input: &mut dyn BufRead,
    diagnostics: &mut dyn Write,
) -> Result<ReadyArtifactVersion, ArtifactError> {
    if !is_terminal {
        return Err(ArtifactError::PublishSelectionUnavailable);
    }
    if versions.is_empty() {
        return Err(ArtifactError::NoReadyVersion);
    }
    for (index, version) in versions.iter().enumerate() {
        writeln!(
            diagnostics,
            "{}: Version {} ({})",
            index + 1,
            version.version_number,
            version.id
        )
        .map_err(|_| ArtifactError::Server)?;
    }
    write!(diagnostics, "Select a ready Version: ").map_err(|_| ArtifactError::Server)?;
    diagnostics.flush().map_err(|_| ArtifactError::Server)?;
    let mut choice = String::new();
    input
        .read_line(&mut choice)
        .map_err(|_| ArtifactError::Cancelled)?;
    let index = choice
        .trim()
        .parse::<usize>()
        .ok()
        .and_then(|value| value.checked_sub(1))
        .ok_or(ArtifactError::Cancelled)?;
    versions.get(index).cloned().ok_or(ArtifactError::Cancelled)
}

fn write_publication_result(
    output: &mut dyn Write,
    presentation: &PublicationPresentation<'_>,
    outcome: &PublicationOutcome<'_>,
) -> Result<(), ArtifactError> {
    let value = serde_json::json!({
        "artifactId": outcome.artifact_id,
        "versionId": outcome.version_id,
        "publicationState": outcome.access_state,
        "expiresAt": outcome.expires_at,
        "url": outcome.url,
        "copyEligible": outcome.access_state == "published",
    });
    if let Some(fields) = presentation.json {
        let fields = parse_fields_from(fields, PUBLICATION_FIELDS)?;
        let selected = Value::Object(
            fields
                .into_iter()
                .map(|field| (field.to_owned(), value[field].clone()))
                .collect(),
        );
        if let Some(expression) = presentation.jq {
            write_jq(output, &selected, expression)
        } else if let Some(template) = presentation.template {
            write_template(output, &selected, template)
        } else {
            writeln!(
                output,
                "{}",
                serde_json::to_string_pretty(&selected).map_err(|_| ArtifactError::Server)?
            )
            .map_err(|_| ArtifactError::Server)
        }
    } else {
        let version = outcome
            .version_id
            .map_or_else(String::new, |id| format!(" Version {id}"));
        writeln!(
            output,
            "Artifact {}{version} is {}",
            outcome.artifact_id, outcome.access_state
        )
        .and_then(|()| {
            if let Some(url) = outcome.url {
                writeln!(output, "Share link: {url}")
            } else {
                Ok(())
            }
        })
        .map_err(|_| ArtifactError::Server)
    }
}

/// Publishes one explicit or interactively selected ready Version.
///
/// # Errors
/// Returns an Artifact error for unavailable selection, authentication, formatting, or Server failures.
pub async fn run_artifact_publish(
    args: &ArtifactPublishArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if !is_terminal && (args.artifact.is_none() || args.version.is_none()) {
        return Err(ArtifactError::PublishSelectionUnavailable);
    }
    let (token, artifact) = resolve_owned_artifact(
        args.artifact.as_deref(),
        api,
        store,
        is_terminal,
        input,
        diagnostics,
        ArtifactError::PublishSelectionUnavailable,
    )
    .await?;
    let version_id = if let Some(id) = &args.version {
        id.clone()
    } else {
        let versions = api.list_ready_versions(&token, &artifact.id).await?;
        select_ready_version(&versions, is_terminal, input, diagnostics)?.id
    };
    let expiration_policy = publish_expiration(args, artifact.publication.as_ref())?;
    let publication = api
        .publish(
            &token,
            &artifact.id,
            &version_id,
            &expiration_policy,
            args.replace_link,
            args.confirm_replace_link,
        )
        .await?;
    write_publication_result(
        output,
        &PublicationPresentation {
            json: args.json.as_deref(),
            jq: args.jq.as_deref(),
            template: args.template.as_deref(),
        },
        &PublicationOutcome {
            artifact_id: &artifact.id,
            version_id: Some(&publication.publication.version_id),
            access_state: "published",
            expires_at: publication.publication.expires_at.as_deref(),
            url: Some(&publication.share_link.url),
        },
    )
}

/// Removes the current Publication from one explicit or interactively selected Artifact.
///
/// # Errors
/// Returns an Artifact error for unavailable selection, authentication, formatting, or Server failures.
pub async fn run_artifact_unpublish(
    args: &ArtifactUnpublishArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if !is_terminal && args.artifact.is_none() {
        return Err(ArtifactError::UnpublishSelectionUnavailable);
    }
    let (token, artifact) = resolve_owned_artifact(
        args.artifact.as_deref(),
        api,
        store,
        is_terminal,
        input,
        diagnostics,
        ArtifactError::UnpublishSelectionUnavailable,
    )
    .await?;
    if let Some(publication) = &artifact.publication {
        api.unpublish(&token, &artifact.id, &publication.id).await?;
    }
    write_publication_result(
        output,
        &PublicationPresentation {
            json: args.json.as_deref(),
            jq: args.jq.as_deref(),
            template: args.template.as_deref(),
        },
        &PublicationOutcome {
            artifact_id: &artifact.id,
            version_id: None,
            access_state: "not accessible",
            expires_at: artifact
                .publication
                .as_ref()
                .and_then(|value| value.expires_at.as_deref()),
            url: artifact.share_link.as_ref().map(|link| link.url.as_str()),
        },
    )
}

fn publish_expiration(
    args: &ArtifactPublishArgs,
    previous: Option<&crate::ArtifactPublication>,
) -> Result<ExpirationPolicy, ArtifactError> {
    if let Some(seconds) = args.duration {
        if seconds == 0 {
            return Err(ArtifactError::InvalidPublicationExpiration);
        }
        return Ok(ExpirationPolicy::Duration {
            duration_seconds: seconds,
        });
    }
    if let Some(value) = &args.expires_at {
        let expires_at =
            parse_share_expiration(value)?.ok_or(ArtifactError::InvalidPublicationExpiration)?;
        return Ok(ExpirationPolicy::Exact { expires_at });
    }
    match previous {
        Some(publication) if publication.expiration_kind.as_deref() == Some("duration") => {
            publication
                .duration_seconds
                .map_or(Ok(ExpirationPolicy::Permanent), |duration_seconds| {
                    Ok(ExpirationPolicy::Duration { duration_seconds })
                })
        }
        Some(publication) if publication.expiration_kind.as_deref() == Some("exact") => publication
            .expires_at
            .as_deref()
            .and_then(|value| parse_share_expiration(value).ok().flatten())
            .map_or(Ok(ExpirationPolicy::Permanent), |expires_at| {
                Ok(ExpirationPolicy::Exact { expires_at })
            }),
        _ => Ok(ExpirationPolicy::Permanent),
    }
}

#[must_use]
pub const fn artifact_exit_code(error: &ArtifactError) -> i32 {
    match error {
        ArtifactError::Unauthenticated => 4,
        ArtifactError::Cancelled => 2,
        _ => 1,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadTargetChoice {
    New,
    Existing,
}

/// Prompts for the kind of Upload target when no explicit flag was supplied.
///
/// # Errors
/// Returns an error when prompting is unavailable, cancelled, or output fails.
pub fn select_upload_target(
    prompts_enabled: bool,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
) -> Result<UploadTargetChoice, ArtifactError> {
    if !prompts_enabled || !is_terminal {
        return Err(ArtifactError::SelectionUnavailable);
    }
    writeln!(output, "1: Upload a new Artifact").map_err(|_| ArtifactError::Server)?;
    writeln!(output, "2: Upload a new Version to an existing Artifact")
        .map_err(|_| ArtifactError::Server)?;
    write!(output, "Choose the Upload target: ").map_err(|_| ArtifactError::Server)?;
    output.flush().map_err(|_| ArtifactError::Server)?;
    let mut choice = String::new();
    input
        .read_line(&mut choice)
        .map_err(|_| ArtifactError::Cancelled)?;
    match choice.trim() {
        "1" => Ok(UploadTargetChoice::New),
        "2" => Ok(UploadTargetChoice::Existing),
        _ => Err(ArtifactError::Cancelled),
    }
}

/// Uploads one prepared ZIP and waits for a ready Version.
///
/// # Errors
/// Returns an Artifact error for invalid input, authentication, transfer, or processing failure.
pub async fn run_artifact_upload(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let stdin = std::io::stdin();
    let mut interaction = ArtifactInteraction {
        prompts_enabled: std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_none(),
        is_terminal: stdin.is_terminal(),
        input: &mut stdin.lock(),
    };
    run_artifact_upload_with_interaction(args, api, store, &mut interaction, output, diagnostics)
        .await
        .map(|_| ())
}

/// Uploads an Artifact for the high-level Publish command and returns the exact committed IDs.
///
/// # Errors
/// Returns an Artifact error for invalid input, authentication, transfer, or processing failure.
pub async fn run_artifact_upload_for_publish(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(String, String), ArtifactError> {
    let stdin = std::io::stdin();
    let mut interaction = ArtifactInteraction {
        prompts_enabled: std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_none(),
        is_terminal: stdin.is_terminal(),
        input: &mut stdin.lock(),
    };
    run_artifact_upload_with_interaction(args, api, store, &mut interaction, output, diagnostics)
        .await
}

async fn run_artifact_upload_with_interaction(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    interaction: &mut ArtifactInteraction<'_>,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(String, String), ArtifactError> {
    if args.artifact.is_none()
        && args.name.is_none()
        && (!interaction.prompts_enabled || !interaction.is_terminal)
    {
        return Err(ArtifactError::SelectionUnavailable);
    }
    let direct_entry = if args.paths.len() == 1
        && args.paths[0]
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
    {
        Some(resolve_entry(
            &args.paths[0],
            args.entry.as_deref(),
            interaction.prompts_enabled,
            interaction.is_terminal,
            interaction.input,
            diagnostics,
        )?)
    } else {
        None
    };
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let prepared = package_local_input(args, api, &token, diagnostics).await?;
    let entry = if let Some(entry) = direct_entry {
        entry
    } else {
        resolve_entry(
            &prepared.path,
            args.entry.as_deref(),
            interaction.prompts_enabled,
            interaction.is_terminal,
            interaction.input,
            diagnostics,
        )?
    };
    let (name, artifact_id) = resolve_upload_target(
        args,
        api,
        store,
        &prepared.default_name,
        interaction,
        diagnostics,
    )
    .await?;
    let total = prepared
        .path
        .metadata()
        .map_err(|_| ArtifactError::InvalidZipInput)?
        .len();
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
    let upload = api.upload_artifact(
        &token,
        name.as_deref(),
        artifact_id.as_deref(),
        entry.as_deref(),
        &prepared.path,
        (!args.no_progress).then_some(progress_tx),
    );
    tokio::pin!(upload);
    let accepted = loop {
        tokio::select! {
            result = &mut upload => break result?,
            Some(sent) = progress_rx.recv(), if !args.no_progress => {
                writeln!(diagnostics, "Uploading {sent}/{total} bytes").map_err(|_| ArtifactError::Server)?;
            }
            result = tokio::signal::ctrl_c() => {
                result.map_err(|_| ArtifactError::Server)?;
                return Err(ArtifactError::Cancelled);
            }
        }
    };
    wait_for_ready(args, api, &token, &accepted, output, diagnostics).await
}

async fn package_local_input(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    token: &str,
    diagnostics: &mut dyn Write,
) -> Result<crate::packaging::PreparedUpload, ArtifactError> {
    let policy = api.upload_policy(token).await?;
    let paths = args.paths.clone();
    let root = args.root.clone();
    let (packaging_tx, mut packaging_rx) = tokio::sync::mpsc::unbounded_channel();
    let packaging = tokio::task::spawn_blocking(move || {
        prepare_upload_with_progress(&paths, root.as_deref(), &policy, |bytes| {
            let _ = packaging_tx.send(bytes);
        })
    });
    tokio::pin!(packaging);
    let prepared = tokio::select! {
        result = &mut packaging => result.map_err(|_| ArtifactError::Server)??,
        Some(bytes) = packaging_rx.recv(), if !args.no_progress => {
            writeln!(diagnostics, "Packaging {bytes} bytes").map_err(|_| ArtifactError::Server)?;
            loop {
                tokio::select! {
                    result = &mut packaging => break result.map_err(|_| ArtifactError::Server)??,
                    Some(bytes) = packaging_rx.recv() => {
                        writeln!(diagnostics, "Packaging {bytes} bytes").map_err(|_| ArtifactError::Server)?;
                    }
                    result = tokio::signal::ctrl_c() => {
                        result.map_err(|_| ArtifactError::Server)?;
                        return Err(ArtifactError::Cancelled);
                    }
                }
            }
        },
        result = tokio::signal::ctrl_c() => {
            result.map_err(|_| ArtifactError::Server)?;
            return Err(ArtifactError::Cancelled);
        }
    };
    Ok(prepared)
}

fn resolve_entry(
    path: &std::path::Path,
    requested: Option<&str>,
    prompts_enabled: bool,
    is_terminal: bool,
    input: &mut dyn BufRead,
    diagnostics: &mut dyn Write,
) -> Result<Option<String>, ArtifactError> {
    let file = File::open(path).map_err(|_| ArtifactError::InvalidZipInput)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| ArtifactError::InvalidZipInput)?;
    let mut html = Vec::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| ArtifactError::InvalidZipInput)?;
        if !entry.is_dir()
            && entry
                .name()
                .split('/')
                .next_back()
                .is_some_and(|name| name.to_ascii_lowercase().ends_with(".html"))
        {
            html.push(entry.name().to_owned());
        }
    }
    let entry = if let Some(requested) = requested {
        if !html.iter().any(|value| value == requested) {
            return Err(ArtifactError::InvalidEntry);
        }
        Some(requested.to_owned())
    } else if html.iter().any(|value| value == "index.html") {
        Some("index.html".to_owned())
    } else {
        let roots = html
            .iter()
            .filter(|value| !value.contains('/'))
            .cloned()
            .collect::<Vec<_>>();
        match roots.as_slice() {
            [only] => Some(only.clone()),
            [] => return Err(ArtifactError::InvalidEntry),
            _ if prompts_enabled && is_terminal => {
                for (index, candidate) in roots.iter().enumerate() {
                    writeln!(diagnostics, "{}: {}", index + 1, candidate)
                        .map_err(|_| ArtifactError::Server)?;
                }
                write!(diagnostics, "Select the Entry file: ")
                    .map_err(|_| ArtifactError::Server)?;
                diagnostics.flush().map_err(|_| ArtifactError::Server)?;
                let mut choice = String::new();
                input
                    .read_line(&mut choice)
                    .map_err(|_| ArtifactError::Cancelled)?;
                let index = choice
                    .trim()
                    .parse::<usize>()
                    .ok()
                    .and_then(|v| v.checked_sub(1))
                    .ok_or(ArtifactError::Cancelled)?;
                Some(roots.get(index).cloned().ok_or(ArtifactError::Cancelled)?)
            }
            _ => return Err(ArtifactError::AmbiguousEntry),
        }
    };
    Ok(entry)
}

async fn resolve_upload_target(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    default_name: &str,
    interaction: &mut ArtifactInteraction<'_>,
    diagnostics: &mut dyn Write,
) -> Result<(Option<String>, Option<String>), ArtifactError> {
    let mut artifact_id = args.artifact.clone();
    let mut name = args.name.clone();
    if artifact_id.is_none() && name.is_none() {
        if !interaction.prompts_enabled || !interaction.is_terminal {
            return Err(ArtifactError::SelectionUnavailable);
        }
        let target = select_upload_target(
            interaction.prompts_enabled,
            interaction.is_terminal,
            interaction.input,
            diagnostics,
        )?;
        match target {
            UploadTargetChoice::New => name = Some(default_name.to_owned()),
            UploadTargetChoice::Existing => {
                let selected = select_owned_artifact(
                    api,
                    store,
                    interaction.prompts_enabled,
                    interaction.is_terminal,
                    interaction.input,
                    diagnostics,
                )
                .await?;
                artifact_id = Some(selected.id);
            }
        }
    }
    if artifact_id.is_none() {
        name = Some(
            name.unwrap_or_else(|| default_name.to_owned())
                .trim()
                .to_owned(),
        );
        if name.as_deref().is_none_or(str::is_empty) {
            return Err(ArtifactError::InvalidZipInput);
        }
    }
    Ok((name, artifact_id))
}

async fn wait_for_ready(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    token: &str,
    accepted: &crate::ArtifactAccepted,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(String, String), ArtifactError> {
    let mut activity = 0_usize;
    loop {
        if !args.no_progress {
            const FRAMES: [&str; 4] = ["|", "/", "-", "\\"];
            write!(
                diagnostics,
                "\rProcessing {}",
                FRAMES[activity % FRAMES.len()]
            )
            .map_err(|_| ArtifactError::Server)?;
            diagnostics.flush().map_err(|_| ArtifactError::Server)?;
            activity += 1;
        }
        let state = tokio::select! {
            result = api.artifact_state(token, &accepted.artifact_id) => match result {
                Ok(state) => state,
                Err(error) => {
                    writeln!(
                        diagnostics,
                        "Upload session {} was accepted for Artifact {}, but its result could not be confirmed. Inspect the Artifact before retrying with --artifact {}.",
                        accepted.upload_session_id,
                        accepted.artifact_id,
                        accepted.artifact_id
                    ).map_err(|_| ArtifactError::Server)?;
                    return Err(error);
                }
            },
            result = tokio::signal::ctrl_c() => {
                result.map_err(|_| ArtifactError::Server)?;
                writeln!(
                    diagnostics,
                    "Upload session {} was accepted for Artifact {}; Server processing continues. Inspect the Artifact or retry with --artifact {}.",
                    accepted.upload_session_id,
                    accepted.artifact_id,
                    accepted.artifact_id
                ).map_err(|_| ArtifactError::Server)?;
                return Err(ArtifactError::Cancelled);
            }
        };
        if state.processing_state == "ready"
            && let Some(version) = state.ready_version
        {
            if !args.no_progress {
                writeln!(diagnostics, "\rProcessing ready").map_err(|_| ArtifactError::Server)?;
            }
            write_upload_result(
                args,
                output,
                &accepted.artifact_id,
                &state.name,
                &version.id,
                state.publication.as_ref(),
            )?;
            return Ok((accepted.artifact_id.clone(), version.id));
        }
        if state.processing_state == "failed" {
            let failure = state.failure.map_or_else(
                || "unknown failure".to_owned(),
                |v| format!("{}: {}", v.code, v.message),
            );
            writeln!(
                diagnostics,
                "Upload session {} failed for Artifact {}. Inspect the Artifact or retry explicitly with --artifact {}.",
                accepted.upload_session_id,
                accepted.artifact_id,
                accepted.artifact_id
            )
            .map_err(|_| ArtifactError::Server)?;
            return Err(ArtifactError::ProcessingFailed(failure));
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

fn write_upload_result(
    args: &ArtifactUploadArgs,
    output: &mut dyn Write,
    artifact_id: &str,
    artifact_name: &str,
    version_id: &str,
    publication: Option<&crate::ArtifactPublication>,
) -> Result<(), ArtifactError> {
    let value = serde_json::json!({
        "artifact": { "id": artifact_id, "name": artifact_name },
        "version": { "id": version_id, "state": "ready" },
        "publication": publication
    });
    if let Some(fields) = &args.json {
        let fields = parse_fields_from(fields, UPLOAD_FIELDS)?;
        let selected = Value::Object(
            fields
                .into_iter()
                .map(|field| (field.to_owned(), value[field].clone()))
                .collect(),
        );
        if let Some(expression) = &args.jq {
            write_jq(output, &selected, expression)
        } else if let Some(template) = &args.template {
            write_template(output, &selected, template)
        } else {
            writeln!(
                output,
                "{}",
                serde_json::to_string_pretty(&selected).map_err(|_| ArtifactError::Server)?
            )
            .map_err(|_| ArtifactError::Server)
        }
    } else {
        writeln!(
            output,
            "Artifact {artifact_id} uploaded as Version {version_id}"
        )
        .map_err(|_| ArtifactError::Server)
    }
}

/// Lists owned Artifacts and writes the requested presentation to stdout.
///
/// # Errors
/// Returns [`ArtifactError`] when credentials, the Server request, or formatting fails.
pub async fn run_artifact_list(
    args: &ArtifactListArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let artifacts = api
        .list_artifacts(&token, args.publication, args.processing, args.limit)
        .await?;
    if let Some(fields) = &args.json {
        let fields = parse_fields(fields)?;
        let selected = artifacts
            .iter()
            .map(|artifact| select(artifact, &fields))
            .collect::<Vec<_>>();
        if let Some(expression) = &args.jq {
            write_jq(output, &Value::Array(selected), expression)?;
        } else if let Some(template) = &args.template {
            write_template(output, &Value::Array(selected), template)?;
        } else {
            writeln!(
                output,
                "{}",
                serde_json::to_string_pretty(&selected).map_err(|_| ArtifactError::Server)?
            )
            .map_err(|_| ArtifactError::Server)?;
        }
        return Ok(());
    }
    writeln!(
        output,
        "ID\tNAME\tPROCESSING\tPUBLICATION\tEXPIRES\tUPDATED"
    )
    .map_err(|_| ArtifactError::Server)?;
    for artifact in artifacts {
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}\t{}",
            artifact.id,
            artifact.name,
            artifact.processing_state,
            publication_state(&artifact),
            artifact
                .publication
                .as_ref()
                .and_then(|value| value.expires_at.as_deref())
                .unwrap_or("never"),
            artifact.updated_at
        )
        .map_err(|_| ArtifactError::Server)?;
    }
    Ok(())
}

/// Selects one Artifact from an already bounded list without consulting local-directory state.
///
/// # Errors
/// Returns an error when prompting is unavailable, cancelled, or output fails.
pub fn select_artifact(
    artifacts: &[Artifact],
    prompts_enabled: bool,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
) -> Result<Artifact, ArtifactError> {
    if !prompts_enabled || !is_terminal {
        return Err(ArtifactError::SelectionUnavailable);
    }
    for (index, artifact) in artifacts.iter().enumerate() {
        writeln!(output, "{}: {} ({})", index + 1, artifact.name, artifact.id)
            .map_err(|_| ArtifactError::Server)?;
    }
    write!(output, "Select an Artifact: ").map_err(|_| ArtifactError::Server)?;
    let mut choice = String::new();
    input
        .read_line(&mut choice)
        .map_err(|_| ArtifactError::Cancelled)?;
    let index = choice
        .trim()
        .parse::<usize>()
        .ok()
        .and_then(|value| value.checked_sub(1))
        .ok_or(ArtifactError::Cancelled)?;
    artifacts
        .get(index)
        .cloned()
        .ok_or(ArtifactError::Cancelled)
}

/// Loads a bounded owned-Artifact page and prompts for one selection.
///
/// # Errors
/// Returns an error when credentials, listing, or interactive selection fails.
pub async fn select_owned_artifact(
    api: &ApiClient,
    store: &dyn CredentialStore,
    prompts_enabled: bool,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
) -> Result<Artifact, ArtifactError> {
    if !prompts_enabled || !is_terminal {
        return Err(ArtifactError::SelectionUnavailable);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let artifacts = api.list_artifacts(&token, None, None, 30).await?;
    select_artifact(&artifacts, true, true, input, output)
}

fn parse_fields(value: &str) -> Result<Vec<&str>, ArtifactError> {
    parse_fields_from(value, FIELDS)
}

fn parse_fields_from<'a>(value: &'a str, allowed: &[&str]) -> Result<Vec<&'a str>, ArtifactError> {
    let fields = value.split(',').collect::<Vec<_>>();
    for field in &fields {
        if !allowed.contains(field) {
            return Err(ArtifactError::UnsupportedField((*field).to_owned()));
        }
    }
    Ok(fields)
}

fn publication_state(artifact: &Artifact) -> &'static str {
    publication_status(&artifact.publication_status)
}

fn field(artifact: &Artifact, name: &str) -> Value {
    match name {
        "id" => artifact.id.clone().into(),
        "name" => artifact.name.clone().into(),
        "processingState" => artifact.processing_state.clone().into(),
        "publicationState" => publication_state(artifact).into(),
        "expiresAt" => artifact
            .publication
            .as_ref()
            .and_then(|value| value.expires_at.clone())
            .clone()
            .map_or(Value::Null, Value::String),
        "updatedAt" => artifact.updated_at.clone().into(),
        _ => unreachable!("validated field"),
    }
}

fn select(artifact: &Artifact, fields: &[&str]) -> Value {
    Value::Object(
        fields
            .iter()
            .map(|name| ((*name).to_owned(), field(artifact, name)))
            .collect::<Map<_, _>>(),
    )
}

fn write_jq(output: &mut dyn Write, value: &Value, expression: &str) -> Result<(), ArtifactError> {
    use jaq_interpret::{Ctx, FilterT, ParseCtx, RcIter, Val};
    let (parsed, parse_errors) = jaq_parse::parse(expression, jaq_parse::main());
    if !parse_errors.is_empty() {
        return Err(ArtifactError::InvalidJq);
    }
    let mut definitions = ParseCtx::new(Vec::new());
    let filter = definitions.compile(parsed.ok_or(ArtifactError::InvalidJq)?);
    if !definitions.errs.is_empty() {
        return Err(ArtifactError::InvalidJq);
    }
    let inputs = RcIter::new(core::iter::empty());
    for result in filter.run((Ctx::new([], &inputs), Val::from(value.clone()))) {
        let value = Value::from(result.map_err(|_| ArtifactError::InvalidJq)?);
        match value {
            Value::String(text) => writeln!(output, "{text}"),
            _ => writeln!(output, "{value}"),
        }
        .map_err(|_| ArtifactError::Server)?;
    }
    Ok(())
}

fn write_template(
    output: &mut dyn Write,
    value: &Value,
    template: &str,
) -> Result<(), ArtifactError> {
    let context = go_value(value);
    let rendered =
        gtmpl::template(template, context).map_err(|_| ArtifactError::InvalidTemplate)?;
    write!(output, "{rendered}").map_err(|_| ArtifactError::Server)?;
    Ok(())
}

fn go_value(value: &Value) -> gtmpl::Value {
    match value {
        Value::Null => gtmpl::Value::Nil,
        Value::Bool(value) => (*value).into(),
        Value::Number(value) => value.as_i64().map_or(gtmpl::Value::Nil, Into::into),
        Value::String(value) => value.clone().into(),
        Value::Array(values) => gtmpl::Value::Array(values.iter().map(go_value).collect()),
        Value::Object(values) => gtmpl::Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), go_value(value)))
                .collect::<HashMap<_, _>>(),
        ),
    }
}
