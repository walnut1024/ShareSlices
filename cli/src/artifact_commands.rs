// cspell:ignore gtmpl
use crate::packaging::prepare_upload;
use crate::{
    ApiClient, Artifact, ArtifactCommand, ArtifactError, ArtifactListArgs, ArtifactUploadArgs,
    CredentialStore,
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
        ArtifactCommand::Upload(args) => {
            run_artifact_upload_with_interaction(
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
}

async fn run_artifact_upload_with_interaction(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    store: &dyn CredentialStore,
    interaction: &mut ArtifactInteraction<'_>,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Result<(), ArtifactError> {
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    if args.artifact.is_none()
        && args.name.is_none()
        && (!interaction.prompts_enabled || !interaction.is_terminal)
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
    let entry = resolve_entry(
        &prepared.path,
        args.entry.as_deref(),
        interaction.prompts_enabled,
        interaction.is_terminal,
        interaction.input,
        diagnostics,
    )?;
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
) -> Result<(), ArtifactError> {
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
            return write_upload_result(
                args,
                output,
                &accepted.artifact_id,
                &state.name,
                &version.id,
                state.publication.as_ref(),
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
