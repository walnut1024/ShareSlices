# Artifact publication delta specification

## ADDED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL let a signed-in user list Artifacts they own and open an owned Artifact detail. Management responses MUST NOT expose another user's Artifact.

The detail SHALL include the Artifact name, first-upload processing state, ready Version state when present, publication state, active Share link, actionable failure summary when present, and only the actions currently allowed by that state.

#### Scenario: Owner lists Artifacts

- **WHEN** a signed-in user opens the Artifacts management surface
- **THEN** the system lists only Artifacts owned by that user with enough state to open the corresponding detail

#### Scenario: Owner opens Artifact detail

- **WHEN** the owner requests one of their Artifacts
- **THEN** the system returns its management state and currently allowed actions

#### Scenario: User requests another owner's Artifact

- **WHEN** a signed-in user requests management state for an Artifact they do not own
- **THEN** the system denies access without exposing the Artifact's management data

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

The system SHALL create one active Share link for the Artifact during initial creation. Its Share slug MUST be generated from at least 128 bits of cryptographically secure randomness, contain no Artifact name or identifier, and be protected by a database uniqueness constraint.

Version 0.0.1 MUST keep the same active Share link through Preview, Publish, Unpublish, and republish operations.

#### Scenario: Artifact receives its active Share link

- **WHEN** initial Artifact creation succeeds
- **THEN** the Artifact has one active Share link with a unique opaque Share slug

#### Scenario: Publication state changes

- **WHEN** the owner publishes, unpublishes, or republishes the ready Version
- **THEN** the Artifact's active Share link remains unchanged

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
