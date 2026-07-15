# management-api-error-contract Specification

## Purpose
TBD - created by archiving change add-resumable-agent-cli-protocol. Update Purpose after archive.
## Requirements
### Requirement: Return one stable language-neutral error envelope

Every JSON management API failure SHALL return an `error` object containing a stable lower-snake-case `code`, a non-empty sanitized `message`, and a `requestId`. The response SHALL include the same identifier in `X-Request-Id`.

The error object MAY include `fields`, `action`, and code-specific `details`. It MUST NOT include credentials, Cookies, Session tokens, Share slugs, raw Artifact or archive-entry content, internal object keys, stack traces, or library-specific error values.

#### Scenario: Caller receives a classified failure

- **WHEN** a management request fails with a known product or protocol condition
- **THEN** the response contains the stable error code, safe message, and matching body and header request identifier

#### Scenario: Server encounters an unexpected failure

- **WHEN** the Server cannot classify an unexpected failure safely
- **THEN** it returns `internal_error` with a generic message and request identifier without exposing internal evidence

### Requirement: Keep Server facts separate from client next actions

The Management API SHALL expose only Server-authoritative facts and optional human-readable corrective guidance. It MUST NOT return CLI- or Skill-specific outcomes, next actions, continuations, command arguments, prompt instructions, local-file decisions, or orchestration state.

An optional `action` SHALL describe a correction supported by Server evidence. Clients MAY map error facts into client-specific next actions, but that mapping is not part of the HTTP contract and MUST NOT branch on action prose.

#### Scenario: CLI version is unsupported

- **WHEN** a Bearer management request uses an unsupported CLI version
- **THEN** the Server returns `cli_upgrade_required`, typed compatibility facts, and safe upgrade guidance without prescribing a CLI continuation or command sequence

#### Scenario: Artifact input must change

- **WHEN** the Server identifies a correctable validation problem
- **THEN** it returns the relevant facts and optional correction without deciding whether an agent may edit, rebuild, ask the user, or stop

### Requirement: Return typed code-specific evidence

Each `fields` entry SHALL contain a bounded input `path`, stable `code`, and sanitized `message`. Each `details` value SHALL conform to a checked schema associated with its error family. CLI compatibility details, request-validation details, size limits, and other evidence MUST use distinct schemas rather than an unrelated catch-all type.

Clients MUST tolerate absent optional `fields`, `action`, or `details`. The Server MUST omit evidence that it does not know.

#### Scenario: Required request input is missing

- **WHEN** a management mutation omits a known required field or header
- **THEN** the Server returns `invalid_request` with a field error identifying that input

#### Scenario: Archive exceeds the streamed limit

- **WHEN** the API stops an Upload because it exceeds the active archive-size limit
- **THEN** it returns `archive_too_large`, the effective `limitBytes`, and a sanitized corrective action

#### Scenario: CLI compatibility fails

- **WHEN** CLI version or operating-system compatibility metadata is malformed or unsupported
- **THEN** `details` conforms to the CLI compatibility schema and does not masquerade as Artifact validation details

### Requirement: Declare compatibility failures on CLI management requests

Every Bearer-capable JSON management route SHALL enforce the shared CLI compatibility check when the request is identified as a CLI request. A missing, malformed, or unsupported CLI version SHALL use the status and error behavior defined by the CLI Auth capability. The checked OpenAPI operation SHALL declare that compatibility response wherever it can occur.

#### Scenario: Old CLI calls a management route

- **WHEN** a CLI below the minimum supported version calls a Bearer-capable management route
- **THEN** the Server returns `426 cli_upgrade_required` before the route performs a product mutation

#### Scenario: OpenAPI describes a management route

- **WHEN** a Bearer-capable management route can return the shared compatibility failure
- **THEN** its checked OpenAPI operation includes the `426` response with the typed compatibility error

### Requirement: Preserve authentication and ownership neutrality

A missing, expired, revoked, or malformed management Session SHALL return `unauthenticated`. A protected lookup that intentionally hides whether a resource exists or belongs to another User SHALL return the capability-defined not-found response without revealing ownership or another User's state.

#### Scenario: Caller reads another User's Artifact

- **WHEN** an authenticated caller supplies an Artifact ID not owned by that caller
- **THEN** the response is indistinguishable from the ordinary `artifact_not_found` response

#### Scenario: Bearer credential is invalid

- **WHEN** a management request contains an expired, revoked, or malformed Bearer credential
- **THEN** the Server returns `unauthenticated` without credential, Session, or account evidence

### Requirement: Distinguish mutation conflict and retry timing

The Server SHALL distinguish `operation_in_progress`, `idempotency_conflict`, and `invalid_artifact_state` error conditions.

The Server SHALL return retry timing only when it owns a meaningful minimum delay. `Retry-After` communicates timing and MUST NOT be interpreted as permission to repeat an unsafe or indeterminate mutation. A `429 rate_limited` response SHALL include `Retry-After` when the Server has rejected work until a known minimum delay.

#### Scenario: Equivalent mutation is still pending

- **WHEN** the same scoped idempotency key identifies an equivalent operation that remains pending
- **THEN** the Server returns `operation_in_progress` and includes `Retry-After` only when it knows a meaningful next-check time

#### Scenario: Key is reused with different input

- **WHEN** the same scoped idempotency key is reused with non-equivalent input
- **THEN** the Server returns `idempotency_conflict` without changing the original operation

#### Scenario: Rate limit owns a delay

- **WHEN** a protected management operation exceeds its Server-owned attempt limit
- **THEN** the Server returns `rate_limited` and the minimum delay before another request may be considered

### Requirement: Validate documented error responses against OpenAPI

Contract tests SHALL validate the status, headers, error-envelope schema, stable code, optional evidence schema, and sensitive-data exclusions for every documented Management API error response. An OpenAPI response MUST NOT be described as implemented until an actual route response passes its contract test.

#### Scenario: Contract test exercises a 426 response

- **WHEN** a Bearer management route declares `426 cli_upgrade_required`
- **THEN** a contract test exercises the implemented response and validates its compatibility details and request identifier

#### Scenario: Implemented response drifts from OpenAPI

- **WHEN** an actual Management API error does not conform to its checked OpenAPI response schema
- **THEN** the contract test fails before release

