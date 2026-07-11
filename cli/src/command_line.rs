use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "shareslices",
    version,
    about = "Share local artifacts with ShareSlices"
)]
pub struct Cli {
    #[arg(
        long,
        env = "SHARESLICES_API_URL",
        default_value = "http://127.0.0.1:7456"
    )]
    pub api_url: String,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
}

#[derive(Clone, Copy, Debug, Subcommand)]
pub enum AuthCommand {
    Login,
    Status,
    Logout,
}
