use clap::{Args, Parser, Subcommand, ValueEnum};

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
    Artifact {
        #[command(subcommand)]
        command: ArtifactCommand,
    },
}

#[derive(Clone, Copy, Debug, Subcommand)]
pub enum AuthCommand {
    Login,
    Status,
    Logout,
}

#[derive(Debug, Subcommand)]
pub enum ArtifactCommand {
    List(ArtifactListArgs),
    Upload(ArtifactUploadArgs),
}

#[derive(Debug, Args)]
pub struct ArtifactUploadArgs {
    #[arg(value_name = "PATHS", default_value = ".")]
    pub paths: Vec<std::path::PathBuf>,
    #[arg(long, value_name = "DIRECTORY")]
    pub root: Option<std::path::PathBuf>,
    #[arg(long, conflicts_with = "artifact")]
    pub name: Option<String>,
    #[arg(long, conflicts_with = "name")]
    pub artifact: Option<String>,
    #[arg(long)]
    pub entry: Option<String>,
    #[arg(long)]
    pub no_progress: bool,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum PublicationFilter {
    Published,
    Unpublished,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ProcessingFilter {
    Accepted,
    Processing,
    Ready,
    Failed,
}

fn positive_usize(value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|_| "must be a positive integer".to_owned())
        .and_then(|value| {
            (value > 0)
                .then_some(value)
                .ok_or_else(|| "must be greater than zero".to_owned())
        })
}

#[derive(Debug, Args)]
pub struct ArtifactListArgs {
    #[arg(long, value_enum)]
    pub publication: Option<PublicationFilter>,
    #[arg(long, value_enum)]
    pub processing: Option<ProcessingFilter>,
    #[arg(short = 'L', long, default_value = "30", value_parser = positive_usize)]
    pub limit: usize,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
    #[arg(long)]
    pub no_progress: bool,
}
