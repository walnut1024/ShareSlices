# cli-artifact-management Delta Specification

## ADDED Requirements

### Requirement: Return fixed Agent results for every advertised Artifact operation

Agent mode SHALL support high-level local Publish, Artifact list, Upload, Publish, Unpublish and Delete, Publication view and edit, and ready-Version Export. Each operation SHALL return a fixed command-specific `resources` and `data` projection without field selection.

Successful list results SHALL include bounded Artifact summaries with identifiers, names, processing state, Publication state, timestamps, and available recovery or management evidence. Successful Upload SHALL include the Artifact and ready Version. Publication reads and mutations SHALL include effective Publication state, expiration, Copy eligibility, and the stable Share link when one exists. Successful Export SHALL identify the Artifact, Version, and atomically installed local destination. Successful Delete SHALL identify the deleted Artifact without returning deleted content.

#### Scenario: Agent lists Artifacts

- **WHEN** an authenticated caller lists owned Artifacts in Agent mode
- **THEN** one completed envelope contains the bounded Artifact summaries without a table, progress text, or selected-field wrapper

#### Scenario: Agent uploads a ready Version

- **WHEN** an Agent Upload completes Server processing successfully
- **THEN** one completed envelope identifies the Artifact and immutable ready Version and does not claim a Publication unless one already exists in returned Server state

#### Scenario: Agent views Publication state

- **WHEN** an Agent views an Artifact that has never been Published
- **THEN** one completed envelope reports Not published and no Share link

#### Scenario: Agent exports a Version

- **WHEN** an Agent exports an explicit ready Version successfully
- **THEN** one completed envelope is emitted only after the destination ZIP is atomically installed and identifies its local destination

#### Scenario: Agent deletes an Artifact

- **WHEN** an Agent supplies an explicit Artifact identifier and confirmed permanent-deletion option and Delete completes
- **THEN** one completed envelope identifies the deleted Artifact

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

Agent mode SHALL treat explicit Publish and Unpublish intent as sufficient authorization when all decision-relevant inputs are supplied. Permanent Artifact Delete and Share-link replacement SHALL require explicit confirmation in the current invocation. Missing irreversible confirmation SHALL return `action_required` with `confirm_irreversible` before any mutation.

#### Scenario: Explicit Publish is complete

- **WHEN** an Agent invocation explicitly requests Publish with all required Artifact, Version, and expiration inputs
- **THEN** the CLI does not ask for a redundant confirmation

#### Scenario: Explicit Unpublish is complete

- **WHEN** an Agent invocation explicitly requests Unpublish for the target Artifact
- **THEN** the CLI does not ask for a redundant confirmation

#### Scenario: Delete lacks confirmation

- **WHEN** an Agent Delete supplies an explicit Artifact identifier but lacks irreversible confirmation
- **THEN** the CLI returns `action_required` and performs no DELETE request

#### Scenario: Link replacement lacks confirmation

- **WHEN** Agent-mode Publish requests Share-link replacement without irreversible confirmation
- **THEN** the CLI returns `action_required` and performs no Publication mutation

## MODIFIED Requirements

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
