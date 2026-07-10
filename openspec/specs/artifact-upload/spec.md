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

The system SHALL create the Artifact, its active Share link, its Upload session, and its processing job only after the complete raw ZIP is durably stored. A rejected, interrupted, or incomplete transfer MUST NOT create an Artifact.

#### Scenario: Initial upload is accepted

- **WHEN** a signed-in user submits an Artifact name and a complete ZIP within the archive-size limit
- **THEN** the system durably stores the raw ZIP, creates the Artifact and active Share link, creates the Upload session and processing job, and returns an accepted processing result

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
- **THEN** the system returns the original operation result without creating another Artifact, Share link, Upload session, or processing job

#### Scenario: Idempotency key is reused for different input

- **WHEN** the same user reuses an initial Artifact creation idempotency key with a different Artifact name or ZIP identity
- **THEN** the system rejects the conflicting reuse without changing the original result

#### Scenario: Original creation is still in progress

- **WHEN** the same user repeats initial Artifact creation with the same idempotency key while the original request is still accepting or committing input
- **THEN** the system returns `operation_in_progress` and starts no second transfer, Upload session, or processing job

#### Scenario: Original transfer is interrupted

- **WHEN** an initial transfer ends before creating an Artifact or Upload session
- **THEN** the system releases the pending idempotency key so the caller can retry the same operation

### Requirement: Validate and expand accepted archives

The Worker SHALL validate each accepted ZIP against its Upload session policy snapshot. A valid archive MUST contain `index.html` at its root and only supported regular files. The Worker MUST reject unsafe or absolute paths, parent traversal, links, special files, nested archives, unsupported file extensions, invalid checked signatures, and any expanded size or count that exceeds the snapshot.

The seeded default policy SHALL use the product limits owned by `PRODUCT.md`.

#### Scenario: Valid document Artifact reaches Ready

- **WHEN** the Worker processes a ZIP with a root `index.html`, supported files, safe paths, and expanded values within every snapshotted limit
- **THEN** it stores committed files and a manifest, creates one immutable ready Version, and marks the Upload session committed

#### Scenario: Root entry file is missing

- **WHEN** the Worker processes a ZIP without `index.html` at the archive root
- **THEN** it records a deterministic validation failure and creates no Version

#### Scenario: Archive violates a snapshotted limit

- **WHEN** expansion exceeds the snapshotted expanded size, regular-file count, or single-file size
- **THEN** the Worker stops processing, records the matching validation failure, and exposes no staged file through Preview or Viewer routes

#### Scenario: Archive contains an unsafe entry

- **WHEN** the ZIP contains path traversal, an absolute path, a link, a special file, a nested archive, or an unsupported format
- **THEN** the Worker records a deterministic validation failure and commits no Version

### Requirement: Report asynchronous processing state

The system SHALL expose the current Upload session state and a user-actionable failure summary to the Artifact owner. Processing states MUST distinguish accepted, processing, ready, and failed outcomes.

#### Scenario: Owner reads processing progress

- **WHEN** the owner opens the Artifact detail while its first upload is accepted or processing
- **THEN** the system returns the current processing state without reporting a ready Version

#### Scenario: Owner reads deterministic failure

- **WHEN** processing fails archive or content validation
- **THEN** the Artifact detail identifies that the file must be replaced and returns a user-actionable failure summary

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
