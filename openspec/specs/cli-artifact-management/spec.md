# cli-artifact-management Specification

## Purpose

Define the stable ShareSlices CLI contract for listing, uploading, publishing, sharing, exporting, and deleting owned Artifacts.

## Requirements

### Requirement: List owned Artifacts with stable output

The CLI SHALL list only Artifacts owned by the current user, SHALL default to a bounded result count, and SHALL support Publication and processing filters. Human output SHALL be the default; `--json <fields>`, `--jq`, and `--template` MUST expose only documented selectable fields.

#### Scenario: Agent requests filtered JSON

- **WHEN** an authenticated caller runs `shareslices artifact list` with filters and selected JSON fields
- **THEN** the CLI follows Server pagination up to the requested limit and emits only those fields without transient progress on stdout

### Requirement: Upload explicit local content

The CLI SHALL accept one prepared ZIP unchanged or deterministically package selected non-ZIP files and directories before upload. Creating an Artifact MUST require a name; uploading a new Version MUST require an explicit or interactively selected Artifact and MUST NOT create an implicit local binding.

#### Scenario: Upload prepared ZIP as a new Artifact

- **WHEN** the caller supplies one readable ZIP and `--name`
- **THEN** the CLI transfers that ZIP without repackaging and waits until the Server reports a ready Version or terminal failure

#### Scenario: Package selected local inputs

- **WHEN** the caller supplies non-ZIP files, directories, or expanded glob inputs under one root
- **THEN** the CLI creates a deterministic temporary ZIP containing only those inputs, excluding known operating-system metadata and rejecting links, special files, traversal, nested archives, and ambiguous roots

#### Scenario: Upload a new Version

- **WHEN** the caller supplies `--artifact <id>` or selects an owned Artifact interactively
- **THEN** the CLI uploads a new immutable Version without sending a new Artifact name and waits for the Version result

### Requirement: Report transfer and processing progress safely

The CLI SHALL show transfer and Server-processing progress on stderr by default and SHALL suppress transient progress when `--no-progress` is set. Server acceptance alone MUST NOT be reported as successful completion.

#### Scenario: Agent suppresses progress

- **WHEN** the caller uses `--no-progress`
- **THEN** the CLI emits no transient progress while preserving the final result and exit status

#### Scenario: Upload is interrupted after acceptance

- **WHEN** the caller interrupts after the Server accepted the upload but before processing completes
- **THEN** the CLI reports the accepted Artifact and Upload session without claiming a ready Version or overwriting an existing ready Version

### Requirement: Publish and Unpublish atomically

The CLI SHALL Publish an explicit or interactively selected ready Version of the target Artifact with permanent, relative-duration, or exact future-time policy. Publish SHALL return the effective Publication status and Share link. Unpublish SHALL end only the accessible Publication, remain idempotent, and preserve the Artifact, Versions, and non-retired Share link.

#### Scenario: Publish an explicit ready Version

- **WHEN** an authenticated Owner runs `artifact publish` with an Artifact and one of its ready Versions
- **THEN** the Server atomically creates the Publication and effective Share link and the CLI reports both

#### Scenario: Repeat Unpublish

- **WHEN** the Owner runs `artifact unpublish` while the Artifact is already Unpublished
- **THEN** the command succeeds with the same effective state and does not replace the Share link

### Requirement: View and edit the stable Share link

The CLI SHALL expose Share-link URL and Copy eligibility as part of Publication output rather than as a separate Share lifecycle. `artifact publication view` SHALL report Not published, Published, Expired, or Unpublished and return the stable URL when one exists. `artifact publication edit` SHALL accept only a future RFC 3339 instant or `never`, MUST NOT select another Version, and MUST NOT replace the link.

The CLI MUST NOT provide `artifact share view` or `artifact share edit` commands after this change.

#### Scenario: View an inaccessible retained link

- **WHEN** the Owner views Publication state for an Expired or Unpublished Artifact
- **THEN** the CLI returns the stable URL, reports why external access is unavailable, and marks Copy unavailable

#### Scenario: Make the Publication permanent

- **WHEN** the Owner runs `artifact publication edit --expires-at never` for a Published Artifact
- **THEN** the Server clears Publication expiration while preserving its Version, Share URL, and Published state

#### Scenario: View an Artifact before first Publish

- **WHEN** the Owner views Publication state for a newly uploaded Artifact with no legacy reserved link
- **THEN** the CLI reports Not published without returning a Share URL

### Requirement: Export an explicit ready Version atomically

The CLI SHALL export only an explicit or interactively selected ready Version owned by the target Artifact. It SHALL choose a safe Artifact-name-and-Version ZIP filename by default, write through a same-directory temporary file, and MUST refuse replacement unless `--clobber` is explicit.

#### Scenario: Export without overwrite

- **WHEN** the destination does not exist and the owner selects a ready Version
- **THEN** the CLI downloads the complete normalized ZIP and atomically installs it at the destination

#### Scenario: Destination already exists

- **WHEN** the destination exists and `--clobber` is absent
- **THEN** the CLI fails before downloading and preserves the existing file

### Requirement: Delete an Artifact safely

The CLI SHALL require confirmation before permanent deletion. Confirmation MAY be skipped only when the caller supplies both an explicit Artifact ID and `--yes`; selecting an Artifact interactively MUST still require confirmation. Cancellation MUST perform no DELETE and return exit code 2.

#### Scenario: Explicit confirmed deletion

- **WHEN** the owner supplies an explicit Artifact ID with `--yes` and the Artifact is not accepted or processing
- **THEN** the Server permanently removes its management graph and records resumable cleanup for raw, staging, and committed objects

#### Scenario: Delete is blocked during processing

- **WHEN** the owner attempts to delete an accepted or processing Artifact
- **THEN** the Server returns `invalid_artifact_state`, preserves the Artifact and objects, and the CLI explains the conflict

#### Scenario: Delete outcome is uncertain

- **WHEN** the DELETE request fails in transport or returns a Server error after transmission
- **THEN** the CLI does not automatically retry and reports that the outcome is indeterminate

### Requirement: Keep automation deterministic and authenticated

Every Artifact API request from the CLI MUST use the browser-authorized credential from the operating-system credential store and send CLI version and operating-system metadata. When prompts are unavailable, commands MUST require all decision-relevant identifiers and values explicitly. Exit codes SHALL be 0 for success, 1 for failure, 2 for cancellation, and 4 when authentication is required.

#### Scenario: Non-interactive input is incomplete

- **WHEN** prompts are disabled or stdin is not a terminal and a command omits a required Artifact, Version, expiration, or confirmation decision
- **THEN** the CLI fails locally without waiting for input or mutating Server state

#### Scenario: CLI Session is unavailable

- **WHEN** an Artifact command has complete local input but no valid stored CLI Session
- **THEN** the CLI instructs the user to run `shareslices auth login`, prints no credential, and exits with code 4

### Requirement: Publish local content through one high-level command

The CLI SHALL provide a high-level `shareslices publish` command that deterministically packages selected local content when needed, uploads it, waits for a ready Version, Publishes it, and returns the effective Publication and Share link. The command SHALL default to permanent Publication and link reuse while accepting explicit relative duration, exact future expiration, and confirmed link replacement options.

The high-level command MUST orchestrate the same Server APIs and validation used by stepwise commands and MUST NOT make accepted or processing content externally accessible.

#### Scenario: Agent publishes local content with defaults

- **WHEN** an authenticated caller runs `shareslices publish` with valid local content and the required Artifact name
- **THEN** the CLI uploads, waits for ready, Publishes permanently, and emits the resulting stable Share link

#### Scenario: Processing fails before Publish

- **WHEN** Upload reaches a terminal processing failure during high-level Publish
- **THEN** the CLI reports the failed Artifact and Version outcome without creating a Publication or Share link

#### Scenario: Caller replaces a link non-interactively

- **WHEN** a non-interactive caller requests link replacement without the explicit irreversible-confirmation option
- **THEN** the CLI fails locally without mutating Publication or link state
