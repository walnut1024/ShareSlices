# artifact-publication delta specification

## ADDED Requirements

### Requirement: Project one Publication status

The management API and Web SHALL project exactly one Owner-facing Publication status for each Artifact: Not published when no Publication has ever existed, Published while the latest Publication is externally accessible, Expired after its scheduled end, or Unpublished after the Owner ends it early. Superseded Publications SHALL remain internal history and MUST NOT appear as another current state.

#### Scenario: Artifact has never been published

- **WHEN** an Owner views a ready Artifact that has no Publication history
- **THEN** management reports Not published and offers Publish without exposing a Share link

#### Scenario: Publication reaches its scheduled end

- **WHEN** the latest Publication's effective expiration passes without a later Publish
- **THEN** management reports Expired, preserves the Share link, and disables Copy until the Owner publishes again

#### Scenario: Owner ends access early

- **WHEN** the Owner Unpublishes before the scheduled end
- **THEN** management reports Unpublished, preserves the Share link, and disables Copy until the Owner publishes again

### Requirement: Manage an accessible Publication

The Owner SHALL be able to view and copy the Share link and change an accessible Publication between permanent and an exact future expiration without publishing again. The system MUST reject a current or past expiration and leave the Publication unchanged. Publication management MUST NOT replace the Share link or select another Version.

#### Scenario: Owner extends the current Publication

- **WHEN** the Owner changes the current Publication to a later future expiration
- **THEN** the same Publication and Share link remain accessible until the new effective end

#### Scenario: Owner makes the current Publication permanent

- **WHEN** the Owner clears the current Publication expiration
- **THEN** the same Publication and Share link remain accessible without a scheduled end

#### Scenario: Owner requests immediate expiration

- **WHEN** the Owner submits a current or past expiration
- **THEN** the system rejects it and directs immediate removal through Unpublish

## MODIFIED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts and expose only state-valid Preview, Publish, Manage publication, Copy, Unpublish, Rename, Export, Delete, Retry, and Replace file actions. It MUST NOT expose Share as a separate lifecycle action. Publication history, analytics, and link replacement outside Publish SHALL NOT be exposed.

#### Scenario: Owner uses a ready never-published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and a ready Artifact is Not published
- **THEN** the card provides Preview, Publish, Rename, Export, and Delete actions without a Share link or Copy action

#### Scenario: Owner uses a Published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and an Artifact is Published
- **THEN** the card provides Preview, Publish, Manage publication, Copy, Rename, Export, and Delete actions as permitted by its processing state

### Requirement: Maintain one active Share link

The system SHALL create the first Share link atomically with the Artifact's first Publish and SHALL preserve that link across later Publish, expiration, and Unpublish by default. The Owner MAY explicitly replace the link only during Publish by supplying irreversible confirmation. Replacement MUST atomically retire the previous link, create one new link, and MUST NOT retain the previous link as an alias.

An Artifact created before this behavior MAY have one reserved existing link before its next Publish. The system SHALL preserve and reuse that link without exposing the migration exception as a second active link.

#### Scenario: Owner publishes for the first time

- **WHEN** the Owner Publishes a ready Version for an Artifact with no Share link
- **THEN** the system creates one Share link with the Publication and returns it in the successful Publish result

#### Scenario: Owner republishes with the default link choice

- **WHEN** the Owner Publishes after expiration or Unpublish without requesting replacement
- **THEN** the new Publication reuses the previous Share link

#### Scenario: Owner replaces the link during Publish

- **WHEN** the Owner Publishes with replacement and explicit irreversible confirmation
- **THEN** the new Publication uses one new link and the previous link becomes permanently retired

#### Scenario: Owner requests replacement without confirmation

- **WHEN** the Owner requests a new link without the required irreversible confirmation
- **THEN** the system rejects Publish and leaves the existing Publication and link unchanged

### Requirement: Preview the ready Version

The system SHALL let the signed-in Owner Preview the Artifact's ready Version without changing Publication. Preview SHALL be served from authenticated API Origin routes. Each Preview page and asset request MUST validate the current management session, Artifact ownership, ready-Version state, and normalized manifest path.

Version 0.0.1 MUST NOT create a separate Preview session, grant, expiry policy, or shareable Preview link.

#### Scenario: Owner previews before first Publish

- **WHEN** the signed-in Owner opens Preview for a ready Version of a Not published Artifact
- **THEN** the system renders that Version without creating a Publication or Share link

#### Scenario: User previews another Owner's Version

- **WHEN** a signed-in user requests Preview for an Artifact they do not own
- **THEN** the system denies the Preview request

#### Scenario: Owner previews a Version that is not ready

- **WHEN** the Owner requests Preview before a ready Version exists
- **THEN** the system rejects the request without exposing staged or raw objects

### Requirement: Publish atomically

The Owner SHALL be able to Publish only a ready Version owned by the target Artifact. Publish SHALL atomically create a new Publication, create or select the effective Share link, and supersede any accessible Publication so Viewer requests never resolve to partial state or an invalid Version.

Publish SHALL accept permanent, positive relative-duration, or exact future-time expiration policy. It SHALL default to permanent on first Publish and otherwise inherit the previous Version, expiration policy, and link unless the Owner explicitly selects replacements. A relative duration restarts at the new Publish time; an exact time MUST be selected again after it has passed.

Publish requests MUST be idempotent for the same Owner, Artifact, effective Version, expiration policy, link choice, and idempotency key.

#### Scenario: Owner publishes a ready Version permanently

- **WHEN** the Owner first Publishes an owned ready Version without an expiration selection
- **THEN** the system atomically creates a permanent Publication and Share link and returns both

#### Scenario: Owner publishes with a relative duration

- **WHEN** the Owner Publishes with a positive relative duration
- **THEN** the Publication expires that duration after its successful Publish time

#### Scenario: Owner publishes another Version while accessible

- **WHEN** the Owner Publishes another owned ready Version while one Publication is accessible
- **THEN** Viewer requests keep receiving the previous Version until one transaction supersedes it and commits the new Publication and effective link

#### Scenario: Owner repeats Publish

- **WHEN** the Owner repeats the same effective Publish operation with the same idempotency key
- **THEN** the system returns the original Publication and link without creating another effective transition

#### Scenario: Owner publishes a non-ready Version

- **WHEN** the Owner attempts to Publish a Version that is missing, failed, staged, or belongs to another Artifact
- **THEN** the system rejects the operation and leaves Publication and link state unchanged

### Requirement: Unpublish and republish

The Owner SHALL be able to Unpublish an accessible Artifact by ending its current Publication early without changing the Share link or immutable Version. Repeating the same operation MUST return the same effective Unpublished state. Publishing after Expired or Unpublished SHALL default to the previous Version, expiration policy, and Share link.

#### Scenario: Owner unpublishes

- **WHEN** the Owner Unpublishes a Published Artifact
- **THEN** the system records its early end, reports Unpublished, and makes the unchanged Share link return the Unpublished status page

#### Scenario: Owner republishes after Unpublish

- **WHEN** the Owner Publishes an Unpublished Artifact without overriding defaults
- **THEN** the system creates a new Publication for the previous Version and expiration policy and reuses the same Share link

#### Scenario: Owner republishes an expired relative duration

- **WHEN** the Owner Publishes an Expired Artifact whose previous policy was a relative duration
- **THEN** the system starts that duration again from the new successful Publish time

#### Scenario: Owner republishes an expired exact time

- **WHEN** the Owner attempts to reuse an exact expiration that has already passed
- **THEN** the system requires a new expiration selection and leaves the Artifact Expired

#### Scenario: Non-owner changes Publication

- **WHEN** a user who does not own the Artifact attempts to Publish, manage, or Unpublish it
- **THEN** the system denies the operation and leaves Publication and link state unchanged
