# CLI Artifact management delta specification

## ADDED Requirements

### Requirement: Manage owned Gallery listings explicitly

The CLI SHALL provide `artifact gallery view`, `artifact gallery share`, `artifact gallery update`, and `artifact gallery withdraw` for authenticated Owners. It MUST NOT provide public Gallery browse, Save a copy, Download, Report, moderation, or Featured commands in the first release.

`gallery view` SHALL return the exact current permission-grant revision and exact text as read-only evidence and MAY also return its stable digest when a current grant is configured, including when the Artifact has never had a Gallery listing. If none is configured, it SHALL return a stable no-current-grant result while still returning any listing and historical accepted-grant evidence and MUST NOT fabricate terms. `gallery share` SHALL select an explicit ready Version or deterministically default to the latest ready Version, require complete public metadata and acceptance of that exact current Gallery permission-grant revision, and create no Publication or Share link. When the Owner has no Creator profile, `gallery share` SHALL additionally require an explicitly confirmed public Creator display name and MUST NOT derive it from email; it does not become a general CLI profile editor. A replacement share after reversed `administrator_removal` and before restoration SHALL additionally require irreversible confirmation that replacement forfeits the old listing URL, identity, counters, and restoration. `gallery update` SHALL require a Listed listing with a committed revision, expected listing revision, replacement Version or metadata, and acceptance of the exact current grant revision when the Version changes or current policy requires renewal for that proposal. Share and update SHALL report proposal acceptance separately from public promotion: a proposal still awaiting checks or review is `in_progress`, an atomically promoted requested revision is `completed`, and rejection or uncertainty MUST preserve the previously known committed projection. `gallery withdraw` SHALL require irreversible confirmation and permanently retire the current listing URL without requiring grant renewal. Every mutation SHALL accept an idempotency key.

#### Scenario: Owner views Gallery state

- **WHEN** an authenticated Owner runs `artifact gallery view` for an owned Artifact
- **THEN** the CLI reports the current or latest listing identity, lifecycle, review status, effective-access status and stable blocking category, current terminal closure reason when present, fixed Version, metadata, URL only when Listed and effectively accessible, listing revision, accepted grant revision, current grant evidence, and allowed actions without changing state

#### Scenario: Owner views an Artifact with no Gallery listing

- **WHEN** an authenticated Owner runs `artifact gallery view` for an owned Artifact that has never been shared to Gallery while a current grant is configured
- **THEN** the CLI reports no listing and returns the exact current permission-grant revision and exact text needed for a later acceptance, with an optional stable digest
- **AND** it performs no Gallery mutation

#### Scenario: Owner views Gallery state without current terms

- **WHEN** an authenticated Owner runs `artifact gallery view` while no current permission grant is configured
- **THEN** the CLI reports stable no-current-grant unavailability, preserves any listing and historical accepted-grant evidence, and returns no terms to accept
- **AND** Gallery share or update performs no mutation while withdrawal remains available

#### Scenario: Owner shares the latest ready Version

- **WHEN** the Owner runs `artifact gallery share` with valid metadata, current grant acceptance, and no explicit Version while exactly one latest ready Version exists
- **THEN** the CLI submits one non-public initial proposal for that Version without creating or changing a Publication or Share link
- **AND** it reports `completed` only if the proposal is promoted to a Listed committed revision during the invocation

#### Scenario: Initial Gallery proposal awaits review

- **WHEN** an accepted `artifact gallery share` proposal remains Pending or Reviewing when the command returns
- **THEN** the CLI reports `in_progress` with the durable listing and proposal evidence, no active Gallery URL, and a structured state-inspection or delayed-retry action
- **AND** it does not claim that the proposed Version or metadata is public

#### Scenario: First Gallery share lacks a Creator display name

- **WHEN** an Owner with no Creator profile requests `gallery share` without an explicitly confirmed public display name
- **THEN** the CLI returns `action_required` with `resolve_ambiguity` for that material choice and performs no profile or listing mutation
- **AND** it neither exposes nor derives a display name from the Owner's email address

#### Scenario: Replacement after reversed removal lacks confirmation

- **WHEN** an Owner requests Gallery share after a reversed `administrator_removal` while its old listing remains restorable and does not confirm permanent forfeiture
- **THEN** the CLI returns `action_required` with `confirm_irreversible`, identifies the old URL, identity, counters, and restoration consequence, and performs no mutation

#### Scenario: Owner submits an update proposal

- **WHEN** the Owner supplies the active listing identity, expected revision, valid replacement values, and required grant acceptance
- **THEN** the CLI submits a non-public proposal against that revision while reporting the unchanged current Version, listing revision, and Gallery URL
- **AND** if the proposal remains open, it reports `in_progress` and does not claim the proposed fields are public

#### Scenario: Gallery update is promoted

- **WHEN** the accepted update proposal passes every precondition and is atomically promoted during the invocation
- **THEN** the CLI reports `completed` with the next committed listing revision, replacement Version and metadata, and unchanged Gallery URL

#### Scenario: Owner withdraws a listing

- **WHEN** the Owner supplies the active listing identity and irreversible confirmation to `artifact gallery withdraw`
- **THEN** the CLI permanently closes the listing, reports Withdrawn, and does not change the Artifact's Publication or Share link

#### Scenario: Gallery deployment is unavailable

- **WHEN** Gallery is disabled or deployment-ineligible and the Owner invokes Gallery view or confirmed withdrawal
- **THEN** the CLI permits that read or risk-reducing withdrawal while Gallery share and update return the stable unavailable result without mutation

#### Scenario: Caller requests a public Gallery interaction

- **WHEN** a caller looks for a CLI browse, Save a copy, Download, Report, moderation, or Featured operation
- **THEN** the production parser exposes no such command in the first release

## MODIFIED Requirements

### Requirement: Return fixed Agent results for every advertised Artifact operation

Agent mode SHALL support high-level local Publish, Artifact list, Upload, Publish, Unpublish and Delete, Publication view and edit, ready-Version Export, and Gallery listing view, share, update, and withdraw. Each operation SHALL return a fixed command-specific `resources` and `data` projection without field selection.

Successful list results SHALL include bounded Artifact summaries with identifiers, names, processing state, underlying Publication state, independent Public-sharing restriction and Gallery state when present, timestamps, and available recovery or management evidence. Successful Upload SHALL include the Artifact and ready Version. Publication reads and mutations SHALL include the underlying Publication state, expiration, independent Public-sharing restriction, effective Copy eligibility, and the stable Share link when one exists. Gallery reads and mutations SHALL keep the committed projection separate from any open non-public proposal. They SHALL include the known Gallery listing, committed fixed Version when present, lifecycle, review status, effective-access status and stable blocking category, current terminal closure reason when present, listing revision, accepted permission-grant revision, URL only when Listed and effectively accessible while Gallery is enabled and eligible, allowed actions, and the proposal identity, base revision, proposed Version, and proposal state when known. Gallery view SHALL additionally include the exact current permission-grant revision and exact text and MAY include its stable digest when a current grant exists, whether or not a listing exists, so a caller can make an evidenced acceptance decision. When no current grant exists, it SHALL instead preserve stable unavailability plus any historical accepted-grant evidence without inventing current terms. Successful Export SHALL identify the Artifact, Version, and atomically installed local destination. Successful Delete SHALL identify the deleted Artifact and every Gallery listing transitioned, retired, or made permanently non-restorable by the operation without returning deleted content.

#### Scenario: Agent lists Artifacts

- **WHEN** an authenticated caller lists owned Artifacts in Agent mode
- **THEN** one completed envelope contains the bounded Artifact summaries without a table, progress text, or selected-field wrapper

#### Scenario: Agent uploads a ready Version

- **WHEN** an Agent Upload completes Server processing successfully
- **THEN** one completed envelope identifies the Artifact and immutable ready Version and does not claim a Publication or Gallery listing unless one already exists in returned Server state

#### Scenario: Agent views Publication state

- **WHEN** an Agent views an Artifact that has never been Published
- **THEN** one completed envelope reports Not published and no Share link

#### Scenario: Agent views Gallery state

- **WHEN** an Agent views an Artifact that has never been shared to Gallery while a current grant is configured
- **THEN** one completed envelope reports no active Gallery listing and returns the exact current grant revision and exact text, with an optional stable digest, without inferring a listing from Publication state

#### Scenario: Agent views Gallery state without current terms

- **WHEN** an Agent views Gallery state while no current permission grant is configured
- **THEN** the envelope preserves any listing and historical acceptance, returns stable no-current-grant unavailability, and includes no `accept_permission` action or fabricated terms

#### Scenario: Agent shares to Gallery

- **WHEN** an Agent Gallery share completes with a confirmed listing
- **THEN** one completed envelope identifies the Artifact, fixed Version, Gallery listing, grant revision, listing revision, lifecycle, review status, and exact Gallery URL
- **AND** it reports no new Publication or Share link

#### Scenario: Agent Gallery proposal remains open

- **WHEN** an Agent Gallery share or update has a confirmed durable proposal that has not reached promotion or rejection
- **THEN** one `in_progress` envelope identifies the listing and proposal, keeps committed and proposed fields distinct, and returns a structured state-inspection or delayed-retry action
- **AND** it does not return an active URL for an initial Pending listing or claim an update proposal changed the committed revision

#### Scenario: Agent Gallery update completes

- **WHEN** an Agent Gallery update is confirmed atomically promoted
- **THEN** one completed envelope identifies the new committed revision and Version, unchanged active Gallery URL, closed proposal, and current lifecycle and review state

#### Scenario: Agent exports a Version

- **WHEN** an Agent exports an explicit ready Version successfully
- **THEN** one completed envelope is emitted only after the destination ZIP is atomically installed and identifies its local destination

#### Scenario: Agent deletes an Artifact

- **WHEN** an Agent supplies an explicit Artifact identifier and confirmed permanent-deletion option and Delete completes
- **THEN** one completed envelope identifies the deleted Artifact and any Gallery listing retired by the operation

### Requirement: Require human confirmation only for irreversible choices

Agent mode SHALL treat explicit Publish and Unpublish intent as sufficient authorization when all decision-relevant inputs are supplied. Gallery share and any Gallery update for which the Version changes or current policy requires renewal for that proposal SHALL require explicit acceptance of the exact current Gallery permission-grant revision. Missing permission acceptance SHALL return `action_required` with an `accept_permission` next action containing the target operation and resource, exact grant revision, and exact grant text, with an optional stable digest, before any mutation. Gallery view, withdrawal, and accepted-operation recovery MUST NOT require grant renewal. Permission acceptance MUST NOT use `confirm_irreversible`. Permanent Artifact Delete, Share-link replacement, Gallery withdrawal, and replacement Share to Gallery that permanently forfeits restoration after reversed `administrator_removal` SHALL require explicit irreversible confirmation in the current invocation; missing irreversible confirmation SHALL return `action_required` with `confirm_irreversible` before any mutation.

If no current permission grant exists, Gallery share and update MUST return stable unavailable before mutation and MUST NOT return `accept_permission`; Gallery view and withdrawal remain read-only or risk-reducing operations.

#### Scenario: Explicit Publish is complete

- **WHEN** an Agent invocation explicitly requests Publish with all required Artifact, Version, and expiration inputs
- **THEN** the CLI does not ask for a redundant confirmation

#### Scenario: Explicit Unpublish is complete

- **WHEN** an Agent invocation explicitly requests Unpublish for the target Artifact
- **THEN** the CLI does not ask for a redundant confirmation

#### Scenario: Gallery share lacks permission acceptance

- **WHEN** an Agent invocation requests Gallery share without accepting the exact current grant revision
- **THEN** the CLI returns `action_required` with `accept_permission`, the target operation and Artifact, exact grant revision, and exact grant text, with an optional stable digest
- **AND** it performs no Gallery mutation and does not return `confirm_irreversible`

#### Scenario: Gallery update requiring renewal lacks permission acceptance

- **WHEN** an Agent invocation requests a Version-changing or policy-renewal Gallery update without accepting the exact current grant revision
- **THEN** the CLI returns `action_required` with `accept_permission` and the structured current grant evidence and performs no Gallery mutation

#### Scenario: Metadata-only update requires renewed permission

- **WHEN** an Agent invocation requests a metadata-only Gallery update and current policy requires renewal for that proposal
- **THEN** the CLI returns the same `accept_permission` evidence required for a Version-changing update and performs no mutation until the exact grant is accepted

#### Scenario: Gallery withdraw lacks irreversible confirmation

- **WHEN** an Agent invocation requests Gallery withdraw without confirming permanent URL retirement
- **THEN** the CLI returns `action_required` with `confirm_irreversible` and performs no Gallery mutation

#### Scenario: Gallery replacement forfeiture lacks irreversible confirmation

- **WHEN** Agent-mode Gallery share would replace a restorable `administrator_removal` predecessor without confirmation of permanent forfeiture
- **THEN** the CLI returns `action_required` with `confirm_irreversible` and the old-listing consequence and performs no Gallery mutation

#### Scenario: Delete lacks confirmation

- **WHEN** an Agent Delete supplies an explicit Artifact identifier but lacks irreversible confirmation
- **THEN** the CLI returns `action_required` and performs no DELETE request

#### Scenario: Link replacement lacks confirmation

- **WHEN** Agent-mode Publish requests Share-link replacement without irreversible confirmation
- **THEN** the CLI returns `action_required` and performs no Publication mutation
