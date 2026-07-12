// cspell:ignore gtmpl
use crate::packaging::prepare_upload;
use crate::{
    ApiClient, Artifact, ArtifactError, ArtifactListArgs, ArtifactUploadArgs, CredentialStore,
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
    if !args.no_progress {
        writeln!(diagnostics, "Processing...").map_err(|_| ArtifactError::Server)?;
    }
    loop {
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
        if let Some(version) = state.ready_version {
            writeln!(
                output,
                "Artifact {} uploaded as Version {}",
                accepted.artifact_id, version.id
            )
            .map_err(|_| ArtifactError::Server)?;
            return Ok(());
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
            write_jq(output, &selected, expression)?;
        } else if let Some(template) = &args.template {
            write_template(output, &selected, template)?;
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
    let fields = value.split(',').collect::<Vec<_>>();
    for field in &fields {
        if !FIELDS.contains(field) {
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

fn write_jq(
    output: &mut dyn Write,
    values: &[Value],
    expression: &str,
) -> Result<(), ArtifactError> {
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
    for result in filter.run((
        Ctx::new([], &inputs),
        Val::from(Value::Array(values.to_vec())),
    )) {
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
    values: &[Value],
    template: &str,
) -> Result<(), ArtifactError> {
    let context = gtmpl::Value::Array(values.iter().map(go_value).collect());
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
