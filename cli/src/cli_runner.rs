use crate::{
    ApiClient, ArtifactCommand, ArtifactPublishArgs, ArtifactUploadArgs, AuthError, Cli, Command,
    CredentialStore, artifact_exit_code, run_artifact_command, run_artifact_upload_for_publish,
    run_auth,
};
use clap::Parser as _;
use std::ffi::OsString;
use std::io::Write;

/// Parses and executes one CLI process with an injected credential-store factory.
///
/// The shipping binary supplies the operating-system credential store. Process tests can inject a
/// deterministic store while exercising the same parser, dispatcher, diagnostics, and exit-code
/// mapping.
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
    let cli = match Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(error) => {
            let code = error.exit_code();
            if error.use_stderr() {
                let _ = write!(diagnostics, "{error}");
            } else {
                let _ = write!(output, "{error}");
            }
            return code;
        }
    };
    let api = match ApiClient::new(&cli.api_url) {
        Ok(api) => api,
        Err(error) => return write_auth_error(&error, diagnostics),
    };
    let store = match store_factory(&cli.api_url) {
        Ok(store) => store,
        Err(error) => return write_auth_error(&error, diagnostics),
    };
    let result = match cli.command {
        Command::Publish(args) => {
            async {
                let upload = ArtifactUploadArgs {
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
    };
    match result {
        Ok(()) => 0,
        Err((message, code)) => {
            let _ = writeln!(diagnostics, "{message}");
            code
        }
    }
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
