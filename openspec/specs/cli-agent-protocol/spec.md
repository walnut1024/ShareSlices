# cli-agent-protocol Specification

## Purpose

TBD - created by archiving change add-resumable-agent-cli-protocol. Update Purpose after archive.

## Requirements

### Requirement: Opt into a separate Agent protocol

The CLI SHALL expose `--agent` as a global opt-in mode for executable commands. Every operational Agent invocation MUST also supply `--agent-protocol <version>` selected from capability discovery. `shareslices --agent capabilities` SHALL omit that selector and use a permanently additive version 1 discovery shape. Invocations without `--agent` MUST preserve their existing human-readable output, prompts, progress, formatting flags, and exit behavior.

Agent mode MUST disable interactive prompts and CLI-controlled transient progress. It MUST reject `--json`, `--jq`, and `--template` because the Agent envelope is the sole presentation contract. It MAY accept `--no-progress` as a redundant compatibility flag. Help, version output, and non-executable command groups SHALL remain CLI metadata outside Agent protocol version 1 and MUST NOT be combined with `--agent`.

#### Scenario: Preserve a human invocation

- **WHEN** a caller runs an existing command without `--agent`
- **THEN** the CLI preserves its existing stdout, stderr, prompting, formatting, and exit behavior

#### Scenario: Reject another machine presentation

- **WHEN** a caller combines `--agent` with `--json`, `--jq`, or `--template`
- **THEN** the CLI performs no API request and returns a failed Agent envelope

#### Scenario: Select a supported Agent protocol

- **WHEN** a caller supplies `--agent-protocol 1` and capabilities advertise protocol version 1
- **THEN** the CLI executes the requested operation using the version 1 envelope

#### Scenario: Reject an unsupported Agent protocol

- **WHEN** a caller supplies an Agent protocol version not advertised by capabilities
- **THEN** the CLI performs no credential-store or network access and returns a local failed result identifying the supported versions

#### Scenario: Missing ordinary input cannot prompt

- **WHEN** an Agent invocation omits a decision-relevant identifier or value other than an irreversible confirmation
- **THEN** the CLI does not read stdin, performs no mutation, and returns a local failed outcome

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

### Requirement: Emit one versioned outcome envelope

Every CLI-controlled result after Agent mode is recognized, including local argument or usage failures, MUST emit exactly one JSON document on stdout. The CLI MUST NOT emit its own progress, prompts, or diagnostic text on stderr in Agent mode.

Every version 1 envelope SHALL contain `protocolVersion`, `cliVersion`, `operation`, `outcome`, `resources`, and `data`. It MAY contain `error`, `nextAction`, and `continuation` only when applicable. JSON field names SHALL use camelCase; stable machine codes SHALL use lower_snake_case. Human-readable messages MUST NOT be the machine contract.

Protocol version 1 MAY add optional fields or new stable error codes without changing version. Removing, renaming, or retyping a field, making an optional field required, or changing the meaning of an existing field or outcome MUST use a new protocol version.

#### Scenario: Command completes

- **WHEN** an Agent command completes its requested operation
- **THEN** stdout contains one version 1 envelope with the stable operation, `completed` outcome, and command-specific resources or data
- **AND** stderr contains no CLI-produced output

#### Scenario: Local validation fails

- **WHEN** Agent command input fails local validation
- **THEN** stdout contains one version 1 envelope with a `failed` outcome and stable error code
- **AND** no API request is made

#### Scenario: Version 1 evolves additively

- **WHEN** the CLI adds an optional envelope field without changing existing field meanings or types
- **THEN** it MAY continue to emit protocol version 1

#### Scenario: Envelope semantics break compatibility

- **WHEN** an implementation removes, renames, retypes, requires, or changes the meaning of an existing version 1 field
- **THEN** it MUST use a protocol version greater than 1

### Requirement: Classify operation outcomes explicitly

Agent envelopes SHALL use only these version 1 outcomes:

- `completed` when the requested operation is confirmed complete;
- `in_progress` when accepted Server work exists but has not reached a terminal state;
- `partial` when a compound operation produced known durable resources but a later requested stage did not complete;
- `action_required` when a person must act or decide before continuation;
- `failed` when the operation is confirmed not to have completed as requested;
- `indeterminate` when a transmitted mutation may have applied but the CLI cannot prove its result;
- `cancelled` when the caller cancelled before the requested operation completed.

The process SHALL exit with code `0` for `completed`, `2` for `cancelled`, `4` for `action_required`, and `1` for `in_progress`, `partial`, `failed`, or `indeterminate`. Exit codes MUST NOT replace the envelope outcome.

#### Scenario: Work remains active on the Server

- **WHEN** the CLI can prove that an accepted asynchronous operation still exists but cannot yet report its terminal result
- **THEN** it returns `in_progress` with every known durable resource and a structured state-inspection or delayed-retry action

#### Scenario: Compound work stops after a durable stage

- **WHEN** an earlier stage of a compound command created a durable resource and a later requested stage does not complete
- **THEN** the CLI returns `partial` and identifies the confirmed resources without claiming the final requested state

#### Scenario: Mutation result is uncertain

- **WHEN** the CLI transmitted a mutation but cannot confirm whether it took effect
- **THEN** it returns `indeterminate`, does not claim success, and does not automatically repeat an unsafe mutation

#### Scenario: Human action is required

- **WHEN** an operation cannot continue without authorization, clarification, irreversible confirmation, installation, or another human action
- **THEN** the CLI returns `action_required` and process exit code 4

#### Scenario: Caller cancels

- **WHEN** the caller cancels before the requested operation completes
- **THEN** the CLI returns `cancelled`, process exit code 2, and every side effect that is already known

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

### Requirement: Cover the complete official Skill command surface

Every operation advertised by Agent capabilities MUST use the common envelope for success, local failure, authentication requirement, Server failure, cancellation, and partial or indeterminate results where applicable. The official Skill MUST NOT switch to Agent mode until every command it advertises has version 1 coverage. Unsupported operations MUST NOT fall back to human output, selected-field JSON, interactive prompts, or hand-written REST calls.

#### Scenario: Exercise every advertised operation

- **WHEN** process-level contract tests invoke every advertised operation through the production parser and dispatcher
- **THEN** every invocation produces exactly one valid version 1 envelope and the documented process exit code

#### Scenario: One advertised Skill operation lacks Agent support

- **WHEN** release validation finds an official Skill operation without version 1 Agent coverage
- **THEN** the revised Agent-mode Skill is not released
