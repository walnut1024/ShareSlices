// cspell:ignore webbrowser
use clap::Parser;
use shareslices_cli::{
    ApiClient, ArtifactCommand, AuthError, Cli, Command, KeyringCredentialStore, run_artifact_list,
    run_auth,
};
use std::io;

#[tokio::main]
async fn main() {
    if let Err((error, code)) = execute().await {
        eprintln!("{error}");
        std::process::exit(code);
    }
}

async fn execute() -> Result<(), (Box<dyn std::error::Error>, i32)> {
    let cli = Cli::parse();
    let api = ApiClient::new(&cli.api_url).map_err(boxed)?;
    let store = KeyringCredentialStore::new(&cli.api_url).map_err(boxed)?;
    match cli.command {
        Command::Auth { command } => run_auth(command, &api, &store, &mut io::stdout(), |url| {
            webbrowser::open(url).map_err(|error| AuthError::Network(error.to_string()))?;
            Ok(())
        })
        .await
        .map_err(boxed),
        Command::Artifact {
            command: ArtifactCommand::List(args),
        } => run_artifact_list(&args, &api, &store, &mut io::stdout())
            .await
            .map_err(|error| {
                let code = if matches!(error, shareslices_cli::ArtifactError::Unauthenticated) {
                    4
                } else {
                    1
                };
                (Box::new(error) as Box<dyn std::error::Error>, code)
            }),
    }
}

fn boxed(error: AuthError) -> (Box<dyn std::error::Error>, i32) {
    let code = if matches!(error, AuthError::Unauthenticated) {
        4
    } else {
        1
    };
    (Box::new(error), code)
}
