# artifact-upload Specification

## Purpose

TBD - created by archiving change v0-0-1-first-share-flow. Update Purpose after archive.

## Requirements

### Requirement: Discover the active upload policy

The system SHALL expose the active database-backed Artifact upload policy to signed-in users for optional client preflight. The response SHALL include an opaque policy revision and every limit needed to check a ZIP before transfer, including archive size, expanded size, regular-file count, single-file size, and enabled file extensions.

#### Scenario: Signed-in client reads the policy

- **WHEN** a signed-in client requests the active Artifact upload policy
- **THEN** the system returns the complete active policy and its opaque revision

#### Scenario: Client skips preflight

- **WHEN** a signed-in client uploads without first requesting the active policy
- **THEN** the server still evaluates the upload using its authoritative policy

#### Scenario: Anonymous client requests the policy

- **WHEN** a client without a valid management session requests the active upload policy
- **THEN** the system rejects the management API request

### Requirement: Snapshot policy for each Upload session

The system SHALL store the policy revision and immutable validation values used by each accepted Upload session. The API and Worker MUST enforce that same snapshot, and later database configuration changes SHALL affect only newly accepted Upload sessions.

#### Scenario: Policy changes during processing

- **WHEN** the active database policy changes after an Upload session is accepted but before its processing completes
- **THEN** the Worker validates that Upload session with its original policy snapshot

#### Scenario: New upload follows the new policy

- **WHEN** an upload is accepted after a database policy change
- **THEN** its Upload session snapshots the new policy revision and values

### Requirement: Create the first Artifact from a ZIP

The system SHALL let a signed-in user submit an Artifact name and one ZIP for a new Artifact. The API MUST stream the ZIP to private object storage and enforce the snapshotted archive-size limit without loading the full body into memory.

The system SHALL create the Artifact, its Upload session, and its processing job only after the complete raw ZIP is durably stored. It MUST NOT create or return a Share link before the Artifact's first Publish. A rejected, interrupted, or incomplete transfer MUST NOT create an Artifact.

#### Scenario: Initial upload is accepted

- **WHEN** a signed-in user submits an Artifact name and a complete ZIP within the archive-size limit
- **THEN** the system durably stores the raw ZIP, creates the Artifact, Upload session, and processing job without a Share link, and returns an accepted processing result

#### Scenario: Transfer is interrupted

- **WHEN** the ZIP transfer ends before the complete body is durably stored
- **THEN** the system creates no Artifact, Version, Share link, or processing job for that transfer

#### Scenario: ZIP exceeds the archive limit

- **WHEN** the streamed ZIP exceeds the Upload session archive-size limit
- **THEN** the system stops accepting the body and creates no Artifact or Version

### Requirement: Make initial creation idempotent

The system SHALL use the signed-in user, initial Artifact creation operation, and caller-supplied idempotency key to collapse repeated submissions into one durable result. The system SHALL compute ZIP identity as SHA-256 while streaming and SHALL compare the trimmed Artifact name plus ZIP SHA-256 when determining whether completed input is the same.

#### Scenario: Caller repeats an accepted creation

- **WHEN** the same user repeats initial Artifact creation with the same idempotency key
- **THEN** the system returns the original operation result without creating another Artifact, Upload session, processing job, or Share link

#### Scenario: Idempotency key is reused for different input

- **WHEN** the same user reuses an initial Artifact creation idempotency key with a different Artifact name or ZIP identity
- **THEN** the system rejects the conflicting reuse without changing the original result

### Requirement: Validate and expand accepted archives

The Worker SHALL validate each accepted ZIP against its Upload session policy snapshot and derive an effective archive from safe regular entries. It SHALL ignore only explicitly supported operating-system metadata after path safety checks. If all effective files share one top-level wrapper directory, it SHALL remove that one directory when doing so preserves every relative path and creates no empty or duplicate path.

A valid effective archive MUST contain an unambiguous root HTML entry. The Worker SHALL prefer a root `index.html`; when it is absent and exactly one root HTML file exists, the Worker SHALL use that file without rewriting it. The Worker MUST reject missing or ambiguous root entries, unsafe or absolute paths, parent traversal, links, special files, nested archives, unsupported file extensions, invalid checked signatures, and any effective size or count that exceeds the snapshot.

The seeded default policy SHALL use the product limits owned by `PRODUCT.md`.

#### Scenario: macOS metadata does not block a valid Artifact

- **WHEN** a safe ZIP contains one valid root HTML file plus `__MACOSX/`, AppleDouble, or `.DS_Store` metadata
- **THEN** the Worker ignores the metadata, uses the only root HTML as the entry, commits no metadata asset, and records normalization warnings

#### Scenario: One wrapper directory is removed

- **WHEN** every effective file is below the same top-level directory and removing it creates safe unique paths
- **THEN** the Worker removes that directory once and preserves the relative relationships among all effective files

#### Scenario: Root index remains preferred

- **WHEN** the effective archive contains root `index.html` and other root HTML files
- **THEN** the Worker uses `index.html` as the entry without treating the other HTML files as ambiguity

#### Scenario: Only one named root HTML exists

- **WHEN** the effective archive has no root `index.html` and contains exactly one root HTML file
- **THEN** the Worker records that file as the entry without renaming or rewriting it and records `entry_file_inferred`

#### Scenario: Entry candidates are ambiguous

- **WHEN** the effective archive has no root `index.html` and contains multiple root HTML files
- **THEN** the Worker rejects the archive with `ambiguous_entry_file` and identifies the bounded candidate list

#### Scenario: Root entry is missing

- **WHEN** the effective archive contains no root HTML file
- **THEN** the Worker rejects it with `missing_entry_file` and identifies bounded nested HTML candidates when available

#### Scenario: Metadata-shaped unsafe path is rejected

- **WHEN** an entry has an unsafe path that otherwise resembles supported operating-system metadata
- **THEN** the Worker rejects the archive before metadata filtering

### Requirement: Report asynchronous processing state

The system SHALL expose the current Upload session state and a structured validation report to the Artifact owner. Processing states MUST distinguish accepted, processing, ready, and failed outcomes.

A blocking validation item SHALL contain a stable code, safe message, user-actionable correction, and structured details appropriate to the violation. Details SHALL identify the affected normalized path, candidates, expected format, actual value, allowed value, or count whenever available. A non-blocking normalization SHALL be exposed as a structured warning. Reports MUST be bounded and MUST NOT expose object keys, raw exceptions, stack traces, credentials, or Share slugs.

The system SHALL preserve the mapping from each immutable raw ZIP source path to its effective normalized path. Extraction MUST read the source path, while staging, manifests, management details, Preview, and Viewer routing MUST use the effective path.

#### Scenario: Owner reads a file-content failure

- **WHEN** a file's content does not match its enabled format rule
- **THEN** the Artifact detail returns `invalid_file_content` with the affected path, expected validation kind, and corrective action

#### Scenario: Owner reads a size-limit failure

- **WHEN** an archive, expanded archive, or effective file exceeds its snapshotted limit
- **THEN** the Artifact detail returns the matching stable code with actual and allowed byte values where both are known

#### Scenario: Owner reads a format failure

- **WHEN** an effective file has an unsupported or disabled extension
- **THEN** the Artifact detail returns `unsupported_format` with the affected path and extension

#### Scenario: Owner reads normalization warnings

- **WHEN** processing safely ignores metadata, removes a wrapper directory, or infers the only entry file
- **THEN** the Artifact detail exposes the corresponding warnings without changing a successful ready outcome into a failure

#### Scenario: Wrapper normalization preserves extraction

- **WHEN** the Worker removes one common wrapper directory from effective paths
- **THEN** it reads bytes from each original ZIP source path and stores them under the corresponding effective path

#### Scenario: API rejects archive size before creating an Artifact

- **WHEN** the streamed raw ZIP crosses the archive-size limit before an Artifact or Upload session is created
- **THEN** the API returns `archive_too_large` with the allowed byte value and a corrective action in the synchronous error response
- **AND** the API does not claim that the first over-limit byte count is the complete archive size

### Requirement: Retry recoverable processing failures

The Worker SHALL classify processing failures with stable reason codes and SHALL centralize retry scheduling in a processing retry policy. Deterministic validation failures MUST NOT retry automatically. Transient classified failures SHALL receive at most three automatic processing attempts. An unclassified error SHALL receive one conservative automatic retry before becoming a recoverable failed state.

Every retry decision MUST emit the structured diagnostic fields required by `AGENTS.md`, including attempt context, a stable reason code, and sanitized exception evidence.

#### Scenario: Transient failure succeeds on retry

- **WHEN** a classified transient dependency failure occurs and a later allowed attempt succeeds
- **THEN** the system commits exactly one ready Version and records each attempt and retry reason

#### Scenario: Classified retries are exhausted

- **WHEN** a classified transient failure continues through the maximum automatic attempts
- **THEN** the system leaves the Upload session in a recoverable failed state and retains the original raw ZIP for manual Retry

#### Scenario: Unclassified failure repeats

- **WHEN** an unclassified processing error occurs and the single conservative retry also fails
- **THEN** the system records `unclassified_error` with sanitized exception evidence and leaves the Upload session in a recoverable failed state

### Requirement: Recover before the first ready Version

The owner SHALL be able to Retry a recoverable processing failure against the retained raw ZIP or Replace file after a deterministic file failure. Retry and Replace file SHALL be available only while the Artifact has no ready Version and MUST be idempotent for their operation scope and caller-supplied idempotency key.

#### Scenario: Owner manually retries retained input

- **WHEN** automatic processing attempts are exhausted and the owner selects Retry
- **THEN** the system queues a new processing attempt against the retained raw ZIP without creating another Artifact or Upload session

#### Scenario: Owner repeats manual Retry

- **WHEN** the owner repeats the same manual Retry with the same idempotency key
- **THEN** the system returns the original Retry result and does not queue another effective processing attempt

#### Scenario: Owner replaces an invalid file

- **WHEN** deterministic validation fails and the owner submits a replacement ZIP
- **THEN** the system creates a new Upload session for the same Artifact and processes the replacement under a new policy snapshot

#### Scenario: Owner repeats Replace file

- **WHEN** the owner repeats Replace file for the same stable Artifact ID with the same idempotency key and ZIP SHA-256
- **THEN** the system returns the original replacement result without creating another Upload session or processing job

#### Scenario: Owner attempts a second ready Version

- **WHEN** the Artifact already has its first ready Version and the owner attempts Retry, Replace file, or another upload
- **THEN** the system rejects the operation because additional Versions are outside version 0.0.1

### Requirement: Retain raw input needed for recovery

The system SHALL retain the raw ZIP referenced by the current retryable failed Upload session while the Artifact has no ready Version. Version 0.0.1 MUST NOT expire that current retryable input by age.

Accepting Replace file SHALL make the replaced raw ZIP eligible for deletion. Committing the first ready Version SHALL make all raw ZIPs and staging objects for that Artifact eligible for deletion. Reconciliation MUST NOT delete the raw ZIP referenced by the current retryable failed Upload session.

#### Scenario: Failed input remains retryable

- **WHEN** processing reaches a recoverable failed state and no ready Version exists
- **THEN** the referenced raw ZIP remains available for manual Retry without a time-based expiry

#### Scenario: Replacement supersedes failed input

- **WHEN** the owner successfully submits Replace file
- **THEN** the previously referenced raw ZIP becomes eligible for bounded reconciliation cleanup

#### Scenario: Ready Version commits

- **WHEN** the first ready Version commits atomically
- **THEN** every raw ZIP and attempt staging object for that Artifact becomes eligible for bounded reconciliation cleanup

#### Scenario: Orphan object has no database reference

- **WHEN** Reconciliation finds a raw or staging object that no Upload session or processing attempt references
- **THEN** it removes the orphan without changing a retryable Upload session

### Requirement: Keep client preflight aligned with authoritative validation

The system SHALL expose the active policy values needed for Web and future CLI preflight. Client preflight MAY reject input before transfer and MAY present the same stable validation codes, but it MUST NOT replace authoritative API and Worker enforcement. The Worker MUST validate every accepted archive against its Upload session policy snapshot regardless of client behavior.

Representative checked fixtures SHALL define expected normalization and validation reports across runtimes that implement client preflight.

#### Scenario: Web catches a problem before upload

- **WHEN** Web preflight detects a policy violation
- **THEN** Web presents the affected file and corrective action without uploading the ZIP

#### Scenario: Client skips or bypasses preflight

- **WHEN** a CLI or direct API client submits a ZIP without matching preflight
- **THEN** the API and Worker still enforce the complete authoritative validation path

#### Scenario: Client and Worker classify the same fixture

- **WHEN** a checked conformance fixture is evaluated by multiple validation implementations
- **THEN** they produce the same stable issue codes and detail meanings for the rules each implementation supports

### Requirement: Adapt a single HTML file for Web upload

The ShareSlices Web UI SHALL let a signed-in user select or drop one ZIP, `.html`, or `.htm` file when creating an Artifact. When the selected file is HTML, the Web UI MUST package its unchanged bytes as a ZIP containing exactly one root `index.html` before applying ZIP preflight and submitting the existing Artifact creation request. The Web UI SHALL derive the initial Artifact name from the user-selected filename, not the generated ZIP filename.

The Web UI MUST describe single-file HTML input as self-contained and MUST NOT claim to collect local files referenced by the HTML. The API and Worker SHALL continue to receive ZIP input only.

#### Scenario: Web user selects self-contained HTML

- **WHEN** a signed-in Web user selects a non-empty `quarterly-report.html`
- **THEN** the Web UI derives the Artifact name `quarterly-report`, packages the file bytes as root `index.html`, applies ZIP preflight to the generated archive, and submits it through the existing ZIP creation request

#### Scenario: Web user selects an HTM file

- **WHEN** a signed-in Web user selects a non-empty `status.htm`
- **THEN** the Web UI derives the Artifact name `status` and handles the file as self-contained HTML input

#### Scenario: Web user selects a ZIP

- **WHEN** a signed-in Web user selects a ZIP
- **THEN** the Web UI preserves the selected ZIP bytes and existing ZIP upload behavior
