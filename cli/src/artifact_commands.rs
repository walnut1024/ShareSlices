// cspell:ignore gtmpl
use crate::packaging::prepare_upload;
use crate::{
    ApiClient, Artifact, ArtifactCommand, ArtifactError, ArtifactListArgs, ArtifactPublishArgs,
    ArtifactUnpublishArgs, ArtifactUploadArgs, CredentialStore, ReadyVersionSummary,
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
const PUBLICATION_FIELDS: &[&str] = &["artifact", "version", "publication", "access"];

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
    match command {
        ArtifactCommand::List(args) => run_artifact_list(&args, api, store, output).await,
        ArtifactCommand::Upload(args) => {
            run_artifact_upload(&args, api, store, output, diagnostics).await
        }
        ArtifactCommand::Publish(args) => {
            run_artifact_publish(&args, api, store, output, diagnostics).await
        }
        ArtifactCommand::Unpublish(args) => {
            run_artifact_unpublish(&args, api, store, output, diagnostics).await
        }
    }
}

fn prompts_available() -> bool {
    std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_none() && std::io::stdin().is_terminal()
}

async fn resolve_artifact_id(
    explicit: Option<&str>,
    api: &ApiClient,
    store: &dyn CredentialStore,
    diagnostics: &mut dyn Write,
) -> Result<String, ArtifactError> {
    if let Some(id) = explicit.filter(|id| !id.trim().is_empty()) {
        return Ok(id.to_owned());
    }
    if !prompts_available() {
        return Err(ArtifactError::SelectionUnavailable);
    }
    select_owned_artifact(
        api,
        store,
        true,
        true,
        &mut std::io::stdin().lock(),
        diagnostics,
    )
    .await
    .map(|artifact| artifact.id)
}

/// Selects one ready Version from a bounded Server-provided collection.
///
/// # Errors
/// Returns an error when prompting is unavailable, cancelled, or output fails.
pub fn select_ready_version(
    versions: &[ReadyVersionSummary],
    prompts_enabled: bool,
    is_terminal: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
) -> Result<ReadyVersionSummary, ArtifactError> {
    if !prompts_enabled || !is_terminal {
        return Err(ArtifactError::SelectionUnavailable);
    }
    for (index, version) in versions.iter().enumerate() {
        writeln!(
            output,
            "{}: Version {} ({}, {})",
            index + 1,
            version.version_number,
            version.id,
            version.created_at
        )
        .map_err(|_| ArtifactError::Server)?;
    }
    write!(output, "Select a ready Version: ").map_err(|_| ArtifactError::Server)?;
    output.flush().map_err(|_| ArtifactError::Server)?;
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
#[allow(clippy::too_many_lines)]
pub async fn run_artifact_upload(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    if args.artifact.is_none()
        && args.name.is_none()
        && (std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_some()
            || !std::io::stdin().is_terminal())
    {
        return Err(ArtifactError::SelectionUnavailable);
    }
    let policy = api.upload_policy(&token).await?;
    let paths = args.paths.clone();
    let root = args.root.clone();
    let packaging =
        tokio::task::spawn_blocking(move || prepare_upload(&paths, root.as_deref(), &policy));
    let prepared = tokio::select! {
        result = packaging => result.map_err(|_| ArtifactError::Server)??,
        result = tokio::signal::ctrl_c() => {
            result.map_err(|_| ArtifactError::Server)?;
            return Err(ArtifactError::Cancelled);
        }
    };
    let file = File::open(&prepared.path).map_err(|_| ArtifactError::InvalidZipInput)?;
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
    let entry = if let Some(requested) = &args.entry {
        if !html.iter().any(|value| value == requested) {
            return Err(ArtifactError::InvalidEntry);
        }
        Some(requested.clone())
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
            _ if std::io::stdin().is_terminal() => {
                for (index, candidate) in roots.iter().enumerate() {
                    writeln!(diagnostics, "{}: {}", index + 1, candidate)
                        .map_err(|_| ArtifactError::Server)?;
                }
                write!(diagnostics, "Select the Entry file: ")
                    .map_err(|_| ArtifactError::Server)?;
                diagnostics.flush().map_err(|_| ArtifactError::Server)?;
                let mut choice = String::new();
                std::io::stdin()
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
    let mut artifact_id = args.artifact.clone();
    let mut name = args.name.clone();
    if artifact_id.is_none() && name.is_none() {
        if std::env::var_os("SHARESLICES_PROMPT_DISABLED").is_some()
            || !std::io::stdin().is_terminal()
        {
            return Err(ArtifactError::SelectionUnavailable);
        }
        let target = select_upload_target(true, true, &mut std::io::stdin().lock(), diagnostics)?;
        match target {
            UploadTargetChoice::New => name = Some(prepared.default_name.clone()),
            UploadTargetChoice::Existing => {
                let selected = select_owned_artifact(
                    api,
                    store,
                    true,
                    true,
                    &mut std::io::stdin().lock(),
                    diagnostics,
                )
                .await?;
                artifact_id = Some(selected.id);
            }
        }
    }
    if artifact_id.is_none() {
        name = Some(
            name.unwrap_or_else(|| prepared.default_name.clone())
                .trim()
                .to_owned(),
        );
        if name.as_deref().is_none_or(str::is_empty) {
            return Err(ArtifactError::InvalidZipInput);
        }
    }
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
            result = api.artifact_state(&token, &accepted.artifact_id) => result?,
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
            return write_upload_result(
                args,
                output,
                &accepted.artifact_id,
                &state.name,
                &version.id,
            );
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
) -> Result<(), ArtifactError> {
    let value = serde_json::json!({
        "artifact": { "id": artifact_id, "name": artifact_name },
        "version": { "id": version_id, "state": "ready" },
        "publication": null
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

/// Publishes one explicit ready Version and reports the resulting external-access state.
///
/// # Errors
/// Returns an Artifact error for missing identifiers, selection, authentication, or Server failure.
pub async fn run_artifact_publish(
    args: &ArtifactPublishArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if (!prompts_available()) && (args.artifact.is_none() || args.version.is_none()) {
        return Err(ArtifactError::SelectionUnavailable);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let artifact_id =
        resolve_artifact_id(args.artifact.as_deref(), api, store, diagnostics).await?;
    let version_id =
        if let Some(version) = args.version.as_deref().filter(|id| !id.trim().is_empty()) {
            version.to_owned()
        } else {
            let versions = api.list_ready_versions(&token, &artifact_id).await?;
            select_ready_version(
                &versions,
                true,
                true,
                &mut std::io::stdin().lock(),
                diagnostics,
            )?
            .id
        };
    api.publish_version(&token, &artifact_id, &version_id)
        .await?;
    let state = api.artifact_state(&token, &artifact_id).await?;
    write_publication_result(
        output,
        args.json.as_deref(),
        args.jq.as_deref(),
        args.template.as_deref(),
        &artifact_id,
        Some(&version_id),
        &state,
    )
}

/// Ends the current Publication without changing the stable Share link.
///
/// # Errors
/// Returns an Artifact error for missing identifiers, selection, authentication, or Server failure.
pub async fn run_artifact_unpublish(
    args: &ArtifactUnpublishArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    if !prompts_available() && args.artifact.is_none() {
        return Err(ArtifactError::SelectionUnavailable);
    }
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let artifact_id =
        resolve_artifact_id(args.artifact.as_deref(), api, store, diagnostics).await?;
    let before = api.artifact_state(&token, &artifact_id).await?;
    if let Some(publication) = before.publication.as_ref() {
        api.unpublish(&token, &artifact_id, &publication.id).await?;
    }
    let state = api.artifact_state(&token, &artifact_id).await?;
    write_publication_result(
        output,
        args.json.as_deref(),
        args.jq.as_deref(),
        args.template.as_deref(),
        &artifact_id,
        None,
        &state,
    )
}

fn write_publication_result(
    output: &mut dyn Write,
    json: Option<&str>,
    jq: Option<&str>,
    template: Option<&str>,
    artifact_id: &str,
    version_id: Option<&str>,
    state: &crate::ArtifactState,
) -> Result<(), ArtifactError> {
    let access_state = if state.publication.is_none() {
        "unpublished"
    } else if state
        .share_link
        .as_ref()
        .is_some_and(|link| link.state == "expired")
    {
        "expired"
    } else {
        "published"
    };
    let value = serde_json::json!({
        "artifact": { "id": artifact_id, "name": state.name },
        "version": version_id.map(|id| serde_json::json!({ "id": id, "state": "ready" })),
        "publication": state.publication,
        "access": {
            "state": access_state,
            "url": state.share_link.as_ref().map(|link| &link.url),
            "expiresAt": state.share_link.as_ref().and_then(|link| link.expires_at.as_ref())
        }
    });
    if let Some(fields) = json {
        let fields = parse_fields_from(fields, PUBLICATION_FIELDS)?;
        let selected = Value::Object(
            fields
                .into_iter()
                .map(|field| (field.to_owned(), value[field].clone()))
                .collect(),
        );
        if let Some(expression) = jq {
            write_jq(output, &selected, expression)
        } else if let Some(template) = template {
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
        writeln!(output, "Artifact {artifact_id} is {access_state}.")
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
            artifact.share_link.expires_at.as_deref().unwrap_or("never"),
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
    if artifact.publication.is_some() {
        "published"
    } else {
        "unpublished"
    }
}

fn field(artifact: &Artifact, name: &str) -> Value {
    match name {
        "id" => artifact.id.clone().into(),
        "name" => artifact.name.clone().into(),
        "processingState" => artifact.processing_state.clone().into(),
        "publicationState" => publication_state(artifact).into(),
        "expiresAt" => artifact
            .share_link
            .expires_at
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
