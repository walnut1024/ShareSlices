# CLI Agent protocol delta specification

## MODIFIED Requirements

### Requirement: Advertise Agent capabilities without external state

The CLI SHALL provide `shareslices --agent capabilities`. Capability discovery MUST require no credential, credential-store access, network connection, or interactive input. Its permanently additive version 1 discovery result SHALL report the CLI semantic version, every supported integer Agent protocol version, the current protocol version, stable feature identifiers, action kinds, one integer `processingWaitSeconds` value from 1 through 30, and every executable operation supported in Agent mode.

The version 1 operation set SHALL use these canonical identifiers:

- `capabilities`
- `artifact.publish_local`
- `auth.login`
- `auth.status`
- `auth.logout`
- `artifact.list`
- `artifact.upload`
- `artifact.publish`
- `artifact.unpublish`
- `artifact.delete`
- `artifact.publication.view`
- `artifact.publication.edit`
- `artifact.export`
- `artifact.gallery.view`
- `artifact.gallery.share`
- `artifact.gallery.update`
- `artifact.gallery.withdraw`

The advertised operation set MUST equal the Agent-enabled executable command set in the production parser. It MUST NOT advertise public Gallery browse, Save a copy, Download, Report, moderation, or Featured operations in protocol version 1.

#### Scenario: Discover capabilities offline

- **WHEN** an unauthenticated caller runs `shareslices --agent capabilities` while the Server is unreachable
- **THEN** the CLI returns a completed capability result containing the complete deterministic local protocol and operation set, including the four owner Gallery operations

#### Scenario: Detect incomplete command coverage

- **WHEN** a contract test compares the production command parser with Agent capabilities
- **THEN** every Agent-enabled executable command appears exactly once and every advertised operation is executable in Agent mode

#### Scenario: Skill cannot consume an advertised protocol

- **WHEN** capability discovery reports no Agent protocol version supported by the calling Skill
- **THEN** the Skill can stop before an operational command without parsing human output or contacting the Server

#### Scenario: Discover the processing wait budget

- **WHEN** a caller reads Agent capabilities
- **THEN** it receives the fixed processing wait budget that Upload and high-level Publish will use after Server acceptance

#### Scenario: Discover the Gallery permission action

- **WHEN** a caller reads the advertised Agent action kinds
- **THEN** it finds `accept_permission` as the canonical action for accepting an evidenced Gallery permission grant

#### Scenario: Public Gallery operation is not advertised

- **WHEN** a caller inspects Agent capabilities for the first Gallery release
- **THEN** it finds owner Gallery view, share, update, and withdraw but no public browse, copy, download, report, moderation, or Featured operation

### Requirement: Preserve evidence without inventing facts

`resources` SHALL contain only Server-accepted or durable Artifact, Upload session, Version, Publication, Share-link, Gallery-listing, and related management resources known to exist. `data` SHALL contain only operation-specific facts known by the CLI. An error SHALL preserve the stable Server error code, sanitized message, request identifier, field errors, typed details, validation report, recoverability, allowed actions, and retry timing when those facts are present.

For Gallery operations, the CLI SHALL distinguish an intended listing from a confirmed listing and a non-public proposal from a committed public revision. It SHALL preserve only known committed and proposed fixed-Version, lifecycle, review, effective-access status and stable blocking category, current terminal closure reason, URL, listing revision, proposal identity, proposal state, base revision, permission-grant, and allowed-action evidence. Whenever permission acceptance is required and a current grant exists, the Agent envelope SHALL preserve the exact current permission-grant revision and exact grant text as structured evidence and MAY also preserve its stable digest. If no current grant exists, it SHALL preserve the stable unavailable result plus any historical accepted-grant evidence and MUST NOT fabricate current terms or an `accept_permission` action. It MUST NOT infer, summarize, or substitute permission evidence, infer a Gallery listing from a Publication, infer a Publication from a Gallery listing, or infer proposal acceptance, public promotion, withdrawal, or another transition from the requested intent.

The CLI MUST NOT fabricate missing Server facts, infer a successful resource from intent, or treat an error message as a machine code. When optional evidence is unavailable, the CLI SHALL omit it and choose a conservative outcome or next action. Agent output MUST NOT expose credentials, cookies, raw device codes, Session secrets, object-storage locations, raw governance evidence, reporter identity, or raw exception evidence.

#### Scenario: Server returns validation evidence

- **WHEN** the Server returns a validation report, recoverability, and allowed actions for a failed Upload
- **THEN** the Agent envelope preserves those facts under the affected resource or error without reducing them to display text

#### Scenario: Server omits optional recovery evidence

- **WHEN** a compatible older Server returns a stable error without optional retry or recovery facts
- **THEN** the CLI omits the unavailable fields and does not invent permission or timing for a retry

#### Scenario: Durable resource is not confirmed

- **WHEN** the CLI cannot prove that an intended Artifact, Version, Publication, Share link, or Gallery listing exists
- **THEN** it excludes that resource and does not report it as completed

#### Scenario: Gallery update is indeterminate

- **WHEN** a Gallery update was transmitted but the CLI cannot confirm proposal acceptance or public promotion
- **THEN** the outcome preserves the previously known committed listing and Version, reports indeterminate, and directs state inspection without claiming either transition

#### Scenario: Gallery proposal remains active

- **WHEN** the Server confirms a durable initial or update proposal whose checks or review have not reached a terminal decision
- **THEN** the outcome is `in_progress`, preserves the listing and proposal as distinct resources, and directs structured state inspection or delayed retry
- **AND** it does not report the proposed revision as committed or public

#### Scenario: Gallery withdraw is indeterminate

- **WHEN** a Gallery withdrawal may have reached the Server but URL retirement cannot be confirmed
- **THEN** the outcome preserves the known listing identity, does not report Withdrawn, and directs read-only inspection before any replay

#### Scenario: Gallery permission acceptance is required

- **WHEN** an Agent Gallery operation requires acceptance of the current permission grant
- **THEN** the envelope preserves the exact grant revision and exact text from authoritative evidence and may also preserve its stable digest
- **AND** it does not replace that evidence with display prose or an inferred permission

#### Scenario: Current Gallery permission is unavailable

- **WHEN** the Server reports that no current Gallery permission grant is configured
- **THEN** the envelope preserves stable unavailability and any historical accepted-grant evidence without a current grant, fabricated text, or `accept_permission` next action

### Requirement: Return one standardized next action

When an outcome has an actionable continuation, `nextAction.kind` SHALL be one of `authorize`, `resolve_ambiguity`, `accept_permission`, `confirm_irreversible`, `install_or_upgrade`, `change_local_input`, `inspect_state`, `retry_later`, or `contact_support`. The next action SHALL include a concise instruction and only the structured parameters supported by authoritative evidence and the current command contract.

An `accept_permission` next action SHALL identify the target operation and resource, the exact current permission-grant revision, and the exact grant text, and MAY also include its stable digest. It MUST NOT be represented as `confirm_irreversible`, and `confirm_irreversible` MUST remain reserved for an operation whose consequences are actually irreversible. An `action_required` outcome MUST contain a next action. `indeterminate` MUST direct state inspection rather than blind mutation replay. Retry timing MUST NOT by itself grant permission to retry a non-idempotent or uncertain operation.

#### Scenario: Authentication is missing

- **WHEN** an otherwise complete operation lacks a valid CLI Session
- **THEN** the CLI returns an `authorize` next action without exposing credential details

#### Scenario: Local input must change

- **WHEN** deterministic Server evidence identifies a correctable local-input problem
- **THEN** the CLI returns `change_local_input` with that evidence and does not edit the input

#### Scenario: Multiple plausible values remain

- **WHEN** local selection or Server state produces multiple reasonable Entry files, Artifacts, Versions, or targets and no deterministic rule selects one
- **THEN** the CLI returns `action_required` with `resolve_ambiguity` and performs no mutation

#### Scenario: Gallery permission must be accepted

- **WHEN** Gallery share or a Gallery update with a Version change or policy-required renewal requires acceptance of the current permission grant
- **THEN** the CLI returns `action_required` with `accept_permission`, the target operation and resource, the exact grant revision, and exact grant text, with an optional stable digest
- **AND** it performs no mutation and does not return `confirm_irreversible` for that permission decision

#### Scenario: Irreversible Gallery withdrawal must be confirmed

- **WHEN** Gallery withdrawal lacks confirmation of permanent URL retirement
- **THEN** the CLI returns `action_required` with `confirm_irreversible` and performs no mutation

#### Scenario: Irreversible Gallery replacement must be confirmed

- **WHEN** Gallery share would permanently forfeit restoration of a previously public `administrator_removal` listing and lacks that confirmation
- **THEN** the CLI returns `action_required` with `confirm_irreversible`, the affected predecessor, and the permanent URL, identity, counter, and restoration consequences without performing a mutation

#### Scenario: No reliable automated recovery exists

- **WHEN** the CLI cannot derive a safe retry, inspection, or correction from the command contract and available facts
- **THEN** it returns `contact_support` with the request identifier when available
