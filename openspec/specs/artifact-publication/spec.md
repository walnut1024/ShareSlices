# artifact-publication Specification

## Purpose

TBD - created by archiving change v0-0-1-first-share-flow. Update Purpose after archive.

## Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts in the prototype dashboard and expose only state-valid Preview, Share, Rename, Export, Delete, Retry, and Replace file actions. Analytics and manual Share link revocation SHALL NOT be exposed.

#### Scenario: Owner uses a ready Artifact card

- **WHEN** a signed-in owner opens the Artifact dashboard
- **THEN** a ready Artifact card provides Preview, Share, Rename, Export, and Delete actions as permitted by its state

### Requirement: Use a mutable Artifact name

The system SHALL trim an Artifact name and require 1 through 120 characters. Names SHALL be mutable, SHALL NOT need to be unique for one Owner, and MUST NOT change Artifact ID or Share link identity.

#### Scenario: Owner changes Artifact name

- **WHEN** the owner updates an Artifact with a valid trimmed name
- **THEN** the system changes the owner-facing name without changing Artifact ID, Versions, Publication, or Share link

#### Scenario: Owner reuses an Artifact name

- **WHEN** the owner assigns a name already used by another owned Artifact
- **THEN** the system accepts the duplicate label because Artifact ID remains the identity

#### Scenario: Artifact name is invalid

- **WHEN** the trimmed Artifact name is empty or exceeds 120 characters
- **THEN** the system rejects the update and keeps the previous name

### Requirement: Maintain one active Share link

The system SHALL preserve one stable Share link per Artifact and SHALL let the owner set or clear its expiration. A missing expiration means permanent. Viewer requests after the expiration MUST return the expired-link state. Manual revocation and link rotation are outside this change.

#### Scenario: Owner creates a dated link

- **WHEN** the owner publishes a ready Version with a future expiration
- **THEN** the stable Share link serves that Version until the expiration and then returns the expired-link state

#### Scenario: Owner makes the link permanent

- **WHEN** the owner clears expiration on the active Share link
- **THEN** the link remains active without a time limit and its slug does not change

### Requirement: Preview the ready Version

The system SHALL let the signed-in owner Preview the Artifact's ready Version without changing Publication. Preview SHALL be served from authenticated API Origin routes. Each Preview page and asset request MUST validate the current management session, Artifact ownership, ready-Version state, and normalized manifest path.

Version 0.0.1 MUST NOT create a separate Preview session, grant, expiry policy, or shareable Preview link.

#### Scenario: Owner previews before publication

- **WHEN** the signed-in owner opens Preview for a ready Version
- **THEN** the system renders that Version while the active Share link continues to show the unpublished Viewer state

#### Scenario: User previews another owner's Version

- **WHEN** a signed-in user requests Preview for an Artifact they do not own
- **THEN** the system denies the Preview request

#### Scenario: Owner previews a Version that is not ready

- **WHEN** the owner requests Preview before a ready Version exists
- **THEN** the system rejects the request without exposing staged or raw objects

### Requirement: Publish atomically

The owner SHALL be able to Publish only a ready Version owned by the target Artifact. Publishing SHALL atomically create or replace the current Publication pointer so the active Share link never resolves to a partial or invalid Version.

Publish requests MUST be idempotent for the same owner, Artifact, Version, and idempotency key.

#### Scenario: Owner publishes the ready Version

- **WHEN** the owner publishes the Artifact's ready Version
- **THEN** the system atomically makes that Version current and the active Share link serves it

#### Scenario: Owner repeats Publish

- **WHEN** the owner repeats the same Publish operation with the same idempotency key
- **THEN** the system returns the original publication result without creating a duplicate effective transition

#### Scenario: Owner publishes a non-ready Version

- **WHEN** the owner attempts to publish a Version that is missing, failed, staged, or belongs to another Artifact
- **THEN** the system rejects the operation and leaves the current Publication unchanged

### Requirement: Unpublish and republish

The owner SHALL be able to Unpublish an Artifact by deleting its current Publication without changing the active Share link or immutable Version. Repeating the same delete MUST return the same effective unpublished state. The owner SHALL be able to republish the ready Version through the same Publish behavior.

#### Scenario: Owner unpublishes

- **WHEN** the owner unpublishes a published Artifact
- **THEN** the system removes the current Publication and the unchanged active Share link shows the unpublished status page

#### Scenario: Owner republishes

- **WHEN** the owner publishes the ready Version after Unpublish
- **THEN** the system creates the current Publication again and the unchanged active Share link serves the Version

#### Scenario: Non-owner changes Publication

- **WHEN** a user who does not own the Artifact attempts to Publish or Unpublish it
- **THEN** the system denies the operation and leaves Publication unchanged

### Requirement: Export a ready Artifact

The owner SHALL be able to download a ZIP containing every committed asset of the ready Version with normalized relative paths. Export MUST require a signed-in owner and MUST NOT expose object-storage locations.

#### Scenario: Owner exports ready content

- **WHEN** the owner selects Export for a ready Artifact
- **THEN** the API streams a ZIP named from the Artifact without changing its Version or Publication

### Requirement: Delete an Artifact permanently

The owner SHALL be able to permanently delete an Artifact that is not accepted or processing. Deletion SHALL remove its database resources and make all associated stored objects unavailable. Another user MUST NOT be able to delete it.

#### Scenario: Owner confirms deletion

- **WHEN** the owner confirms Delete for a ready or failed Artifact
- **THEN** the Artifact disappears from management and its Viewer link no longer resolves

#### Scenario: Owner attempts deletion during processing

- **WHEN** the Artifact is accepted or processing
- **THEN** the system rejects deletion without changing the Artifact
