# artifact-thumbnail delta specification

## MODIFIED Requirements

### Requirement: Generate a non-blocking Version thumbnail

The system SHALL arrange independent thumbnail work after committing a ready Version. Versions that reference the same Content bundle and pin the same renderer revision SHALL share one thumbnail job and result. Thumbnail pending, retry, reuse, or terminal failure MUST NOT delay or change Version readiness, Preview, Publication, Share-link behavior, or processing-job completion.

#### Scenario: Version becomes ready before its thumbnail

- **WHEN** processing commits a ready Version whose bundle and renderer revision have no completed thumbnail
- **THEN** the Version is immediately available for Owner actions and one bundle-level thumbnail job is pending

#### Scenario: Ready thumbnail already exists

- **WHEN** processing commits a Version whose Content bundle already has a completed thumbnail for its pinned renderer revision
- **THEN** the Version is immediately able to resolve that existing result without another render

#### Scenario: Thumbnail generation fails terminally

- **WHEN** all permitted attempts finish without a valid thumbnail
- **THEN** every referencing Version remains ready and usable and the shared thumbnail job records a terminal failure

### Requirement: Store and retry immutable thumbnail output

Successful rendering SHALL produce an approximately `480x300` WebP stored as a private immutable object belonging to one Content bundle and renderer revision. Each Version SHALL pin its renderer revision when it becomes ready. Classified transient failures SHALL receive no more than three automatic retries with backoff; deterministic failures MUST NOT be retried automatically. Removing one Version MUST preserve the thumbnail while another Version references its Content bundle; final bundle cleanup MUST include every renderer-revision thumbnail.

#### Scenario: Transient rendering dependency fails

- **WHEN** Chromium, the internal render route, or object storage reports a classified transient failure
- **THEN** the shared thumbnail job is retried within the bounded policy without changing any Version state

#### Scenario: Renderer revision advances

- **WHEN** a later Version pins a new renderer revision for an existing Content bundle
- **THEN** it receives independent thumbnail work and earlier Version URLs continue resolving the bytes for their pinned revision

#### Scenario: Referencing Version is removed

- **WHEN** one Version is deleted while another Version still references the same Content bundle and renderer revision
- **THEN** the shared thumbnail object remains available to the surviving Version
