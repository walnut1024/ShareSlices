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
    Publish(ArtifactPublishArgs),
    Unpublish(ArtifactUnpublishArgs),
    Delete(ArtifactDeleteArgs),
    Share {
        #[command(subcommand)]
        command: ArtifactShareCommand,
    },
    Export(ArtifactExportArgs),
}

#[derive(Debug, Args)]
pub struct ArtifactExportArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(long)]
    pub version: Option<String>,
    #[arg(short, long, value_name = "FILE")]
    pub output: Option<std::path::PathBuf>,
    #[arg(long)]
    pub clobber: bool,
    #[arg(long)]
    pub no_progress: bool,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactDeleteArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(short = 'y', long)]
    pub yes: bool,
}

#[derive(Debug, Subcommand)]
pub enum ArtifactShareCommand {
    View(ArtifactShareViewArgs),
    Edit(ArtifactShareEditArgs),
}

#[derive(Debug, Args)]
pub struct ArtifactShareViewArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactShareEditArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(long, value_name = "RFC3339_OR_NEVER")]
    pub expires_at: Option<String>,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactPublishArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(long)]
    pub version: Option<String>,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactUnpublishArgs {
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
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
