# cli-auth Delta Specification

## ADDED Requirements

### Requirement: Resume Agent browser authorization across invocations

`shareslices --agent --agent-protocol 1 auth login` SHALL validate any stored credential and return `completed` when it is already valid. Otherwise it SHALL start or reuse a pending browser authorization, return `action_required` with the verification URL, human-readable user code, expiry, earliest useful check time, and opaque continuation identifier, and then exit without opening a browser or waiting.

`shareslices --agent --agent-protocol 1 auth login --continue <continuationId>` SHALL perform at most one permitted authorization-status or credential-exchange attempt. Its state mapping SHALL be deterministic:

- start and `authorization_pending` return `action_required`, `authorize`, the continuation, and exit code 4;
- a too-early check or `slow_down` returns `action_required`, `retry_later`, the continuation, and exit code 4;
- an exchange claim held by another process returns `in_progress`, `continuation_in_use`, `retry_later`, the continuation, and exit code 1;
- approval with stored credentials returns `completed`, no continuation, and exit code 0;
- denial returns `failed`, `authorization_denied`, no next action or continuation, and exit code 1;
- expiry returns `failed`, `continuation_expired`, `authorize`, no continuation, and exit code 1;
- an invalid or origin-mismatched continuation returns `failed`, its stable error code, no next action or continuation, and exit code 1;
- a consumed continuation returns `failed`, `continuation_consumed`, `inspect_state`, no continuation, and exit code 1;
- unrecoverable credential-store failure returns `failed`, `credential_store_failed`, `contact_support`, no continuation, and exit code 1.

#### Scenario: Agent starts authorization

- **WHEN** an unauthenticated caller runs `shareslices --agent --agent-protocol 1 auth login`
- **THEN** the CLI starts or reuses authorization for the normalized API origin, returns `action_required` with exit code 4 and browser instructions, and does not open a browser or enter a polling loop

#### Scenario: Agent login is already complete

- **WHEN** Agent login finds a valid stored credential
- **THEN** it returns `completed` with the signed-in account and creates neither an authorization nor a continuation

#### Scenario: Authorization remains pending

- **WHEN** a permitted continuation check receives `authorization_pending`
- **THEN** the CLI returns `action_required` with `authorize`, exit code 4, the same continuation identifier, and the next permitted check time

#### Scenario: Authorization is approved

- **WHEN** a continuation exchanges an approved device code and secure credential storage succeeds
- **THEN** the CLI stores the credential for that API origin, consumes the continuation, and returns `completed` with the account, no continuation, and exit code 0

#### Scenario: Authorization is denied

- **WHEN** a continuation receives `access_denied`
- **THEN** the CLI consumes the continuation and returns `failed` with `authorization_denied`, no next action or continuation, and exit code 1

#### Scenario: Continuation is invalid

- **WHEN** a caller supplies an unknown or malformed continuation identifier
- **THEN** the CLI performs no authorization exchange and returns `failed` with `continuation_invalid`, no next action or continuation, and exit code 1

#### Scenario: Credential storage fails

- **WHEN** exchange succeeds but the operating-system credential store rejects the credential
- **THEN** the CLI attempts to revoke the new CLI Session, stores no plaintext fallback, and returns `failed` with `credential_store_failed`, `contact_support`, and exit code 1

### Requirement: Persist only private authentication continuation state

The CLI SHALL store a versioned Agent authentication continuation in a private application-state location bound to one normalized API origin. The public continuation identifier MUST be opaque and unguessable. Sensitive records MUST use atomic writes and restrictive operating-system file permissions.

The private record MAY contain the device code, verification metadata, polling interval, created and expiry timestamps, next permitted check time, and protocol state. It MUST NOT contain a Bearer credential, business command, argv, working directory, local path, Artifact content, or irreversible confirmation. Device codes MUST NOT appear in stdout, stderr, logs, or the public continuation identifier. A terminal record SHALL remove sensitive values immediately and MUST be deleted no later than one hour after the Server-provided original expiry. Every continuation start or check SHALL lazily delete terminal records beyond that limit.

#### Scenario: Persist a pending continuation

- **WHEN** Agent login starts successfully
- **THEN** the CLI atomically stores private authorization state and returns only its opaque continuation identifier

#### Scenario: Continuation expires

- **WHEN** the Server-provided authorization deadline passes
- **THEN** the CLI performs no exchange, removes sensitive continuation values, and returns `failed` with `continuation_expired`, `authorize`, no continuation, and exit code 1

#### Scenario: Continuation belongs to another origin

- **WHEN** a continuation is resumed under a different normalized API origin
- **THEN** the CLI performs no exchange and returns `failed` with `continuation_origin_mismatch`, no next action or continuation, and exit code 1

#### Scenario: Continuation storage is inspected

- **WHEN** a private continuation record is decoded in a security test
- **THEN** it contains no business operation, argv, working directory, local content path, confirmation, or credential

#### Scenario: Terminal marker exceeds its retention limit

- **WHEN** a start or continuation check finds a terminal marker more than one hour beyond its original authorization expiry
- **THEN** the CLI deletes that marker before returning the current operation result

### Requirement: Coordinate concurrent Agent authentication

At most one active authorization challenge SHALL exist per normalized API origin. Repeated Agent login starts before expiry MUST return the existing continuation rather than create another challenge. Continuation checks MUST use an inter-process claim so no more than one exchange request is active for a continuation, and one continuation MUST create at most one stored CLI Session.

The CLI SHALL persist and enforce Server polling timing across processes. A continuation invoked before its next permitted check MUST NOT contact the Server. A `slow_down` response MUST update the persisted next-check time.

#### Scenario: Login starts concurrently

- **WHEN** two Agent processes start login concurrently for the same signed-out API origin
- **THEN** both observe one active challenge and the Server receives no more than one authorization-start request

#### Scenario: Continuation is checked too early

- **WHEN** a caller continues authorization before the persisted next-check time
- **THEN** the CLI makes no exchange request and returns the existing `action_required` state with updated timing and exit code 4

#### Scenario: Server slows continuation polling

- **WHEN** a permitted continuation check receives `slow_down`
- **THEN** the CLI persists the later next-check time and returns `action_required` with `retry_later` and exit code 4

#### Scenario: Continuation is checked concurrently

- **WHEN** two processes continue the same pending authorization
- **THEN** no more than one process exchanges the device code and the process that cannot claim it returns `in_progress` with `continuation_in_use`, `retry_later`, the same continuation, and exit code 1 without creating another Session

#### Scenario: Consumed continuation is checked again

- **WHEN** a caller continues an already consumed authorization
- **THEN** the CLI performs no exchange and returns `failed` with `continuation_consumed`, `inspect_state`, no continuation, and exit code 1

### Requirement: Keep authentication continuation separate from business intent

Authentication SHALL be the only resumable Agent operation in protocol version 1. The CLI MUST NOT persist, infer, or replay the business command that encountered authentication. After authorization completes, the caller SHALL issue a new business invocation using current user intent and local workspace state.

#### Scenario: Publish encounters missing authentication

- **WHEN** an Agent Publish invocation has complete local input but lacks a valid CLI Session
- **THEN** it returns an authorization action without storing Publish arguments, local paths, or Publication intent

#### Scenario: Authorization later completes

- **WHEN** the caller completes the authentication continuation
- **THEN** the CLI returns only the authentication result and does not automatically execute the earlier business operation

### Requirement: Report Agent authentication state consistently

Agent-mode login, status, and logout SHALL use the common Agent envelope. Signed-out status SHALL return `action_required` with an `authorize` next action. Signed-in status SHALL return `completed` with the current account. Logout with no stored credential SHALL be an idempotent completed result. A transient revocation failure SHALL retain the credential and return a failed result that permits a later safe retry.

#### Scenario: Agent status is signed out

- **WHEN** no valid credential exists
- **THEN** Agent status returns `action_required`, `auth_required`, and exit code 4

#### Scenario: Agent status is signed in

- **WHEN** the stored credential resolves a current User
- **THEN** Agent status returns `completed` with the account and no credential value

#### Scenario: Agent logout is already complete

- **WHEN** no credential exists
- **THEN** Agent logout returns `completed` and identifies that the CLI was already signed out

#### Scenario: Agent logout cannot reach the Server

- **WHEN** revocation fails because of a transient network or Server error
- **THEN** Agent logout returns `failed`, retains the local credential, and supplies a safe delayed-retry action

## MODIFIED Requirements

### Requirement: Open or explain the browser step

Human `shareslices auth login` SHALL print the verification URL and human-readable user code before attempting to open the code-complete URL in the default browser. Failure to open the browser MUST NOT cancel human-mode polling or hide the manual instructions.

Agent `shareslices --agent --agent-protocol 1 auth login` MUST NOT open a browser or block while waiting. It SHALL return the browser instructions through the Agent protocol and leave authorization continuation to a later invocation.

#### Scenario: Browser opens

- **WHEN** human-mode login asks the operating system to open the code-complete verification URL successfully
- **THEN** the CLI continues polling and the user can complete authorization in the browser

#### Scenario: Browser cannot open

- **WHEN** human-mode login cannot open a browser
- **THEN** the CLI keeps the printed URL and user code visible and continues waiting for manual completion

#### Scenario: Agent login needs browser authorization

- **WHEN** Agent-mode login creates or reuses a pending authorization
- **THEN** the CLI returns the verification instructions without launching a browser or beginning a blocking polling loop

### Requirement: Poll within server limits

Human-mode login SHALL poll no faster than the Server-provided interval, stop at authorization expiry, and handle `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, and `invalid_grant` as stable protocol results. A `slow_down` result MUST increase the next delay. Cancelling human-mode login MUST stop local polling and MUST NOT create a Session.

Agent-mode continuation SHALL perform at most one permitted Server check per process invocation and SHALL persist the Server-provided interval and any `slow_down` adjustment for later invocations.

#### Scenario: Authorization is still pending

- **WHEN** human-mode login polls a valid authorization before the user decides
- **THEN** the Server returns `authorization_pending` and the CLI waits at least the required interval before polling again

#### Scenario: CLI polls too quickly

- **WHEN** an authorization exchange request arrives earlier than allowed
- **THEN** the Server returns `slow_down` and the CLI increases its next permitted check time

#### Scenario: Authorization expires

- **WHEN** authorization reaches expiry before approval
- **THEN** the CLI stops polling or continuation, reports expiration without exposing a secret, and creates no CLI Session

#### Scenario: User denies authorization

- **WHEN** the CLI checks after the user denied authorization
- **THEN** it reports denial and receives no credential

#### Scenario: Agent continuation is pending

- **WHEN** one Agent continuation check receives `authorization_pending`
- **THEN** the process exits with the updated continuation instead of sleeping and polling again
