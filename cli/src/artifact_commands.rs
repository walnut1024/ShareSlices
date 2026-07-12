// cspell:ignore gtmpl
use crate::packaging::prepare_upload_with_progress;
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

struct PreparedZip {
    name: String,
    entry: String,
    total_bytes: u64,
}

fn inspect_prepared_zip(
    path: &std::path::Path,
    requested_name: Option<&str>,
    requested_entry: Option<&str>,
    default_name: &str,
    diagnostics: &mut dyn Write,
) -> Result<PreparedZip, ArtifactError> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("zip"))
    {
        return Err(ArtifactError::InvalidZipInput);
    }
    let file = File::open(path).map_err(|_| ArtifactError::InvalidZipInput)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| ArtifactError::InvalidZipInput)?;
    let mut html_entry_paths = Vec::new();
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
            html_entry_paths.push(entry.name().to_owned());
        }
    }
    let entry = if let Some(requested) = requested_entry {
        html_entry_paths
            .iter()
            .any(|value| value == requested)
            .then(|| requested.to_owned())
            .ok_or(ArtifactError::InvalidEntry)?
    } else if html_entry_paths.iter().any(|value| value == "index.html") {
        "index.html".to_owned()
    } else {
        let root_entry_candidates = html_entry_paths
            .iter()
            .filter(|value| !value.contains('/'))
            .cloned()
            .collect::<Vec<_>>();
        match root_entry_candidates.as_slice() {
            [only] => only.clone(),
            [] => return Err(ArtifactError::InvalidEntry),
            _ if std::io::stdin().is_terminal() => {
                for (index, candidate) in root_entry_candidates.iter().enumerate() {
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
                    .and_then(|value| value.checked_sub(1))
                    .ok_or(ArtifactError::Cancelled)?;
                root_entry_candidates
                    .get(index)
                    .cloned()
                    .ok_or(ArtifactError::Cancelled)?
            }
            _ => return Err(ArtifactError::AmbiguousEntry),
        }
    };
    let name = requested_name
        .map(str::to_owned)
        .or_else(|| Some(default_name.to_owned()))
        .filter(|value| !value.trim().is_empty())
        .ok_or(ArtifactError::InvalidZipInput)?;
    let total_bytes = path
        .metadata()
        .map_err(|_| ArtifactError::InvalidZipInput)?
        .len();
    Ok(PreparedZip {
        name,
        entry,
        total_bytes,
    })
}

async fn prepare_local_upload(
    args: &ArtifactUploadArgs,
    api: &ApiClient,
    token: &str,
    inspected: Option<PreparedZip>,
    diagnostics: &mut dyn Write,
) -> Result<(crate::packaging::PreparedUpload, PreparedZip), ArtifactError> {
    let policy = api.upload_policy(token).await?;
    let paths = args.paths.clone();
    let root = args.root.clone();
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
    let packaging = tokio::task::spawn_blocking(move || {
        prepare_upload_with_progress(&paths, root.as_deref(), &policy, |bytes| {
            let _ = progress_tx.send(bytes);
        })
    });
    tokio::pin!(packaging);
    let upload = loop {
        tokio::select! {
            result = &mut packaging => break result.map_err(|_| ArtifactError::Server)??,
            Some(bytes) = progress_rx.recv(), if !args.no_progress => {
                writeln!(diagnostics, "Packaging {bytes} bytes")
                    .map_err(|_| ArtifactError::Server)?;
            }
            result = tokio::signal::ctrl_c() => {
                result.map_err(|_| ArtifactError::Server)?;
                return Err(ArtifactError::Cancelled);
            }
        }
    };
    let prepared = if let Some(inspected) = inspected {
        inspected
    } else {
        inspect_prepared_zip(
            &upload.path,
            args.name.as_deref(),
            args.entry.as_deref(),
            &upload.default_name,
            diagnostics,
        )?
    };
    Ok((upload, prepared))
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
    let inspected = if args.paths.len() == 1
        && args.paths[0]
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"))
    {
        let default_name = args.paths[0]
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or(ArtifactError::InvalidZipInput)?;
        Some(inspect_prepared_zip(
            &args.paths[0],
            args.name.as_deref(),
            args.entry.as_deref(),
            default_name,
            diagnostics,
        )?)
    } else {
        None
    };
    let token = store
        .get()
        .map_err(|_| ArtifactError::Unauthenticated)?
        .ok_or(ArtifactError::Unauthenticated)?;
    let (upload, prepared) =
        prepare_local_upload(args, api, &token, inspected, diagnostics).await?;
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
    let transfer = api.upload_artifact(
        &token,
        &prepared.name,
        Some(&prepared.entry),
        &upload.path,
        (!args.no_progress).then_some(progress_tx),
    );
    tokio::pin!(transfer);
    let accepted = loop {
        tokio::select! {
            result = &mut transfer => break result?,
            result = tokio::signal::ctrl_c() => {
                result.map_err(|_| ArtifactError::Server)?;
                return Err(ArtifactError::Cancelled);
            }
            Some(sent) = progress_rx.recv(), if !args.no_progress => {
                writeln!(diagnostics, "Uploading {sent}/{} bytes", prepared.total_bytes).map_err(|_| ArtifactError::Server)?;
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
                return Err(ArtifactError::Cancelled);
            }
        };
        if let Some(version) = state.ready_version {
            if !args.no_progress {
                writeln!(diagnostics, "\rProcessing ready").map_err(|_| ArtifactError::Server)?;
            }
            return write_upload_result(
                args,
                output,
                &accepted.artifact_id,
                &prepared.name,
                &version.id,
            );
        }
        if state.processing_state == "failed" {
            let failure = state.failure.map_or_else(
                || "unknown failure".to_owned(),
                |v| format!("{}: {}", v.code, v.message),
            );
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

fn parse_fields_from<'a>(
    value: &'a str,
    supported: &[&str],
) -> Result<Vec<&'a str>, ArtifactError> {
    let fields = value.split(',').collect::<Vec<_>>();
    for field in &fields {
        if !supported.contains(field) {
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
