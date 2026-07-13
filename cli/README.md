# ShareSlices CLI

The ShareSlices CLI authenticates a local machine and manages owned Artifacts from a terminal or an agent Skill.

## Implementation status

| Command group | Status |
| --- | --- |
| `auth login`, `auth status`, `auth logout` | Implemented |
| `publish`; `artifact upload`, `delete`, `publish`, `unpublish`, `publication`, `list`, `export` | Implemented |

The Artifact commands in this document define the implemented CLI contract.

## GitHub Releases

The repository publishes a CLI-only GitHub Release when a matching `cli-v<version>` tag is pushed. The tag version must equal `cli/Cargo.toml`'s `shareslices-cli` package version.

Each Release contains these archives and a `SHA256SUMS` file:

| Target | Archive |
| --- | --- |
| macOS Apple Silicon | `shareslices-aarch64-apple-darwin.tar.gz` |
| Linux x86-64 | `shareslices-x86_64-unknown-linux-gnu.tar.gz` |
| Windows x86-64 | `shareslices-x86_64-pc-windows-msvc.zip` |

The archives contain only the native `shareslices` executable. Download a release archive and verify it against `SHA256SUMS` before adding the executable to your `PATH`.

## Install

Every supported installation method downloads and verifies the matching GitHub Release binary. The CLI does not require Rust or Node.js after installation.

### macOS and Linux

```sh
curl -fsSL https://github.com/walnut1024/ShareSlices/releases/latest/download/install.sh | sh
```

The installer supports macOS Apple Silicon and Linux x86-64. It installs to `~/.local/bin` by default; set `SHARESLICES_INSTALL_DIR` or pass `--install-dir` to select another directory. Re-run the same command to update. Install an exact version with `--version`, for example:

```sh
curl -fsSL https://github.com/walnut1024/ShareSlices/releases/latest/download/install.sh | sh -s -- --version <version>
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/walnut1024/ShareSlices/releases/latest/download/install.ps1 | iex"
```

The installer supports Windows x86-64, installs under `%LOCALAPPDATA%\\ShareSlices\\bin`, and adds that directory to the user `PATH` when needed. Use `-Version <version>` with a downloaded script to select an exact version.

### Homebrew

```sh
brew install walnut1024/tap/shareslices
```

The Formula downloads the same checksum-verified GitHub Release archive as the official installers. It supports macOS Apple Silicon and Linux x86-64.

## Design rules

- Every command performs one explicit operation. The CLI does not provide compound commands.
- Required business input is resolved through arguments, flags, documented CLI defaults, or explicit interactive choices. The Server never derives omitted CLI intent.
- In a terminal, missing input opens a prompt. When prompting is disabled or no terminal is available, missing required input fails before any request.
- The CLI sends complete parameters to the Server. The Server validates and executes them.
- A local directory is never implicitly bound to a remote Artifact. Missing Artifact IDs are resolved only by an interactive selector.
- Upload does not Publish. Publish does not change Share-link expiration. Share operations do not change Publication state.
- Human-readable output is the default. Resource commands follow GitHub CLI formatting conventions with `--json <fields>`, `--jq`, and `--template`.
- The Server remains the authoritative validator. Local upload preflight only reports problems earlier.

## Command structure

```text
shareslices
├── publish
├── auth
│   ├── login
│   ├── status
│   └── logout
└── artifact
    ├── upload
    ├── delete
    ├── publish
    ├── unpublish
    ├── publication
    │   ├── view
    │   └── edit
    ├── list
    └── export
```

## Global options

Global options appear before the command group.

```text
shareslices [GLOBAL OPTIONS] <COMMAND>
```

| Option | Value | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--api-url` | URL | No | `SHARESLICES_API_URL`, then `http://127.0.0.1:7456` | Select the ShareSlices API origin. Credentials are stored separately for each origin. |
| `--version` | None | No | — | Print the CLI version and exit. |
| `--help` | None | No | — | Print help for the selected command and exit. |

Environment:

| Variable | Description |
| --- | --- |
| `SHARESLICES_API_URL` | Default API origin when `--api-url` is absent. |
| `SHARESLICES_PROMPT_DISABLED` | Set to any value to disable interactive prompting. |

Command arguments and options override environment values. The CLI sends its version and operating-system identifier on every API request for compatibility checks.

Transfer progress is written to stderr so it never corrupts human-readable or formatted stdout. Upload and Export provide a command-specific `--no-progress`; with it, successful commands remain silent until their final result and failures still write diagnostics to stderr. The official Skill uses `--no-progress` for transfer commands to avoid consuming agent tokens with transient output.

Interactive prompts follow GitHub CLI conventions: omitting input in a terminal starts guided selection; supplying all arguments and flags skips prompts. The official Skill supplies every required value and sets `SHARESLICES_PROMPT_DISABLED=1`.

## Authentication

### `auth login`

Authorize one independent CLI Session through the browser.

```bash
shareslices auth login
shareslices --api-url https://api.example.com auth login
```

Parameters: none.

Behavior:

1. Check the operating-system credential store for the selected API origin.
2. If the stored Session is valid, report the current account and exit successfully.
3. Otherwise request a short-lived verification code.
4. Print the code and verification URL, then attempt to open the browser.
5. Poll at the Server-provided interval until approved, denied, or expired.
6. Store the issued credential only in the operating-system credential store.

The command never asks for an email password. Browser launch failure is not fatal; the printed URL and code remain usable.

### `auth status`

Inspect the CLI Session for the selected API origin.

```bash
shareslices auth status
```

Parameters: none.

Possible results:

- Signed in: print the current account and active Session state.
- Signed out: explain that no credential exists.
- Expired or revoked: remove the invalid local credential and ask the user to log in again.
- Network or Server failure: retain the credential and return an error.

The command does not print the credential or Session ID.

### `auth logout`

Revoke only the current CLI Session.

```bash
shareslices auth logout
```

Parameters: none.

On success, remove the local credential. Browser Sessions and other CLI Sessions remain active. On a network or Server failure, retain the credential so the user can retry.

## Artifact upload and deletion

### `publish`

Package local content, upload it, wait for a ready Version, Publish permanently, and print the resulting Share link:

```sh
shareslices publish ./dist --name "Quarterly report"
```

The command defaults to a permanent Publication and link reuse. It accepts the same `--duration`, `--expires-at`, and confirmed link-replacement options as `artifact publish`. Use the stepwise Artifact commands when an uploaded Version must be inspected before Publish.

### `artifact upload`

Upload local content as a new Artifact or a new immutable Version of an existing Artifact. Upload never publishes content or renames an existing Artifact.

```bash
shareslices artifact upload [<PATHS>...] \
  [--root <DIRECTORY>] \
  [--name <NAME> | --artifact <ARTIFACT_ID>] \
  [--entry <RELATIVE_HTML_PATH>]
```

| Argument or option | Value | Required | Description |
| --- | --- | --- | --- |
| `PATHS` | Local paths or glob patterns | No | Files or directories to package, or one existing `.zip`. Defaults to the current directory. |
| `--root` | Local directory | No | Base for archive-relative paths; defaults to the current directory. Not valid for ZIP input. |
| `--name` | String | Required non-interactively for a new Artifact | Owner-facing name. Defaults from the single source path when safe; otherwise prompt. |
| `--artifact` | Artifact ID | Required non-interactively for an existing Artifact | Existing owned Artifact that receives the new Version. |
| `--entry` | Relative path | Required when ambiguous | HTML entry file. Defaults to root `index.html`, then the only root HTML file. |
| `--no-progress` | None | No | Suppress transfer and processing progress on stderr. |

Rules:

- `--name` creates a new Artifact; `--artifact` uploads to an existing Artifact. They are mutually exclusive.
- In a terminal, omitting both opens a choice between a new Artifact and an existing Artifact selector.
- Multiple files and directories are packaged relative to `--root`. Only selected inputs are included.
- Glob patterns are expanded by the CLI. A pattern with no matches is an error.
- One ZIP is accepted as a complete package and uploaded without repackaging. ZIP input cannot be combined with other paths.
- A single non-ZIP file is packaged alone. The CLI does not collect sibling files automatically.
- `--entry` uses `/` separators, is relative to the package root, and cannot contain `..` or begin with `/`.
- The command waits until the Server commits a ready Version or reports a terminal processing failure.
- A successful upload returns the Artifact ID and ready Version ID. It does not imply external accessibility.
- Transfer progress reports uploaded bytes. Server processing uses an activity indicator unless the Server provides measured progress; the CLI does not invent a percentage.
- Retrying the same interrupted operation replaces the temporary ZIP in its incomplete Upload session and continues that operation.
- A retry never overwrites a ready Version and never creates a second Artifact or Version for the same operation.

Packaging:

- Package a single directory's contents at the ZIP root; do not add the source directory as a wrapper.
- Preserve paths relative to `--root` for multiple selected inputs.
- Preserve normalized relative paths.
- Sort entries by normalized path for deterministic output.
- Ignore known operating-system metadata such as `.DS_Store` and `__MACOSX`.
- Reject symbolic links, special files, nested archives, absolute paths, and parent traversal.
- Stream compression through a temporary ZIP and remove it after the request completes or fails.
- Do not rewrite HTML, CSS, JavaScript, or asset references.

Examples:

```bash
# Upload a directory as a new Artifact.
shareslices artifact upload ./dist \
  --name "Quarterly report" \
  --entry index.html

# Upload an existing ZIP without repackaging it.
shareslices artifact upload ./quarterly-report.zip \
  --name "Quarterly report" \
  --entry report.html

# Upload another Version without publishing it.
shareslices artifact upload ./dist \
  --artifact artifact_123 \
  --entry index.html

# Package only selected content from a mixed directory.
shareslices artifact upload index.html assets images/logo.png \
  --root . \
  --name "Quarterly report" \
  --entry index.html
```

### `artifact delete`

Permanently delete one Artifact and all associated Versions, Publication, Share link, and stored objects.

```bash
shareslices artifact delete [<ARTIFACT_ID>]
shareslices artifact delete <ARTIFACT_ID> --yes
```

| Argument or option | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact to delete permanently. When omitted in a terminal, select an Artifact. |
| `--yes` | None | Required non-interactively | Skip the destructive-operation confirmation. |

The command prompts for confirmation unless an explicit Artifact ID and `--yes` are both present. For safety, `--yes` is ignored when the Artifact ID is omitted. The command refuses deletion while the Artifact is accepted or processing. Confirmation does not bypass ownership or state validation.

## Publication

### `artifact publish`

Make one explicit ready Version accessible to people with the Share link.

```bash
shareslices artifact publish [<ARTIFACT_ID>] [--version <VERSION_ID>] \
  [--duration <SECONDS> | --expires-at <RFC3339>] \
  [--replace-link --confirm-replace-link]
```

| Argument or option | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact whose Publication is updated. When omitted in a terminal, select an Artifact. |
| `--version` | Version ID | Required non-interactively | Ready Version to publish. When omitted in a terminal, select a ready Version. |

The first Publish defaults to permanent access and creates the Share link. Later Publish operations reuse the link by default. `--duration` starts a positive relative duration at Publish time; `--expires-at` selects an exact future instant. Replacing a distributed link is irreversible, so `--replace-link` requires `--confirm-replace-link`.

### `artifact unpublish`

Prevent Owner-external access through the stable Share link.

```bash
shareslices artifact unpublish [<ARTIFACT_ID>]
```

| Argument | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact to unpublish. When omitted in a terminal, select an Artifact. |

Unpublish ends the current Publication early but preserves the Artifact, Versions, and stable Share link. Repeating the command has the same result. Owner Preview remains a separate authenticated operation.

## Share link

Publication commands read the effective state and manage the current Publication expiration. They never select another Version or replace the link.

External access requires both conditions:

```text
Artifact is published AND Share link is not expired
```

### `artifact publication view`

Read the stable Share link and its current access state.

```bash
shareslices artifact publication view [<ARTIFACT_ID>]
```

| Argument | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact whose Share link is returned. When omitted in a terminal, select an Artifact. |

Output reports `not_published`, `published`, `expired`, or `unpublished`, a nullable URL, expiration, and Copy eligibility. Expired and Unpublished states preserve the URL but disable Copy.

### `artifact publication edit`

Set an explicit expiration time on the stable Share link.

```bash
shareslices artifact publication edit [<ARTIFACT_ID>] \
  --expires-at <RFC3339_TIMESTAMP_OR_NEVER>
```

| Argument or option | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact whose Share link is updated. When omitted in a terminal, select an Artifact. |
| `--expires-at` | RFC 3339 timestamp or `never` | Required non-interactively | Future expiration instant including a timezone offset or `Z`; `never` clears expiration. |

Example:

```bash
shareslices artifact publication edit artifact_123 \
  --expires-at 2026-08-01T23:59:59+08:00

shareslices artifact publication edit artifact_123 --expires-at never
```

Expiration changes do not Publish, Unpublish, select a Version, or replace the Share link.

## Artifact list

### `artifact list`

List owned Artifacts without changing them.

```bash
shareslices artifact list
shareslices artifact list --publication published
shareslices artifact list --processing failed
```

| Option | Value | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `--publication` | `published` or `unpublished` | No | All | Filter by Owner-external access state. |
| `--processing` | `accepted`, `processing`, `ready`, or `failed` | No | All | Filter by latest Version processing state. |
| `-L`, `--limit` | Positive integer | No | `30` | Maximum number of Artifacts to return. |

The two filters may be combined. Human-readable output includes Artifact ID, name, processing state, Publication state, Share-link expiration, and last modification time. JSON output contains only fields selected with `--json`.

The CLI follows Server pagination internally until it reaches `--limit` or exhausts the result set. It does not expose a page token in the first version.

## Export

### `artifact export`

Download one explicit ready Version as a normalized ZIP without changing Server state.

```bash
shareslices artifact export [<ARTIFACT_ID>] \
  [--version <VERSION_ID>] \
  [--output <FILE_PATH>] \
  [--clobber] \
  [--no-progress]
```

| Argument or option | Value | Required | Description |
| --- | --- | --- | --- |
| `ARTIFACT_ID` | Artifact ID | Required non-interactively | Artifact to export. When omitted in a terminal, select an Artifact. |
| `--version` | Version ID | Required non-interactively | Ready Version to download. When omitted in a terminal, select a ready Version. |
| `--output` | Local file path | No | Destination `.zip`; defaults to `<artifact-name>-<version-id>.zip` in the current directory. |
| `--clobber` | None | No | Overwrite an existing output file. |
| `--no-progress` | None | No | Suppress download progress on stderr. |

Without `--clobber`, the command refuses to overwrite an existing file. Export works for Published and Unpublished Artifacts and never exposes object-storage URLs or changes Server state.

## Formatting output

Commands that return resource data follow GitHub CLI formatting conventions:

| Option | Value | Description |
| --- | --- | --- |
| `--json` | Comma-separated field names | Return only the selected fields as JSON. |
| `--jq` | jq expression | Filter JSON output. Requires `--json`. |
| `--template` | Go template | Format selected JSON fields. Requires `--json`. |

Default output is concise human-readable text. Agents and scripts select the exact fields they consume. Progress and diagnostics are written to stderr and never corrupt formatted stdout. Secrets, Cookies, credential paths, and Session IDs are never available as JSON fields.

Examples:

```bash
shareslices artifact list \
  --json id,name,processingState,updatedAt \
  --jq '.[].id'
```

Example upload result:

```json
{
  "artifact": {
    "id": "artifact_123",
    "name": "Quarterly report"
  },
  "version": {
    "id": "version_789",
    "state": "ready"
  },
  "publication": null
}
```

Example Share result:

```json
{
  "artifactId": "artifact_123",
  "url": "https://view.example.com/a/example/",
  "publicationState": "unpublished",
  "expiresAt": null,
  "accessState": "not accessible"
}
```

Errors use stable machine-readable codes and a user-actionable message on stderr. Failure is represented by a non-zero exit status; commands do not emit a success-shaped JSON document on failure.

## Exit codes

The CLI follows GitHub CLI exit-code conventions:

| Code | Meaning |
| --- | --- |
| `0` | Command completed successfully. |
| `1` | Command failed. |
| `2` | Command was cancelled. |
| `4` | Authentication is required. |

A command may document an additional exit code only when callers need to distinguish a stable domain state.

## Failure and recovery behavior

- Missing required parameters fail locally before any request.
- Invalid credentials direct the user to `shareslices auth login`.
- Unsupported CLI versions stop before authorization or an authenticated mutation.
- Upload preflight failures identify the violated constraint and provide corrective guidance when
  known. Individual errors do not guarantee separate path, actual-value, and allowed-value fields.
- Interrupted transfers retry only through idempotent Server operations.
- An interrupted transfer can replace the temporary ZIP only within the same incomplete Upload session.
- Once the ZIP is complete, Server processing continues if the CLI stops waiting.
- A ready Version is immutable and is never overwritten by retry behavior.
- Publish failure does not delete the uploaded Version or change the previous Publication.
- Network failure during Delete is reported as indeterminate until the caller checks the Artifact list; the CLI does not repeat destructive requests without an idempotency guarantee.
- Ctrl-C stops local work. It does not claim that an already accepted Server operation was rolled back.

## Security

- Credentials are stored only in the operating-system credential store.
- The CLI never accepts an email password.
- Artifact ownership and every state transition are validated by the Server.
- Local packaging and preflight are not security boundaries.
- Raw Artifact content, credentials, Cookies, Share slugs, and archive entry contents are not written to logs.
- Delete confirmation does not weaken Server authorization.
