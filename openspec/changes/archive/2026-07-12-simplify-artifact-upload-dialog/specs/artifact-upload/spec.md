# artifact-upload delta specification

## MODIFIED Requirements

### Requirement: Create the first Artifact from a ZIP

The system SHALL let a signed-in user submit an Artifact name and one ZIP for a new Artifact. The ShareSlices Web UI SHALL ask the user only for the ZIP and SHALL derive the submitted Artifact name from the selected filename by removing the final case-insensitive `.zip` extension, trimming the result, and limiting it to 120 characters. Other clients MAY continue to submit an explicit valid Artifact name. The API MUST stream the ZIP to private object storage and enforce the snapshotted archive-size limit without loading the full body into memory.

The system SHALL create the Artifact, its active Share link, its Upload session, and its processing job only after the complete raw ZIP is durably stored. A rejected, interrupted, or incomplete transfer MUST NOT create an Artifact.

#### Scenario: Web user selects a ZIP

- **WHEN** a signed-in Web user selects a complete ZIP named `quarterly-report.zip` within the archive-size limit
- **THEN** the Web submits `quarterly-report` as the Artifact name and the system durably stores the raw ZIP, creates the Artifact and active Share link, creates the Upload session and processing job, and returns an accepted processing result

#### Scenario: Another client supplies a valid name

- **WHEN** a signed-in non-Web client submits a valid Artifact name and a complete ZIP within the archive-size limit
- **THEN** the system uses the supplied name, durably stores the raw ZIP, creates the Artifact and active Share link, creates the Upload session and processing job, and returns an accepted processing result

#### Scenario: Transfer is interrupted

- **WHEN** the ZIP transfer ends before the complete body is durably stored
- **THEN** the system creates no Artifact, Version, Share link, or processing job for that transfer

#### Scenario: ZIP exceeds the archive limit

- **WHEN** the streamed ZIP exceeds the Upload session archive-size limit
- **THEN** the system stops accepting the body and creates no Artifact or Version
