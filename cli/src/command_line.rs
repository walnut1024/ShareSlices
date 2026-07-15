use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "shareslices",
    version,
    about = "Publish and manage local artifacts with ShareSlices",
    long_about = "Publish and manage local static artifacts with ShareSlices.\n\nAuthenticate once, then use `publish` for the common upload-and-publish workflow or `artifact` commands for stepwise lifecycle control. Human-readable output is the default. Resource commands retain --json with optional --jq or --template for selected-field scripts. Agents use the separate whole-command contract discovered with `shareslices --agent capabilities`.",
    after_long_help = "EXAMPLES:\n  shareslices auth login\n  shareslices publish ./dist --name \"Quarterly report\"\n  shareslices artifact list --processing ready --json id,name --jq '.[].id'\n\nAGENTS AND SCRIPTS:\n  Set SHARESLICES_PROMPT_DISABLED=1 and provide every decision-relevant ID and value explicitly. Missing values that would normally prompt fail before an API request. Stepwise artifact resource commands accept --json with optional --jq or --template for stable stdout; progress and diagnostics use stderr. The shortcut `publish` uses human-readable output.\n\nENVIRONMENT:\n  SHARESLICES_API_URL          Default API origin.\n  SHARESLICES_PROMPT_DISABLED Disable interactive prompts.\n\nEXIT CODES:\n  0 success; 1 operational or server error; 2 interactive cancellation; 4 authentication required.\n\nRun `shareslices <COMMAND> --help` for command-specific arguments, behavior, and examples."
)]
pub struct Cli {
    /// `ShareSlices` API origin. Credentials are stored separately for each origin.
    #[arg(
        long,
        env = "SHARESLICES_API_URL",
        default_value = "http://127.0.0.1:7456"
    )]
    pub api_url: String,
    /// Emit the versioned Agent protocol instead of human-readable output.
    #[arg(long, global = true)]
    pub agent: bool,
    /// Select the Agent protocol version for an operational command.
    #[arg(long, global = true, requires = "agent", value_name = "VERSION")]
    pub agent_protocol: Option<u32>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Describe locally supported Agent protocol versions and operations.
    #[command(
        long_about = "Describe the locally installed Agent protocol and operation surface. This command is available only with --agent, performs no network or credential-store access, and does not require --agent-protocol.",
        after_long_help = "EXAMPLE:\n  shareslices --agent capabilities"
    )]
    Capabilities,
    /// Package, upload, and publish local content in one operation.
    #[command(
        long_about = "Package local content, upload it as a new Artifact, wait for a ready Version, publish it, and print the Share link. The Publication is permanent by default. Use stepwise commands to publish a Version of an existing Artifact.",
        after_long_help = "EXAMPLES:\n  shareslices publish ./dist --name \"Quarterly report\"\n  shareslices publish index.html assets --root . --name \"Report\" --entry index.html\n  shareslices publish ./dist --name \"Temporary demo\" --duration 86400\n\nUse `artifact upload` followed by `artifact publish` when the Version must be inspected before publication."
    )]
    Publish(PublishArgs),
    /// Sign in, inspect, or revoke the CLI session.
    #[command(
        long_about = "Manage the independent CLI session stored for the selected API origin. Login uses browser verification, status validates the stored credential, and logout revokes only this CLI session.",
        after_long_help = "EXAMPLES:\n  shareslices auth login\n  shareslices auth status\n  shareslices auth logout\n\nCredentials are stored in the operating-system credential store and are never printed."
    )]
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    /// Upload and manage owned Artifacts, Versions, and Publications.
    #[command(
        long_about = "Manage the complete Artifact lifecycle. Upload creates content without external access; publish enables external access; unpublish removes access without deleting content; delete is permanent. Publication commands inspect or edit link metadata.",
        after_long_help = "EXAMPLES:\n  shareslices artifact upload ./dist --name \"Report\" --entry index.html\n  shareslices artifact publish artifact_123\n  shareslices artifact publication view artifact_123\n  shareslices artifact unpublish artifact_123\n\nAgents first probe `shareslices --agent capabilities`, then use --agent --agent-protocol 1 and supply omitted IDs and required choices explicitly."
    )]
    Artifact {
        #[command(subcommand)]
        command: ArtifactCommand,
    },
}

#[derive(Clone, Debug, Subcommand)]
pub enum AuthCommand {
    /// Authorize this machine through a browser verification flow.
    #[command(
        long_about = "Authorize an independent CLI session using a browser verification code. The command prints the verification URL and code, attempts to open the browser, polls until approval, and stores the credential in the operating-system credential store. Browser launch failure is not fatal. If a valid credential already exists, the current account is reported without starting a new authorization; logout first to change accounts.",
        after_long_help = "EXAMPLES:\n  shareslices auth login\n  shareslices --api-url https://api.example.com auth login"
    )]
    Login {
        /// Check one previously started Agent authorization without replaying a business command.
        #[arg(long = "continue", value_name = "CONTINUATION_ID")]
        continuation: Option<String>,
    },
    /// Show the account and validity of the stored CLI credential.
    #[command(
        long_about = "Inspect the CLI credential for the selected API origin. A revoked or expired credential is removed locally. Credentials and session IDs are never printed.",
        after_long_help = "EXAMPLES:\n  shareslices auth status\n  shareslices --api-url https://api.example.com auth status"
    )]
    Status,
    /// Revoke and remove only this CLI session.
    #[command(
        long_about = "Revoke the current CLI session and remove its local credential. Browser sessions and other CLI sessions are not affected. If the server cannot be reached, the local credential is retained so logout can be retried.",
        after_long_help = "EXAMPLES:\n  shareslices auth logout"
    )]
    Logout,
}

#[derive(Debug, Subcommand)]
pub enum ArtifactCommand {
    /// List owned Artifacts with publication and processing filters.
    #[command(
        after_long_help = "EXAMPLES:\n  shareslices artifact list\n  shareslices artifact list --publication published --processing ready --limit 50\n  shareslices artifact list --json id,name,processingState --jq '.[].id'"
    )]
    List(ArtifactListArgs),
    /// Upload local content as a new Artifact or Version without publishing it.
    #[command(
        long_about = "Package and upload local files, directories, or one prepared ZIP. Use --name to create a new Artifact or --artifact to add an immutable Version to an existing Artifact. A prepared ZIP cannot be combined with other paths. Non-ZIP inputs must resolve under one unambiguous root; unmatched globs, symbolic links, special files, traversal paths, and nested archives are rejected. The command waits for server processing to reach ready or fail; it never publishes content.",
        after_long_help = "EXAMPLES:\n  shareslices artifact upload ./dist --name \"Quarterly report\" --entry index.html\n  shareslices artifact upload report.zip --name \"Report\" --entry report.html\n  shareslices artifact upload ./dist --artifact artifact_123 --entry index.html\n  shareslices artifact upload index.html assets --root . --name \"Report\" --entry index.html"
    )]
    Upload(ArtifactUploadArgs),
    /// Make a ready Artifact Version externally accessible and print its Share link.
    #[command(
        long_about = "Publish a ready Version and print the externally accessible Share link. The Publication is permanent unless --duration or --expires-at is supplied. Existing links are reused by default; replacement requires both confirmation flags.",
        after_long_help = "EXAMPLES:\n  shareslices artifact publish artifact_123\n  shareslices artifact publish artifact_123 --version version_456 --duration 86400\n  shareslices artifact publish artifact_123 --expires-at 2026-12-31T23:59:59Z\n  shareslices artifact publish artifact_123 --replace-link --confirm-replace-link"
    )]
    Publish(ArtifactPublishArgs),
    /// Remove external access while preserving the Artifact and Versions.
    #[command(
        long_about = "Unpublish an Artifact so its Share link no longer provides external access. The Artifact, Versions, and link identity are retained and can be published again later.",
        after_long_help = "EXAMPLES:\n  shareslices artifact unpublish artifact_123\n  shareslices artifact unpublish artifact_123 --json artifactId,publicationState"
    )]
    Unpublish(ArtifactUnpublishArgs),
    /// Permanently delete an Artifact and all associated data.
    #[command(
        long_about = "Permanently delete an Artifact, all Versions, its Publication, Share link, and stored objects. Agents and scripts must provide both an explicit ARTIFACT_ID and --yes. If the Artifact is selected interactively, confirmation is still required even when --yes is present.",
        after_long_help = "EXAMPLES:\n  shareslices artifact delete artifact_123\n  shareslices artifact delete artifact_123 --yes"
    )]
    Delete(ArtifactDeleteArgs),
    /// View or edit Publication metadata without changing content.
    #[command(
        long_about = "Inspect or change Publication metadata without uploading or replacing content, publishing it, or ending its Publication. View reports the Share link and access state; edit changes only its expiration.",
        after_long_help = "EXAMPLES:\n  shareslices artifact publication view artifact_123\n  shareslices artifact publication edit artifact_123 --expires-at never"
    )]
    Publication {
        #[command(subcommand)]
        command: ArtifactPublicationCommand,
    },
    /// Download an Artifact Version as a ZIP archive.
    #[command(
        long_about = "Export an owned Artifact Version as a ZIP archive. The ready Version is selected interactively when omitted. Existing output files are protected unless --clobber is supplied.",
        after_long_help = "EXAMPLES:\n  shareslices artifact export artifact_123\n  shareslices artifact export artifact_123 --version version_456 --output report.zip\n  shareslices artifact export artifact_123 --output report.zip --clobber --no-progress\n  shareslices artifact export artifact_123 --json artifactId,path --jq '.path'"
    )]
    Export(ArtifactExportArgs),
}

#[derive(Debug, Args)]
pub struct ArtifactExportArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// Version ID to export. Omit only for interactive Version selection.
    #[arg(long, value_name = "VERSION_ID")]
    pub version: Option<String>,
    /// Destination ZIP file. Defaults to a name derived from the Artifact.
    #[arg(short, long, value_name = "FILE")]
    pub output: Option<std::path::PathBuf>,
    /// Replace the destination file if it already exists.
    #[arg(long)]
    pub clobber: bool,
    /// Suppress transfer progress on stderr.
    #[arg(long)]
    pub no_progress: bool,
    /// Emit selected JSON fields: artifactId, versionId, or path.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactDeleteArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// Skip the destructive confirmation prompt. Required non-interactively.
    #[arg(short = 'y', long)]
    pub yes: bool,
}

#[derive(Debug, Subcommand)]
pub enum ArtifactPublicationCommand {
    /// Show the current Publication, Share link, and expiration.
    #[command(
        long_about = "View current Publication metadata, including the Share link, access state, and expiration. This command does not publish or change the Artifact.",
        after_long_help = "EXAMPLES:\n  shareslices artifact publication view artifact_123\n  shareslices artifact publication view artifact_123 --json url,expiresAt,copyEligible"
    )]
    View(ArtifactPublicationViewArgs),
    /// Change the Publication expiration without republishing content.
    #[command(
        long_about = "Edit the active Publication expiration. Use an RFC 3339 timestamp or `never` for no expiration. This command does not change the published Version or Share link.",
        after_long_help = "EXAMPLES:\n  shareslices artifact publication edit artifact_123 --expires-at 2026-12-31T23:59:59Z\n  shareslices artifact publication edit artifact_123 --expires-at never\n  shareslices artifact publication edit artifact_123 --expires-at never --json url,expiresAt"
    )]
    Edit(ArtifactPublicationEditArgs),
}

#[derive(Debug, Args)]
pub struct ArtifactPublicationViewArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// Emit selected JSON fields: artifactId, versionId, publicationState, expiresAt, url, copyEligible.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactPublicationEditArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// New expiration as RFC 3339, or `never` for a permanent link.
    #[arg(long, value_name = "RFC3339_OR_NEVER")]
    pub expires_at: Option<String>,
    /// Emit selected JSON fields: artifactId, versionId, publicationState, expiresAt, url, copyEligible.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactPublishArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// Ready Version ID to publish. Omit only for interactive selection.
    #[arg(long, value_name = "VERSION_ID")]
    pub version: Option<String>,
    /// Expire this Publication after this many seconds. Conflicts with --expires-at.
    #[arg(long, value_name = "SECONDS", conflicts_with = "expires_at")]
    pub duration: Option<u64>,
    /// Expire at an RFC 3339 timestamp. Conflicts with --duration.
    #[arg(long, value_name = "RFC3339", conflicts_with = "duration")]
    pub expires_at: Option<String>,
    /// Generate a new Share link instead of reusing the existing link.
    #[arg(long, requires = "confirm_replace_link")]
    pub replace_link: bool,
    /// Confirm that replacing the link invalidates the previous link.
    #[arg(long, requires = "replace_link")]
    pub confirm_replace_link: bool,
    /// Emit selected JSON fields: artifactId, url, publicationState, expiresAt, copyEligible.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct PublishArgs {
    /// Files, directories, or glob patterns to package. Defaults to the current directory.
    #[arg(value_name = "PATHS", default_value = ".")]
    pub paths: Vec<std::path::PathBuf>,
    /// Base directory for archive-relative paths. Not valid for prepared ZIP input.
    #[arg(long, value_name = "DIRECTORY")]
    pub root: Option<std::path::PathBuf>,
    /// Owner-facing name for the new Artifact.
    #[arg(long, value_name = "NAME")]
    pub name: String,
    /// Relative HTML entry path, such as `index.html`. Required when ambiguous.
    #[arg(long, value_name = "RELATIVE_HTML_PATH")]
    pub entry: Option<String>,
    /// Suppress transfer and processing progress on stderr.
    #[arg(long)]
    pub no_progress: bool,
    /// Expire this Publication after this many seconds. Conflicts with --expires-at.
    #[arg(long, value_name = "SECONDS", conflicts_with = "expires_at")]
    pub duration: Option<u64>,
    /// Expire at an RFC 3339 timestamp. Conflicts with --duration.
    #[arg(long, value_name = "RFC3339", conflicts_with = "duration")]
    pub expires_at: Option<String>,
    /// Generate a new Share link instead of reusing an existing link.
    #[arg(long, requires = "confirm_replace_link")]
    pub replace_link: bool,
    /// Confirm that replacing the link invalidates the previous link.
    #[arg(long, requires = "replace_link")]
    pub confirm_replace_link: bool,
}

#[derive(Debug, Args)]
pub struct ArtifactUnpublishArgs {
    /// Owned Artifact ID. Omit only for interactive selection.
    #[arg(value_name = "ARTIFACT_ID")]
    pub artifact: Option<String>,
    /// Emit selected JSON fields: artifactId, url, publicationState, expiresAt, copyEligible.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
}

#[derive(Debug, Args)]
pub struct ArtifactUploadArgs {
    #[arg(skip)]
    pub agent_mode: bool,
    /// Files, directories, glob patterns, or one prepared ZIP. Defaults to the current directory.
    #[arg(value_name = "PATHS", default_value = ".")]
    pub paths: Vec<std::path::PathBuf>,
    /// Base directory for archive-relative paths. Not valid for prepared ZIP input.
    #[arg(long, value_name = "DIRECTORY")]
    pub root: Option<std::path::PathBuf>,
    /// Create a new Artifact with this owner-facing name. Conflicts with --artifact.
    #[arg(long, conflicts_with = "artifact")]
    pub name: Option<String>,
    /// Add a Version to this owned Artifact ID. Conflicts with --name.
    #[arg(long, conflicts_with = "name")]
    pub artifact: Option<String>,
    /// Relative HTML entry path, such as `index.html`. Required when ambiguous.
    #[arg(long, value_name = "RELATIVE_HTML_PATH")]
    pub entry: Option<String>,
    /// Suppress transfer and processing progress on stderr.
    #[arg(long)]
    pub no_progress: bool,
    /// Emit selected JSON fields: artifact, version, or publication.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
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
    /// Filter by Publication state: published or unpublished.
    #[arg(long, value_enum)]
    pub publication: Option<PublicationFilter>,
    /// Filter by Version processing state: accepted, processing, ready, or failed.
    #[arg(long, value_enum)]
    pub processing: Option<ProcessingFilter>,
    /// Maximum number of Artifacts to return. Must be greater than zero.
    #[arg(short = 'L', long, default_value = "30", value_parser = positive_usize)]
    pub limit: usize,
    /// Emit selected JSON fields: id, name, processingState, publicationState, expiresAt, updatedAt.
    #[arg(long, value_name = "FIELDS")]
    pub json: Option<String>,
    /// Filter JSON with a jq expression. Requires --json; conflicts with --template.
    #[arg(long, requires = "json", conflicts_with = "template")]
    pub jq: Option<String>,
    /// Format JSON with a Go template. Requires --json; conflicts with --jq.
    #[arg(long, requires = "json", conflicts_with = "jq")]
    pub template: Option<String>,
    /// Suppress progress output on stderr.
    #[arg(long)]
    pub no_progress: bool,
}
