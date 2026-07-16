# cli-artifact-management Specification

## Purpose

Define the stable ShareSlices CLI contract for listing, uploading, publishing, sharing, exporting, and deleting owned Artifacts.

## Requirements

### Requirement: List owned Artifacts with stable output

The CLI SHALL list only Artifacts owned by the current user, SHALL default to a bounded result count, and SHALL support Publication and processing filters. Human output SHALL be the default; `--json <fields>`, `--jq`, and `--template` MUST expose only documented selectable fields.

#### Scenario: Agent requests filtered JSON

- **WHEN** an authenticated caller runs `shareslices artifact list` with filters and selected JSON fields
- **THEN** the CLI follows Server pagination up to the requested limit and emits only those fields without transient progress on stdout

### Requirement: Upload explicit local content

The CLI SHALL accept one prepared ZIP unchanged or deterministically package selected non-ZIP files and directories before upload. Creating an Artifact MUST require a name; uploading a new Version MUST require an explicit or interactively selected Artifact and MUST NOT create an implicit local binding.

#### Scenario: Upload prepared ZIP as a new Artifact

- **WHEN** the caller supplies one readable ZIP and `--name`
- **THEN** the CLI transfers that ZIP without repackaging and waits until the Server reports a ready Version or terminal failure

#### Scenario: Package selected local inputs

- **WHEN** the caller supplies non-ZIP files, directories, or expanded glob inputs under one root
- **THEN** the CLI creates a deterministic temporary ZIP containing only those inputs, excluding known operating-system metadata and rejecting links, special files, traversal, nested archives, and ambiguous roots

#### Scenario: Upload a new Version

- **WHEN** the caller supplies `--artifact <id>` or selects an owned Artifact interactively
- **THEN** the CLI uploads a new immutable Version without sending a new Artifact name and waits for the Version result

### Requirement: Report transfer and processing progress safely

The CLI SHALL show transfer and Server-processing progress on stderr by default and SHALL suppress transient progress when `--no-progress` is set. Server acceptance alone MUST NOT be reported as successful completion.

#### Scenario: Agent suppresses progress

- **WHEN** the caller uses `--no-progress`
- **THEN** the CLI emits no transient progress while preserving the final result and exit status

#### Scenario: Upload is interrupted after acceptance

- **WHEN** the caller interrupts after the Server accepted the upload but before processing completes
- **THEN** the CLI reports the accepted Artifact and Upload session without claiming a ready Version or overwriting an existing ready Version

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

### Requirement: Export an explicit ready Version atomically

The CLI SHALL export only an explicit or interactively selected ready Version owned by the target Artifact. It SHALL choose a safe Artifact-name-and-Version ZIP filename by default, write through a same-directory temporary file, and MUST refuse replacement unless `--clobber` is explicit.

#### Scenario: Export without overwrite

- **WHEN** the destination does not exist and the owner selects a ready Version
- **THEN** the CLI downloads the complete normalized ZIP and atomically installs it at the destination

#### Scenario: Destination already exists

- **WHEN** the destination exists and `--clobber` is absent
- **THEN** the CLI fails before downloading and preserves the existing file

### Requirement: Delete an Artifact safely

The CLI SHALL require confirmation before permanent deletion. Confirmation MAY be skipped only when the caller supplies both an explicit Artifact ID and `--yes`; selecting an Artifact interactively MUST still require confirmation. Cancellation MUST perform no DELETE and return exit code 2.

#### Scenario: Explicit confirmed deletion

- **WHEN** the owner supplies an explicit Artifact ID with `--yes` and the Artifact is not accepted or processing
- **THEN** the Server permanently removes its management graph and records resumable cleanup for raw, staging, and committed objects

#### Scenario: Delete is blocked during processing

- **WHEN** the owner attempts to delete an accepted or processing Artifact
- **THEN** the Server returns `invalid_artifact_state`, preserves the Artifact and objects, and the CLI explains the conflict

#### Scenario: Delete outcome is uncertain

- **WHEN** the DELETE request fails in transport or returns a Server error after transmission
- **THEN** the CLI does not automatically retry and reports that the outcome is indeterminate

### Requirement: Keep automation deterministic and authenticated

Every Artifact API request from the CLI MUST use the browser-authorized credential from the operating-system credential store and send CLI version and operating-system metadata. When human prompts are disabled or unavailable, commands MUST require all decision-relevant identifiers and values explicitly. Exit codes outside Agent mode SHALL remain 0 for success, 1 for failure, 2 for cancellation, and 4 when authentication is required.

Agent mode MUST NOT read stdin. It SHALL evaluate local input before authentication when no Server state is needed. One missing ordinary required value with no competing inferred candidates SHALL return a local `failed` outcome without mutation. Multiple plausible values SHALL return `action_required` with `resolve_ambiguity`, and missing irreversible confirmation SHALL return `action_required` with `confirm_irreversible`. A complete operation without a valid CLI Session SHALL return `action_required` with an `authorize` next action and exit code 4.

#### Scenario: Non-interactive human input is incomplete

- **WHEN** prompts are disabled or stdin is not a terminal and a non-Agent command omits a required Artifact, Version, expiration, or confirmation decision
- **THEN** the CLI fails locally without waiting for input or mutating Server state

#### Scenario: Human CLI Session is unavailable

- **WHEN** a non-Agent Artifact command has complete local input but no valid stored CLI Session
- **THEN** the CLI instructs the user to run `shareslices auth login`, prints no credential, and exits with code 4

#### Scenario: Agent ordinary input is incomplete

- **WHEN** an Agent command omits a non-confirmation identifier or value required to select its operation or target
- **THEN** it reads no stdin, returns `failed`, and performs no mutation

#### Scenario: Agent input has multiple plausible resolutions

- **WHEN** an Agent command can identify multiple reasonable roots, Entry files, Artifacts, Versions, or targets but no deterministic rule selects one
- **THEN** it returns `action_required` with `resolve_ambiguity`, reads no stdin, and performs no mutation

#### Scenario: Agent CLI Session is unavailable

- **WHEN** an Agent Artifact command has complete local input but no valid stored CLI Session
- **THEN** it returns `action_required` with `auth_required`, an `authorize` next action, and exit code 4

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

### Requirement: Preserve Artifact recovery evidence in Agent outcomes

Every non-completed Artifact outcome SHALL identify every affected resource known to exist. Accepted Uploads MUST preserve the Artifact and Upload-session identifiers. Results after a ready Version exists MUST also preserve the Version. Publication mutations SHALL preserve the known Artifact, Version, Publication, and Share-link state without claiming an unconfirmed state transition.

When the Server returns processing failure, validation report, canonical issue code, recoverability, or allowed actions, the CLI SHALL preserve those facts. The CLI MUST NOT collapse them into display text or replace them with a locally guessed repair.

#### Scenario: Upload remains in progress

- **WHEN** the Server has accepted an Upload and processing remains active after the advertised `processingWaitSeconds` budget
- **THEN** the CLI returns `in_progress` with the Artifact and Upload session, omits a ready Version, and supplies an inspection or delayed-retry action

#### Scenario: Upload processing fails

- **WHEN** the Server reaches a terminal processing failure
- **THEN** the CLI returns `failed` with the Artifact, Upload session, validation report, recoverability, and allowed actions that are available and reports neither a ready Version nor new Publication

#### Scenario: Upload is cancelled after acceptance

- **WHEN** the caller cancels after the Server accepted the Upload but before processing completes
- **THEN** the CLI returns `cancelled` with the Artifact and Upload session and states that accepted Server work may continue

#### Scenario: Upload acceptance cannot be confirmed

- **WHEN** safe transport retries using one idempotency key are exhausted without a confirmed acceptance response
- **THEN** the CLI returns `indeterminate`, excludes unconfirmed resources, and directs the caller to inspect state before repeating the Upload

### Requirement: Represent high-level Publish stages honestly

High-level Agent-mode Publish SHALL emit only one final envelope for packaging, Upload, processing, and Publication orchestration. It MUST NOT emit a completed Upload result before Publication completes. Once any durable Server resource is confirmed, failure or uncertainty in a later requested stage SHALL preserve that resource and MUST NOT be presented as if no side effect occurred.

#### Scenario: High-level Publish completes

- **WHEN** packaging, Upload, processing, and Publication all complete
- **THEN** one `completed` envelope identifies the Artifact, ready Version, Publication, and exact Share link

#### Scenario: Processing fails before Publication

- **WHEN** Upload is accepted but processing reaches a terminal failure during high-level Publish
- **THEN** the CLI returns `partial` with the Artifact, Upload session, and validation evidence and creates or reports no new Publication

#### Scenario: Publication is rejected after Version readiness

- **WHEN** the Artifact and ready Version are confirmed but the Server confirms that Publish did not complete
- **THEN** the CLI returns `partial` with the Artifact and Version and does not report a Share link as externally accessible

#### Scenario: Publication outcome is uncertain

- **WHEN** the Publish request is transmitted but its result cannot be confirmed
- **THEN** the CLI returns `indeterminate` with the known Artifact and Version and directs state inspection instead of automatically repeating Publish

#### Scenario: High-level Publish remains in processing

- **WHEN** Upload is accepted and Server processing remains active after the advertised `processingWaitSeconds` budget
- **THEN** the CLI returns `in_progress` with the accepted resources and no Publication claim

### Requirement: Classify access and destructive mutations safely

Publish, Unpublish, Publication edit, Share-link replacement, and Delete SHALL distinguish a confirmed rejection from a transport result that leaves the mutation outcome indeterminate. The CLI MUST NOT automatically retry a Delete or another mutation whose result cannot be proved. A later invocation after an indeterminate mutation SHALL inspect current Server state before deciding whether a new mutation is needed.

#### Scenario: Delete outcome is indeterminate

- **WHEN** Delete is transmitted and a transport or Server-response failure prevents confirmation
- **THEN** Agent mode returns `indeterminate` with the explicit Artifact identifier and an `inspect_state` action and does not repeat Delete

#### Scenario: Publication edit is rejected before application

- **WHEN** the Server confirms that an expiration edit is invalid
- **THEN** Agent mode returns `failed` and does not claim changed Publication metadata

#### Scenario: Access mutation cannot be confirmed

- **WHEN** Publish, Unpublish, or Publication edit may have reached the Server but no result is confirmed
- **THEN** Agent mode returns `indeterminate` with known resource state and does not claim the requested access state

#### Scenario: State already reflects an earlier mutation

- **WHEN** read-only inspection proves that an earlier indeterminate request reached its requested state
- **THEN** the caller can report completion without transmitting the mutation again

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
