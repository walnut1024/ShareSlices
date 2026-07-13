use crate::{
    ApiClient, AuthError, Cli, Command, CredentialStore, artifact_exit_code, run_artifact_command,
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
