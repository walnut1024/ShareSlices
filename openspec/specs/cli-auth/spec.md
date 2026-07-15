# cli-auth Specification

## Purpose

TBD - created by archiving change cli-browser-auth. Update Purpose after archive.
## Requirements
### Requirement: Start browser authorization

The system SHALL let an unauthenticated ShareSlices CLI start a short-lived device authorization for the fixed `shareslices-cli` client. The response MUST include an opaque device code, a human-readable user code, a verification URL, a code-complete verification URL, an expiry, and a minimum polling interval. The server MUST reject unrecognized client identifiers.

#### Scenario: Start authorization

- **WHEN** the CLI starts authorization for `shareslices-cli`
- **THEN** the server creates one pending authorization and returns every value needed to instruct the user and poll safely

#### Scenario: Reject another client

- **WHEN** a caller requests device authorization with an unrecognized client identifier
- **THEN** the server rejects the request without creating a pending authorization

### Requirement: Negotiate CLI compatibility

The ShareSlices CLI MUST send its semantic version and a bounded operating-system identifier on its API requests. The server SHALL use these values at the HTTP seam for compatibility decisions and safe diagnostics and MUST NOT persist them as user, Session, authorization, or device data. A missing, malformed, or older-than-supported CLI version on a CLI request MUST return `426 Upgrade Required` with code `cli_upgrade_required`, the minimum supported version, and an actionable upgrade instruction.

#### Scenario: Supported CLI starts authorization

- **WHEN** a CLI at or above the minimum supported version starts authorization with a recognized operating-system identifier
- **THEN** the compatibility check passes and authorization creation continues without persisting the client metadata

#### Scenario: Old CLI must upgrade

- **WHEN** a CLI below the minimum supported version starts authorization or makes an authenticated management request
- **THEN** the server returns `426 cli_upgrade_required` with the current and minimum versions and performs no authorization creation or management mutation

#### Scenario: Invalid compatibility metadata

- **WHEN** a CLI request omits the required version or sends malformed version or operating-system metadata
- **THEN** the server rejects the request without creating product state or persisting the metadata

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

### Requirement: Authenticate and explicitly decide in the Web UI

The verification page SHALL require a valid browser Cookie Session, preserve `/device?user_code=...` through email/password login, keep the verification code visible for comparison with the terminal, and show the signed-in account plus **ShareSlices CLI** before allowing approval or denial. The authorization flow MUST NOT offer account switching. Opening the page or entering a user code MUST NOT approve access without an explicit user action.

#### Scenario: Signed-out user follows the verification URL

- **WHEN** a signed-out user opens a valid verification URL
- **THEN** the Web UI sends the user through login and returns to the same pending authorization after successful login

#### Scenario: Compare the code before login

- **WHEN** a signed-out user opens a valid code-complete verification URL
- **THEN** the login screen identifies the ShareSlices CLI request, prominently shows the verification code, and asks the user to compare it with the terminal

#### Scenario: User approves the CLI

- **WHEN** the signed-in user reviews the requesting client and selects **Approve**
- **THEN** the authorization is bound to that user and becomes approved without changing the browser Session

#### Scenario: User denies the CLI

- **WHEN** the signed-in user selects **Deny**
- **THEN** the authorization becomes denied and no CLI Session is created

#### Scenario: Another user attempts approval

- **WHEN** an authorization already claimed by one user is submitted by a different signed-in user
- **THEN** the server rejects the decision without changing the claimed authorization

#### Scenario: Authorization offers no account switch

- **WHEN** a signed-in user reviews the account that will authorize the CLI
- **THEN** the page shows that account without a switch-account action or device, CLI-version, Scope, Session-ID, token-lifetime, refresh, or credential-store details

### Requirement: Confirm browser authorization completion

After approval, the Web UI SHALL replace the review state on the same `/device?user_code=...` route with a success state that identifies the authorized account, directs the user back to the terminal, and says the window can be closed. The success state MUST NOT display the Bearer credential, Session ID, device information, CLI version, Scope, expiry, refresh behavior, or credential-store implementation.

#### Scenario: Approval completes in the browser

- **WHEN** the signed-in user approves a valid pending CLI authorization
- **THEN** the same route shows **CLI authorized**, identifies the account, and directs the user to return to the terminal and close the window

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

### Requirement: Issue an independent CLI Session

Exchanging an approved device code SHALL consume that code exactly once and create a new server-side Session for the approving ShareSlices user. The returned Bearer credential MUST represent the new CLI Session, MUST NOT be the approving browser Cookie, and MUST NOT revoke or refresh the approving browser Session.

#### Scenario: Exchange an approved code

- **WHEN** the CLI exchanges an approved, unexpired device code with the matching client identifier
- **THEN** the server returns one Bearer credential and expiry for a newly created CLI Session owned by the approving user

#### Scenario: Replay an exchanged code

- **WHEN** a caller repeats an exchange after the approved device code was consumed
- **THEN** the server returns `invalid_grant` and does not create another Session

#### Scenario: Browser and CLI Sessions remain separate

- **WHEN** device authorization succeeds
- **THEN** both the original browser Session and the new CLI Session remain independently valid

### Requirement: Store the credential securely

The CLI MUST store the Bearer credential only in the operating system credential store under an entry scoped to the normalized API origin. It MUST NOT write the credential to a normal file, shell configuration, command history, standard output, standard error, or application log, and MUST NOT provide a plaintext fallback.

#### Scenario: Credential storage succeeds

- **WHEN** the server issues a CLI credential and the operating system credential store accepts it
- **THEN** the CLI stores it for the selected API origin and reports the signed-in account without printing the credential

#### Scenario: Credential storage fails

- **WHEN** the server issues a CLI credential but the operating system credential store rejects it
- **THEN** the CLI attempts to revoke the new CLI Session, stores no plaintext fallback, and returns actionable failure output without the credential

### Requirement: Authenticate management requests with Bearer

JSON management API routes that resolve the current user SHALL accept either the existing Cookie Session or a valid CLI Bearer Session and SHALL map both to the same ShareSlices user identity and ownership rules. Preview content routes MUST remain Cookie Session-only, and Viewer routes MUST remain public according to their existing publication rules.

#### Scenario: Valid CLI Bearer Session

- **WHEN** the CLI calls a JSON management route with a valid Bearer credential
- **THEN** the route acts for the credential's ShareSlices user under the same authorization and ownership checks as a Cookie-authenticated request

#### Scenario: Invalid CLI Bearer Session

- **WHEN** a management request carries an expired, revoked, or malformed Bearer credential
- **THEN** the API returns the standard `401 unauthenticated` response without revealing credential details

#### Scenario: Bearer cannot access Preview content

- **WHEN** a Bearer-only client requests an owner Preview content route
- **THEN** the API returns unauthenticated and serves no Artifact content

### Requirement: Report CLI authentication status

`shareslices auth status` SHALL read the credential for the selected API origin and call the current-user endpoint before reporting the signed-in account. A missing credential SHALL report signed out. An expired or revoked credential SHALL be removed from the credential store and reported as signed out. Network and server failures MUST remain distinguishable from signed-out state.

#### Scenario: Stored credential is valid

- **WHEN** `auth status` validates a stored credential successfully
- **THEN** the CLI reports the current ShareSlices account without printing the credential

#### Scenario: Stored credential is invalid

- **WHEN** `auth status` receives `401 unauthenticated` for a stored credential
- **THEN** the CLI deletes that credential and reports signed out

#### Scenario: Status request cannot reach the server

- **WHEN** credential validation fails because of a network or server error
- **THEN** the CLI reports that failure and does not claim that the user is signed out

#### Scenario: Session is no longer valid

- **WHEN** status confirms that the stored CLI Session is expired or revoked
- **THEN** the CLI reports that the user must run `shareslices auth login` again without showing a Session ID, Scope, credential-store path, fixed lifetime, or refresh state

### Requirement: Avoid duplicate interactive login

`shareslices auth login` SHALL validate any existing stored credential before starting a new authorization. A valid credential SHALL cause the command to report the current account without creating another authorization; changing accounts requires logout first.

#### Scenario: Login while already signed in

- **WHEN** `auth login` finds and validates an existing credential
- **THEN** the CLI reports the current account and creates neither a pending authorization nor another Session

### Requirement: Log out only the current CLI Session

`shareslices auth logout` SHALL request revocation using only the stored Bearer credential. Successful revocation or an `unauthenticated` response SHALL remove the local credential. A network or server failure SHALL retain the local credential for retry. CLI logout MUST NOT revoke any browser Session or another CLI Session.

#### Scenario: Successful CLI logout

- **WHEN** the CLI revokes its valid current Session
- **THEN** the server returns `204`, that Bearer credential becomes unauthenticated, and the CLI removes it locally

#### Scenario: CLI Session already expired

- **WHEN** logout receives `401 unauthenticated` for the stored credential
- **THEN** the CLI removes the stale credential and reports signed out

#### Scenario: Logout request fails transiently

- **WHEN** logout encounters a network or server failure
- **THEN** the CLI retains the credential, reports the failure, and allows a later retry

#### Scenario: Preserve other Sessions

- **WHEN** one CLI Session is logged out while the same user has a browser Session or another CLI Session
- **THEN** only the calling CLI Session is revoked

### Requirement: Keep deferred credential types out of scope

The CLI and Web auth surfaces in this capability MUST NOT expose AK/SK creation, API keys, service accounts, CI login, organization credentials, third-party OAuth client registration, or delegated scope controls.

#### Scenario: Inspect first CLI auth surfaces

- **WHEN** a user inspects the CLI auth commands and Web verification page
- **THEN** only interactive browser authorization, status, and current-CLI-Session logout are available

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

