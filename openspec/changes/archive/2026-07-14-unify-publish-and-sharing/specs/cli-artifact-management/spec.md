# cli-artifact-management delta specification

## ADDED Requirements

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

## MODIFIED Requirements

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
