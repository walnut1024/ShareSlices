// cspell:ignore webbrowser
use shareslices_cli::{KeyringCredentialStore, run_cli_process};
use std::io::{self, Write as _};

#[tokio::main]
async fn main() {
    let code = run_cli_process(
        std::env::args_os(),
        KeyringCredentialStore::new,
        &mut io::stdout(),
        &mut io::stderr(),
    )
    .await;
    let _ = io::stdout().flush();
    let _ = io::stderr().flush();
    if code != 0 {
        std::process::exit(code);
    }
}
