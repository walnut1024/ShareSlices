// cspell:ignore webbrowser
use clap::Parser;
use shareslices_cli::{ApiClient, AuthError, Cli, Command, KeyringCredentialStore, run_auth};
use std::io;

#[tokio::main]
async fn main() {
    if let Err(error) = execute().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn execute() -> Result<(), AuthError> {
    let cli = Cli::parse();
    let api = ApiClient::new(&cli.api_url)?;
    let store = KeyringCredentialStore::new(&cli.api_url)?;
    let Command::Auth { command } = cli.command;
    run_auth(command, &api, &store, &mut io::stdout(), |url| {
        webbrowser::open(url).map_err(|error| AuthError::Network(error.to_string()))?;
        Ok(())
    })
    .await
}
