// cspell:ignore gtmpl
use crate::{ApiClient, Artifact, ArtifactError, ArtifactListArgs, CredentialStore};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};

const FIELDS: &[&str] = &[
    "id",
    "name",
    "processingState",
    "publicationState",
    "expiresAt",
    "updatedAt",
];

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
