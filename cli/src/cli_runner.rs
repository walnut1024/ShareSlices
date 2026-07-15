use crate::{
    AgentActionKind, AgentContinuation, AgentEnvelope, AgentError, AgentNextAction, AgentOutcome,
    ApiClient, ArtifactCommand, ArtifactError, ArtifactInteraction, ArtifactPublicationCommand,
    ArtifactPublishArgs, ArtifactUploadArgs, AuthApi, AuthCommand, AuthContinuationRecord,
    AuthContinuationStore, AuthError, Cli, Command, CredentialStore, FileAuthContinuationStore,
    agent_capabilities, artifact_exit_code, failed_agent_envelope, format_timestamp,
    run_artifact_command, run_artifact_command_with_interaction, run_artifact_upload_for_publish,
    run_auth, unix_now,
};
use clap::Parser as _;
use std::ffi::OsString;
use std::hash::{Hash as _, Hasher as _};
use std::io::Write;

/// Parses and executes one CLI process with an injected credential-store factory.
///
/// The shipping binary supplies the operating-system credential store. Process tests can inject a
/// deterministic store while exercising the same parser, dispatcher, diagnostics, and exit-code
/// mapping.
#[allow(clippy::too_many_lines)]
pub async fn run_cli_process<I, T, F, S>(
    arguments: I,
    store_factory: F,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
    F: FnOnce(&str) -> Result<S, AuthError>,
    S: CredentialStore,
{
    let arguments = arguments
        .into_iter()
        .map(Into::into)
        .collect::<Vec<OsString>>();
    let agent_requested = arguments.iter().any(|value| value == "--agent");
    let cli = match Cli::try_parse_from(arguments.clone()) {
        Ok(cli) => cli,
        Err(error) => {
            if agent_requested {
                let operation = infer_agent_operation(&arguments);
                let replace_unconfirmed = arguments.iter().any(|value| value == "--replace-link")
                    && !arguments
                        .iter()
                        .any(|value| value == "--confirm-replace-link");
                let presentation_conflict = arguments
                    .iter()
                    .any(|value| matches!(value.to_str(), Some("--json" | "--jq" | "--template")));
                let mut envelope = if replace_unconfirmed {
                    AgentEnvelope::new(operation, AgentOutcome::ActionRequired)
                } else if presentation_conflict {
                    failed_agent_envelope(
                        operation,
                        "presentation_conflict",
                        "Agent mode cannot be combined with --json, --jq, or --template.",
                        serde_json::json!({}),
                    )
                } else {
                    failed_agent_envelope(
                        operation,
                        "invalid_invocation",
                        "The Agent invocation is invalid.",
                        serde_json::json!({ "usage": error.to_string() }),
                    )
                };
                if replace_unconfirmed {
                    envelope.error = Some(agent_error(
                        "confirmation_required",
                        "Share-link replacement requires current irreversible confirmation.",
                    ));
                    envelope.next_action = Some(AgentNextAction { kind: AgentActionKind::ConfirmIrreversible, instruction: "Confirm that replacing the Share link permanently invalidates the previous link, then pass --confirm-replace-link.".to_owned(), parameters: None });
                }
                let code = envelope.outcome.exit_code();
                let _ = serde_json::to_writer(&mut *output, &envelope);
                let _ = writeln!(output);
                return code;
            }
            let code = error.exit_code();
            if error.use_stderr() {
                let _ = write!(diagnostics, "{error}");
            } else {
                let _ = write!(output, "{error}");
            }
            return code;
        }
    };
    if let Some(code) = handle_capabilities(&cli, output, diagnostics) {
        return code;
    }
    if let Some(code) = validate_agent(&cli, output) {
        return code;
    }
    let api = match ApiClient::new(&cli.api_url) {
        Ok(api) => api,
        Err(error) => return write_auth_error(&error, diagnostics),
    };
    let store = match store_factory(&cli.api_url) {
        Ok(store) => store,
        Err(error) => return write_auth_error(&error, diagnostics),
    };
    if cli.agent {
        return run_agent_command(cli.command, &cli.api_url, &api, &store, output).await;
    }
    let result = match cli.command {
        Command::Publish(args) => {
            async {
                let upload = ArtifactUploadArgs {
                    agent_mode: false,
                    paths: args.paths,
                    root: args.root,
                    name: Some(args.name.clone()),
                    artifact: None,
                    entry: args.entry,
                    no_progress: args.no_progress,
                    json: None,
                    jq: None,
                    template: None,
                };
                let upload_result =
                    run_artifact_upload_for_publish(&upload, &api, &store, output, diagnostics)
                        .await;
                match upload_result {
                    Err(error) => Err((error.to_string(), artifact_exit_code(&error))),
                    Ok((artifact_id, version_id)) => run_artifact_command(
                        ArtifactCommand::Publish(ArtifactPublishArgs {
                            artifact: Some(artifact_id),
                            version: Some(version_id),
                            duration: args.duration,
                            expires_at: args.expires_at,
                            replace_link: args.replace_link,
                            confirm_replace_link: args.confirm_replace_link,
                            json: None,
                            jq: None,
                            template: None,
                        }),
                        &api,
                        &store,
                        output,
                        diagnostics,
                    )
                    .await
                    .map_err(|error| (error.to_string(), artifact_exit_code(&error))),
                }
            }
            .await
        }
        Command::Auth { command } => run_auth(command, &api, &store, output, |url| {
            webbrowser::open(url).map_err(|error| AuthError::Network(error.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|error| (error.to_string(), auth_exit_code(&error))),
        Command::Artifact { command } => {
            run_artifact_command(command, &api, &store, output, diagnostics)
                .await
                .map_err(|error| (error.to_string(), artifact_exit_code(&error)))
        }
        Command::Capabilities => unreachable!("capabilities is handled before API setup"),
    };
    match result {
        Ok(()) => 0,
        Err((message, code)) => {
            let _ = writeln!(diagnostics, "{message}");
            code
        }
    }
}

fn infer_agent_operation(arguments: &[OsString]) -> &'static str {
    let values = arguments
        .iter()
        .filter_map(|value| value.to_str())
        .collect::<Vec<_>>();
    if values.contains(&"capabilities") {
        return "capabilities";
    }
    if values.contains(&"publish") && !values.contains(&"artifact") {
        return "artifact.publish_local";
    }
    if values.contains(&"auth") {
        if values.contains(&"login") {
            return "auth.login";
        }
        if values.contains(&"logout") {
            return "auth.logout";
        }
        return "auth.status";
    }
    if values.contains(&"publication") {
        return if values.contains(&"edit") {
            "artifact.publication.edit"
        } else {
            "artifact.publication.view"
        };
    }
    for (name, operation) in [
        ("upload", "artifact.upload"),
        ("publish", "artifact.publish"),
        ("unpublish", "artifact.unpublish"),
        ("delete", "artifact.delete"),
        ("export", "artifact.export"),
        ("list", "artifact.list"),
    ] {
        if values.contains(&name) {
            return operation;
        }
    }
    "capabilities"
}

fn validate_agent(cli: &Cli, output: &mut dyn Write) -> Option<i32> {
    if !cli.agent {
        return None;
    }
    let operation = agent_operation_id(&cli.command);
    let error = match cli.agent_protocol {
        None => (
            "agent_protocol_required",
            "Select a protocol version advertised by `shareslices --agent capabilities`.",
            serde_json::json!({
                "supportedProtocolVersions": [crate::AGENT_PROTOCOL_VERSION]
            }),
        ),
        Some(version) if version != crate::AGENT_PROTOCOL_VERSION => (
            "unsupported_agent_protocol",
            "The selected Agent protocol version is not supported by this CLI.",
            serde_json::json!({
                "selectedProtocolVersion": version,
                "supportedProtocolVersions": [crate::AGENT_PROTOCOL_VERSION]
            }),
        ),
        Some(_) if has_agent_presentation_conflict(&cli.command) => (
            "presentation_conflict",
            "Agent mode cannot be combined with --json, --jq, or --template.",
            serde_json::json!({}),
        ),
        Some(_) => return None,
    };
    let _ = serde_json::to_writer(
        &mut *output,
        &failed_agent_envelope(operation, error.0, error.1, error.2),
    );
    let _ = writeln!(output);
    Some(1)
}

async fn run_agent_command<S: CredentialStore>(
    command: Command,
    api_url: &str,
    api: &ApiClient,
    store: &S,
    output: &mut dyn Write,
) -> i32 {
    let operation = agent_operation_id(&command);
    let envelope = match command {
        Command::Auth { command } => run_agent_auth(command, operation, api_url, api, store).await,
        Command::Publish(args) => {
            let upload = ArtifactUploadArgs {
                agent_mode: true,
                paths: args.paths,
                root: args.root,
                name: Some(args.name),
                artifact: None,
                entry: args.entry,
                no_progress: true,
                json: Some("artifact,version,publication".to_owned()),
                jq: None,
                template: None,
            };
            let mut ignored = Vec::new();
            match run_artifact_upload_for_publish(
                &upload,
                api,
                store,
                &mut ignored,
                &mut Vec::new(),
            )
            .await
            {
                Ok((artifact_id, version_id)) => {
                    let durable_upload = serde_json::json!({
                        "artifact": { "id": artifact_id },
                        "version": { "id": version_id }
                    });
                    let command = ArtifactCommand::Publish(ArtifactPublishArgs {
                        artifact: Some(artifact_id.clone()),
                        version: Some(version_id.clone()),
                        duration: args.duration,
                        expires_at: args.expires_at,
                        replace_link: args.replace_link,
                        confirm_replace_link: args.confirm_replace_link,
                        json: Some(
                            "artifactId,versionId,publicationState,expiresAt,url,copyEligible"
                                .to_owned(),
                        ),
                        jq: None,
                        template: None,
                    });
                    let mut envelope = run_agent_artifact(command, operation, api, store).await;
                    if envelope.outcome != AgentOutcome::Completed {
                        envelope.resources = merge_resources(durable_upload, &envelope.resources);
                        if matches!(
                            envelope.outcome,
                            AgentOutcome::Failed
                                | AgentOutcome::ActionRequired
                                | AgentOutcome::Cancelled
                        ) {
                            envelope.outcome = AgentOutcome::Partial;
                        }
                    }
                    envelope
                }
                Err(error) => agent_artifact_error(operation, &error),
            }
        }
        Command::Artifact { command } => run_agent_artifact(command, operation, api, store).await,
        Command::Capabilities => unreachable!("capabilities is handled before Agent dispatch"),
    };
    let code = envelope.outcome.exit_code();
    let _ = serde_json::to_writer(&mut *output, &envelope);
    let _ = writeln!(output);
    code
}

fn merge_resources(
    mut durable: serde_json::Value,
    additional: &serde_json::Value,
) -> serde_json::Value {
    if let (Some(durable), Some(additional)) = (durable.as_object_mut(), additional.as_object()) {
        for (key, value) in additional {
            durable.insert(key.clone(), value.clone());
        }
    }
    durable
}

async fn run_agent_auth(
    command: AuthCommand,
    operation: &'static str,
    api_url: &str,
    api: &ApiClient,
    store: &dyn CredentialStore,
) -> AgentEnvelope {
    match command {
        AuthCommand::Login { continuation } => {
            if let Ok(Some(token)) = store.get()
                && let Ok(user) = api.current_user(&token).await
            {
                return AgentEnvelope::completed(
                    operation,
                    serde_json::json!({}),
                    serde_json::json!({ "user": user }),
                );
            }
            let (origin, continuation_store) = match FileAuthContinuationStore::for_origin(api_url)
            {
                Ok(value) => value,
                Err(error) => return agent_auth_error(operation, &error),
            };
            if let Some(id) = continuation {
                return continue_agent_login(
                    operation,
                    &origin,
                    &id,
                    api,
                    store,
                    &continuation_store,
                )
                .await;
            }
            let record =
                match active_or_start_authorization(&origin, api, &continuation_store).await {
                    Ok(record) => record,
                    Err(error) => return agent_auth_error(operation, &error),
                };
            authorization_envelope(
                operation,
                &record,
                AgentActionKind::Authorize,
                "Open the verification URL and approve this CLI session.",
            )
        }
        AuthCommand::Status => match store.get() {
            Ok(Some(token)) => match api.current_user(&token).await {
                Ok(user) => AgentEnvelope::completed(
                    operation,
                    serde_json::json!({}),
                    serde_json::json!({ "signedIn": true, "user": user }),
                ),
                Err(error) => agent_auth_error(operation, &error),
            },
            Ok(None) => {
                let mut envelope = AgentEnvelope::new(operation, AgentOutcome::ActionRequired);
                envelope.data = serde_json::json!({ "signedIn": false });
                envelope.next_action = Some(AgentNextAction {
                    kind: AgentActionKind::Authorize,
                    instruction: "Authorize the ShareSlices CLI session.".to_owned(),
                    parameters: None,
                });
                envelope
            }
            Err(error) => agent_auth_error(operation, &error),
        },
        AuthCommand::Logout => match store.get() {
            Ok(None) => AgentEnvelope::completed(
                operation,
                serde_json::json!({}),
                serde_json::json!({ "signedIn": false }),
            ),
            Ok(Some(token)) => match api.revoke(&token).await {
                Ok(()) => match store.delete() {
                    Ok(()) => AgentEnvelope::completed(
                        operation,
                        serde_json::json!({}),
                        serde_json::json!({ "signedIn": false }),
                    ),
                    Err(error) => agent_auth_error(operation, &error),
                },
                Err(error) => agent_auth_error(operation, &error),
            },
            Err(error) => agent_auth_error(operation, &error),
        },
    }
}

async fn active_or_start_authorization(
    origin: &str,
    api: &ApiClient,
    continuations: &dyn AuthContinuationStore,
) -> Result<AuthContinuationRecord, AuthError> {
    if let Some(record) = continuations.active_for_origin(origin)? {
        return Ok(record);
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    origin.hash(&mut hasher);
    let claim_id = format!("origin-{:016x}", hasher.finish());
    if !continuations.claim(&claim_id)? {
        // Another process owns challenge creation. A short scheduler yield is enough to make its
        // atomic record visible without turning Agent login into a polling command.
        tokio::task::yield_now().await;
        return continuations.active_for_origin(origin)?.ok_or_else(|| {
            AuthError::CredentialStore(
                "another process is creating the authorization challenge; retry once".to_owned(),
            )
        });
    }
    let result = async {
        if let Some(record) = continuations.active_for_origin(origin)? {
            return Ok(record);
        }
        let authorization = api.start_authorization().await?;
        let record = AuthContinuationRecord::new(origin.to_owned(), authorization);
        continuations.write(&record)?;
        Ok(record)
    }
    .await;
    let release = continuations.release_claim(&claim_id);
    match (result, release) {
        (Ok(record), Ok(())) => Ok(record),
        (Err(error), _) | (Ok(_), Err(error)) => Err(error),
    }
}

fn authorization_envelope(
    operation: &'static str,
    record: &AuthContinuationRecord,
    kind: AgentActionKind,
    instruction: &str,
) -> AgentEnvelope {
    let mut envelope = AgentEnvelope::new(operation, AgentOutcome::ActionRequired);
    envelope.data = serde_json::json!({
        "userCode": record.user_code,
        "verificationUri": record.verification_uri,
        "verificationUriComplete": record.verification_uri_complete,
    });
    envelope.next_action = Some(AgentNextAction {
        kind,
        instruction: instruction.to_owned(),
        parameters: None,
    });
    envelope.continuation = Some(AgentContinuation {
        id: record.id.clone(),
        expires_at: format_timestamp(record.expires_at),
        check_after: format_timestamp(record.check_after),
    });
    envelope
}

#[allow(clippy::too_many_lines)]
async fn continue_agent_login(
    operation: &'static str,
    origin: &str,
    id: &str,
    api: &ApiClient,
    credentials: &dyn CredentialStore,
    continuations: &dyn AuthContinuationStore,
) -> AgentEnvelope {
    let mut record = match continuations.read(id) {
        Ok(Some(record)) if record.api_origin == origin && !record.terminal => record,
        Ok(_) => {
            return failed_agent_envelope(
                operation,
                "invalid_continuation",
                "The authentication continuation is invalid, consumed, or belongs to another API origin.",
                serde_json::json!({}),
            );
        }
        Err(error) => return agent_auth_error(operation, &error),
    };
    let now = unix_now();
    if record.expires_at <= now {
        record.strip_terminal_secrets();
        let _ = continuations.write(&record);
        return failed_agent_envelope(
            operation,
            "authorization_expired",
            "Authorization expired. Start a new Agent login.",
            serde_json::json!({}),
        );
    }
    if record.check_after > now {
        return authorization_envelope(
            operation,
            &record,
            AgentActionKind::RetryLater,
            "Authorization has not reached its next useful check time.",
        );
    }
    match continuations.claim(id) {
        Ok(true) => {}
        Ok(false) => {
            return authorization_envelope(
                operation,
                &record,
                AgentActionKind::RetryLater,
                "Another CLI process is checking this authorization. Try again later.",
            );
        }
        Err(error) => return agent_auth_error(operation, &error),
    }
    let Some(device_code) = record.device_code.clone() else {
        let _ = continuations.release_claim(id);
        return failed_agent_envelope(
            operation,
            "invalid_continuation",
            "The authentication continuation no longer contains an active challenge.",
            serde_json::json!({}),
        );
    };
    let result = match api.exchange(&device_code).await {
        Ok(exchange) => {
            let envelope = match credentials.set(&exchange.access_token) {
                Ok(()) => AgentEnvelope::completed(
                    operation,
                    serde_json::json!({}),
                    serde_json::json!({ "user": exchange.user }),
                ),
                Err(error) => {
                    let _ = api.revoke(&exchange.access_token).await;
                    agent_auth_error(operation, &error)
                }
            };
            record.strip_terminal_secrets();
            let _ = continuations.write(&record);
            envelope
        }
        Err(AuthError::Pending) => {
            record.check_after = unix_now().saturating_add(record.interval_seconds);
            let _ = continuations.write(&record);
            authorization_envelope(
                operation,
                &record,
                AgentActionKind::RetryLater,
                "Authorization is still pending. Check again later.",
            )
        }
        Err(AuthError::SlowDown) => {
            record.interval_seconds = record.interval_seconds.saturating_add(5);
            record.check_after = unix_now().saturating_add(record.interval_seconds);
            let _ = continuations.write(&record);
            authorization_envelope(
                operation,
                &record,
                AgentActionKind::RetryLater,
                "Authorization polling was too frequent. Check again after the indicated time.",
            )
        }
        Err(error @ (AuthError::Denied | AuthError::Expired)) => {
            record.strip_terminal_secrets();
            let _ = continuations.write(&record);
            agent_auth_error(operation, &error)
        }
        Err(error) if error.has_server_code("authorization_pending") => {
            record.check_after = unix_now().saturating_add(record.interval_seconds);
            let _ = continuations.write(&record);
            authorization_envelope(
                operation,
                &record,
                AgentActionKind::RetryLater,
                "Authorization is still pending. Check again later.",
            )
        }
        Err(error) if error.has_server_code("slow_down") => {
            record.interval_seconds = record.interval_seconds.saturating_add(5);
            record.check_after = unix_now().saturating_add(record.interval_seconds);
            let _ = continuations.write(&record);
            authorization_envelope(
                operation,
                &record,
                AgentActionKind::RetryLater,
                "Authorization polling was too frequent. Check again after the indicated time.",
            )
        }
        Err(error)
            if error.has_server_code("access_denied")
                || error.has_server_code("expired_token")
                || error.has_server_code("invalid_grant") =>
        {
            record.strip_terminal_secrets();
            let _ = continuations.write(&record);
            agent_auth_error(operation, &error)
        }
        Err(error) => agent_auth_error(operation, &error),
    };
    let _ = continuations.release_claim(id);
    result
}

#[allow(clippy::too_many_lines)]
async fn run_agent_artifact(
    command: ArtifactCommand,
    operation: &'static str,
    api: &ApiClient,
    store: &dyn CredentialStore,
) -> AgentEnvelope {
    let mut command = match command {
        ArtifactCommand::List(args) => {
            let token = match store.get() {
                Ok(Some(token)) => token,
                Ok(None) => {
                    return agent_artifact_error(operation, &ArtifactError::Unauthenticated);
                }
                Err(error) => return agent_auth_error(operation, &error),
            };
            return match api
                .list_artifacts(&token, args.publication, args.processing, args.limit)
                .await
            {
                Ok(artifacts) => AgentEnvelope::completed(
                    operation,
                    serde_json::json!({}),
                    serde_json::json!({ "artifacts": artifacts }),
                ),
                Err(error) => agent_artifact_error(operation, &error),
            };
        }
        ArtifactCommand::Publication {
            command: ArtifactPublicationCommand::View(args),
        } => {
            let Some(artifact_id) = args.artifact else {
                return agent_artifact_error(
                    operation,
                    &ArtifactError::ShareViewSelectionUnavailable,
                );
            };
            let token = match store.get() {
                Ok(Some(token)) => token,
                Ok(None) => {
                    return agent_artifact_error(operation, &ArtifactError::Unauthenticated);
                }
                Err(error) => return agent_auth_error(operation, &error),
            };
            return match api.artifact(&token, &artifact_id).await {
                Ok(artifact) => AgentEnvelope::completed(
                    operation,
                    serde_json::json!({ "artifact": artifact }),
                    serde_json::json!({}),
                ),
                Err(error) => agent_artifact_error(operation, &error),
            };
        }
        other => other,
    };
    let selected_artifact_id = artifact_id_for_command(&command);
    force_agent_presentation(&mut command);
    let mut command_output = Vec::new();
    let mut diagnostics = Vec::new();
    let mut input = std::io::Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    match run_artifact_command_with_interaction(
        command,
        api,
        store,
        &mut interaction,
        &mut command_output,
        &mut diagnostics,
    )
    .await
    {
        Ok(()) if operation == "artifact.delete" => AgentEnvelope::completed(
            operation,
            serde_json::json!({ "artifact": { "id": selected_artifact_id, "deleted": true } }),
            serde_json::json!({}),
        ),
        Ok(()) => match serde_json::from_slice::<serde_json::Value>(&command_output) {
            Ok(value) => {
                let mut resources = agent_resources(operation, &value);
                if let Some(artifact_id) =
                    value.get("artifactId").and_then(serde_json::Value::as_str)
                    && let Ok(Some(token)) = store.get()
                    && let Ok(artifact) = api.artifact(&token, artifact_id).await
                {
                    resources["artifact"] = serde_json::to_value(artifact)
                        .unwrap_or_else(|_| serde_json::json!({ "id": artifact_id }));
                }
                AgentEnvelope::completed(operation, resources, agent_data(operation, value))
            }
            Err(_) => failed_agent_envelope(
                operation,
                "invalid_agent_projection",
                "The CLI could not render a typed Agent result.",
                serde_json::json!({}),
            ),
        },
        Err(error) => {
            let mut envelope = agent_artifact_error(operation, &error);
            if let Some(artifact_id) = selected_artifact_id {
                envelope.resources = merge_resources(
                    serde_json::json!({ "artifact": { "id": artifact_id } }),
                    &envelope.resources,
                );
            }
            envelope
        }
    }
}

fn artifact_id_for_command(command: &ArtifactCommand) -> Option<String> {
    match command {
        ArtifactCommand::List(_) => None,
        ArtifactCommand::Upload(args) => args.artifact.clone(),
        ArtifactCommand::Publish(args) => args.artifact.clone(),
        ArtifactCommand::Unpublish(args) => args.artifact.clone(),
        ArtifactCommand::Delete(args) => args.artifact.clone(),
        ArtifactCommand::Export(args) => args.artifact.clone(),
        ArtifactCommand::Publication { command } => match command {
            ArtifactPublicationCommand::View(args) => args.artifact.clone(),
            ArtifactPublicationCommand::Edit(args) => args.artifact.clone(),
        },
    }
}

fn force_agent_presentation(command: &mut ArtifactCommand) {
    let set = |json: &mut Option<String>,
               jq: &mut Option<String>,
               template: &mut Option<String>,
               fields: &str| {
        *json = Some(fields.to_owned());
        *jq = None;
        *template = None;
    };
    match command {
        ArtifactCommand::List(args) => {
            args.no_progress = true;
            set(
                &mut args.json,
                &mut args.jq,
                &mut args.template,
                "id,name,processingState,publicationState,expiresAt,updatedAt",
            );
        }
        ArtifactCommand::Upload(args) => {
            args.agent_mode = true;
            args.no_progress = true;
            set(
                &mut args.json,
                &mut args.jq,
                &mut args.template,
                "artifact,version,publication",
            );
        }
        ArtifactCommand::Publish(args) => set(
            &mut args.json,
            &mut args.jq,
            &mut args.template,
            "artifactId,versionId,publicationState,expiresAt,url,copyEligible",
        ),
        ArtifactCommand::Unpublish(args) => set(
            &mut args.json,
            &mut args.jq,
            &mut args.template,
            "artifactId,publicationState,expiresAt,url,copyEligible",
        ),
        ArtifactCommand::Export(args) => {
            args.no_progress = true;
            set(
                &mut args.json,
                &mut args.jq,
                &mut args.template,
                "artifactId,versionId,path",
            );
        }
        ArtifactCommand::Publication { command } => match command {
            ArtifactPublicationCommand::View(args) => set(
                &mut args.json,
                &mut args.jq,
                &mut args.template,
                "artifactId,versionId,publicationState,expiresAt,url,copyEligible",
            ),
            ArtifactPublicationCommand::Edit(args) => set(
                &mut args.json,
                &mut args.jq,
                &mut args.template,
                "artifactId,versionId,publicationState,expiresAt,url,copyEligible",
            ),
        },
        ArtifactCommand::Delete(_) => {}
    }
}

fn agent_resources(operation: &str, value: &serde_json::Value) -> serde_json::Value {
    if operation == "artifact.upload" {
        return value.clone();
    }
    if operation == "artifact.list" {
        return serde_json::json!({});
    }
    let mut resources = serde_json::Map::new();
    if let Some(id) = value.get("artifactId") {
        resources.insert("artifact".to_owned(), serde_json::json!({ "id": id }));
    }
    if let Some(id) = value.get("versionId").filter(|value| !value.is_null()) {
        resources.insert("version".to_owned(), serde_json::json!({ "id": id }));
    }
    if let Some(url) = value.get("url").filter(|value| !value.is_null()) {
        resources.insert("shareLink".to_owned(), serde_json::json!({ "url": url }));
    }
    serde_json::Value::Object(resources)
}

fn agent_data(operation: &str, value: serde_json::Value) -> serde_json::Value {
    if operation == "artifact.list" {
        serde_json::json!({ "artifacts": value })
    } else if operation == "artifact.upload" {
        serde_json::json!({})
    } else {
        value
    }
}

fn agent_error(code: &str, message: &str) -> AgentError {
    AgentError {
        code: code.to_owned(),
        message: message.to_owned(),
        request_id: None,
        action: None,
        fields: None,
        details: None,
        validation_report: None,
        recoverability: None,
        allowed_actions: None,
        retry_after_seconds: None,
    }
}

fn agent_auth_error(operation: &'static str, error: &AuthError) -> AgentEnvelope {
    let (outcome, code, kind, instruction) = match error {
        AuthError::Unauthenticated => (
            AgentOutcome::ActionRequired,
            "unauthenticated",
            AgentActionKind::Authorize,
            "Authorize the ShareSlices CLI session.",
        ),
        AuthError::UpgradeRequired { .. } => (
            AgentOutcome::ActionRequired,
            "cli_upgrade_required",
            AgentActionKind::InstallOrUpgrade,
            "Install or upgrade to a compatible ShareSlices CLI.",
        ),
        AuthError::Pending | AuthError::SlowDown => (
            AgentOutcome::ActionRequired,
            "authorization_pending",
            AgentActionKind::RetryLater,
            "Check the authorization again later.",
        ),
        AuthError::Expired | AuthError::Denied => (
            AgentOutcome::Failed,
            "authorization_failed",
            AgentActionKind::Authorize,
            "Start a new authorization.",
        ),
        AuthError::Network(_) => (
            AgentOutcome::Failed,
            "network_error",
            AgentActionKind::RetryLater,
            "Retry after connectivity is restored.",
        ),
        AuthError::CredentialStore(_) => (
            AgentOutcome::Failed,
            "credential_store_unavailable",
            AgentActionKind::ContactSupport,
            "Restore access to the operating-system credential store.",
        ),
        AuthError::ServerEvidence(evidence) => {
            let outcome = match evidence.code.as_str() {
                "authorization_pending"
                | "slow_down"
                | "unauthenticated"
                | "cli_upgrade_required" => AgentOutcome::ActionRequired,
                _ => AgentOutcome::Failed,
            };
            let mut envelope = AgentEnvelope::new(operation, outcome);
            envelope.error = Some(agent_evidence(evidence));
            envelope.next_action = Some(next_action_for_evidence(operation, evidence));
            return envelope;
        }
        AuthError::Server | AuthError::InvalidApiUrl => (
            AgentOutcome::Failed,
            "client_error",
            AgentActionKind::ContactSupport,
            "Inspect the CLI and Server configuration.",
        ),
    };
    let mut envelope = AgentEnvelope::new(operation, outcome);
    envelope.error = Some(agent_error(code, &error.to_string()));
    envelope.next_action = Some(AgentNextAction {
        kind,
        instruction: instruction.to_owned(),
        parameters: None,
    });
    envelope
}

#[allow(clippy::too_many_lines)]
fn agent_artifact_error(operation: &'static str, error: &ArtifactError) -> AgentEnvelope {
    let mutation = matches!(
        operation,
        "artifact.publish_local"
            | "artifact.upload"
            | "artifact.publish"
            | "artifact.unpublish"
            | "artifact.publication.edit"
            | "artifact.delete"
    );
    let (outcome, code, kind, instruction) = match error {
        ArtifactError::Cancelled => (
            AgentOutcome::Cancelled,
            "cancelled",
            AgentActionKind::ResolveAmbiguity,
            "No further action was taken.",
        ),
        ArtifactError::Unauthenticated => (
            AgentOutcome::ActionRequired,
            "unauthenticated",
            AgentActionKind::Authorize,
            "Authorize the ShareSlices CLI session.",
        ),
        ArtifactError::DeleteConfirmationRequired => (
            AgentOutcome::ActionRequired,
            "confirmation_required",
            AgentActionKind::ConfirmIrreversible,
            "Confirm permanent Artifact deletion, then pass --yes.",
        ),
        ArtifactError::SelectionUnavailable
        | ArtifactError::PublishSelectionUnavailable
        | ArtifactError::UnpublishSelectionUnavailable
        | ArtifactError::ShareViewSelectionUnavailable
        | ArtifactError::ShareEditSelectionUnavailable
        | ArtifactError::DeleteSelectionUnavailable
        | ArtifactError::ExportSelectionUnavailable
        | ArtifactError::AmbiguousEntry => (
            AgentOutcome::ActionRequired,
            "input_required",
            AgentActionKind::ResolveAmbiguity,
            "Provide the missing identifier or unambiguous input.",
        ),
        ArtifactError::UpgradeRequired { .. } => (
            AgentOutcome::ActionRequired,
            "cli_upgrade_required",
            AgentActionKind::InstallOrUpgrade,
            "Install or upgrade to a compatible ShareSlices CLI.",
        ),
        ArtifactError::UploadConfirmationPending | ArtifactError::DeleteConfirmationPending => (
            AgentOutcome::Indeterminate,
            "mutation_indeterminate",
            AgentActionKind::InspectState,
            "Inspect current Server state before considering another mutation.",
        ),
        ArtifactError::Network(_) if mutation => (
            AgentOutcome::Indeterminate,
            "network_error",
            AgentActionKind::InspectState,
            "Inspect current Server state before considering another mutation.",
        ),
        ArtifactError::InvalidZipInput
        | ArtifactError::InvalidUploadInput(_)
        | ArtifactError::InvalidEntry
        | ArtifactError::InvalidPublicationExpiration
        | ArtifactError::InvalidShareExpiration
        | ArtifactError::OutputParentMissing
        | ArtifactError::OutputExists
        | ArtifactError::OutputWrite => (
            AgentOutcome::Failed,
            "invalid_local_input",
            AgentActionKind::ChangeLocalInput,
            "Correct the local input and invoke the same operation again.",
        ),
        ArtifactError::ProcessingInProgress {
            artifact_id,
            upload_session_id,
        } => {
            let mut envelope = AgentEnvelope::new(operation, AgentOutcome::InProgress);
            envelope.resources = serde_json::json!({ "artifact": { "id": artifact_id }, "uploadSession": { "id": upload_session_id } });
            envelope.next_action = Some(AgentNextAction {
                kind: AgentActionKind::InspectState,
                instruction: "Inspect the accepted Artifact after Server processing advances."
                    .to_owned(),
                parameters: None,
            });
            return envelope;
        }
        ArtifactError::ProcessingFailed(_)
        | ArtifactError::VersionNotReady
        | ArtifactError::InvalidArtifactState
        | ArtifactError::DeleteProcessingActive
        | ArtifactError::NoReadyVersion => (
            AgentOutcome::Failed,
            "invalid_artifact_state",
            AgentActionKind::InspectState,
            "Inspect the Artifact state before deciding the next operation.",
        ),
        ArtifactError::Network(_) => (
            AgentOutcome::Failed,
            "network_error",
            AgentActionKind::RetryLater,
            "Retry the read after connectivity is restored.",
        ),
        ArtifactError::ServerEvidence(evidence) => {
            let outcome = if mutation && evidence.status >= 500 {
                AgentOutcome::Indeterminate
            } else {
                AgentOutcome::Failed
            };
            let mut envelope = AgentEnvelope::new(operation, outcome);
            envelope.error = Some(agent_evidence(evidence));
            envelope.next_action = Some(next_action_for_evidence(operation, evidence));
            return envelope;
        }
        _ => (
            AgentOutcome::Failed,
            "operation_failed",
            AgentActionKind::ContactSupport,
            "Inspect the returned error and Server request evidence.",
        ),
    };
    let mut envelope = AgentEnvelope::new(operation, outcome);
    envelope.error = Some(agent_error(code, &error.to_string()));
    envelope.next_action = Some(AgentNextAction {
        kind,
        instruction: instruction.to_owned(),
        parameters: None,
    });
    envelope
}

fn agent_evidence(evidence: &crate::ApiErrorEvidence) -> AgentError {
    let validation_report = evidence
        .details
        .as_ref()
        .and_then(|details| details.get("validationReport"))
        .cloned();
    let recoverability = evidence
        .details
        .as_ref()
        .and_then(|details| details.get("recoverability"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned);
    let allowed_actions = evidence
        .details
        .as_ref()
        .and_then(|details| details.get("allowedActions"))
        .and_then(serde_json::Value::as_array)
        .map(|actions| {
            actions
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        });
    AgentError {
        code: evidence.code.clone(),
        message: evidence.message.clone(),
        request_id: evidence.request_id.clone(),
        action: evidence.action.clone(),
        fields: evidence.fields.clone(),
        details: evidence.details.clone(),
        validation_report,
        recoverability,
        allowed_actions,
        retry_after_seconds: evidence.retry_after_seconds,
    }
}

fn next_action_for_evidence(
    operation: &str,
    evidence: &crate::ApiErrorEvidence,
) -> AgentNextAction {
    let (kind, instruction) = match evidence.code.as_str() {
        "unauthenticated" => (
            AgentActionKind::Authorize,
            "Authorize the ShareSlices CLI session.",
        ),
        "cli_upgrade_required" => (
            AgentActionKind::InstallOrUpgrade,
            "Install or upgrade to a compatible ShareSlices CLI.",
        ),
        "authorization_pending" | "slow_down" => (
            AgentActionKind::RetryLater,
            "Check the authorization again after the Server-owned delay.",
        ),
        "access_denied" | "expired_token" | "invalid_grant" => (
            AgentActionKind::Authorize,
            "Start a new authorization challenge.",
        ),
        "invalid_request" | "archive_too_large" => (
            AgentActionKind::ChangeLocalInput,
            "Correct the indicated request fields or local input.",
        ),
        "operation_in_progress" | "rate_limited" => (
            AgentActionKind::RetryLater,
            "Wait for the Server-owned delay, then inspect state before another mutation.",
        ),
        "idempotency_conflict" | "invalid_artifact_state" => (
            AgentActionKind::InspectState,
            "Inspect current durable state before deciding whether another mutation is safe.",
        ),
        _ if matches!(
            operation,
            "artifact.publish"
                | "artifact.unpublish"
                | "artifact.publication.edit"
                | "artifact.delete"
        ) =>
        {
            (
                AgentActionKind::InspectState,
                "Inspect current durable state before considering another mutation.",
            )
        }
        _ => (
            AgentActionKind::ContactSupport,
            "Use the Server request ID when requesting support.",
        ),
    };
    AgentNextAction {
        kind,
        instruction: instruction.to_owned(),
        parameters: None,
    }
}

const fn has_agent_presentation_conflict(command: &Command) -> bool {
    match command {
        Command::Capabilities | Command::Publish(_) | Command::Auth { .. } => false,
        Command::Artifact { command } => match command {
            ArtifactCommand::Delete(_) => false,
            ArtifactCommand::List(args) => {
                args.json.is_some() || args.jq.is_some() || args.template.is_some()
            }
            ArtifactCommand::Upload(args) => {
                args.json.is_some() || args.jq.is_some() || args.template.is_some()
            }
            ArtifactCommand::Publish(args) => {
                args.json.is_some() || args.jq.is_some() || args.template.is_some()
            }
            ArtifactCommand::Unpublish(args) => {
                args.json.is_some() || args.jq.is_some() || args.template.is_some()
            }
            ArtifactCommand::Export(args) => {
                args.json.is_some() || args.jq.is_some() || args.template.is_some()
            }
            ArtifactCommand::Publication { command } => match command {
                ArtifactPublicationCommand::View(args) => {
                    args.json.is_some() || args.jq.is_some() || args.template.is_some()
                }
                ArtifactPublicationCommand::Edit(args) => {
                    args.json.is_some() || args.jq.is_some() || args.template.is_some()
                }
            },
        },
    }
}

#[must_use]
pub const fn agent_operation_id(command: &Command) -> &'static str {
    match command {
        Command::Capabilities => "capabilities",
        Command::Publish(_) => "artifact.publish_local",
        Command::Auth { command } => match command {
            AuthCommand::Login { .. } => "auth.login",
            AuthCommand::Status => "auth.status",
            AuthCommand::Logout => "auth.logout",
        },
        Command::Artifact { command } => match command {
            ArtifactCommand::List(_) => "artifact.list",
            ArtifactCommand::Upload(_) => "artifact.upload",
            ArtifactCommand::Publish(_) => "artifact.publish",
            ArtifactCommand::Unpublish(_) => "artifact.unpublish",
            ArtifactCommand::Delete(_) => "artifact.delete",
            ArtifactCommand::Publication { command } => match command {
                ArtifactPublicationCommand::View(_) => "artifact.publication.view",
                ArtifactPublicationCommand::Edit(_) => "artifact.publication.edit",
            },
            ArtifactCommand::Export(_) => "artifact.export",
        },
    }
}

fn handle_capabilities(
    cli: &Cli,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
) -> Option<i32> {
    if !matches!(cli.command, Command::Capabilities) {
        return None;
    }
    if !cli.agent {
        let _ = writeln!(
            diagnostics,
            "`capabilities` requires `--agent` and does not accept `--agent-protocol`"
        );
        return Some(1);
    }
    if let Some(version) = cli.agent_protocol {
        let _ = serde_json::to_writer(
            &mut *output,
            &failed_agent_envelope(
                "capabilities",
                "agent_protocol_not_allowed",
                "Capability discovery does not accept an Agent protocol selector.",
                serde_json::json!({ "selectedProtocolVersion": version }),
            ),
        );
        let _ = writeln!(output);
        return Some(1);
    }
    let _ = serde_json::to_writer_pretty(&mut *output, &agent_capabilities());
    let _ = writeln!(output);
    Some(0)
}

fn write_auth_error(error: &AuthError, diagnostics: &mut dyn Write) -> i32 {
    let code = auth_exit_code(error);
    let _ = writeln!(diagnostics, "{error}");
    code
}

const fn auth_exit_code(error: &AuthError) -> i32 {
    if matches!(error, AuthError::Unauthenticated) {
        4
    } else {
        1
    }
}
