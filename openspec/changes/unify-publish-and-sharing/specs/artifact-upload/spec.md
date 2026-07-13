# artifact-upload delta specification

## MODIFIED Requirements

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
