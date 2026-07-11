# cli-auth Specification Delta

## ADDED Requirements

### Requirement: Start browser authorization

The system SHALL let an unauthenticated ShareSlices CLI start a short-lived device authorization for the fixed `shareslices-cli` client. The response MUST include an opaque device code, a human-readable user code, a verification URL, a code-complete verification URL, an expiry, and a minimum polling interval. The server MUST reject unrecognized client identifiers.

#### Scenario: Start authorization

- **WHEN** the CLI starts authorization for `shareslices-cli`
- **THEN** the server creates one pending authorization and returns every value needed to instruct the user and poll safely

#### Scenario: Reject another client

- **WHEN** a caller requests device authorization with an unrecognized client identifier
- **THEN** the server rejects the request without creating a pending authorization

### Requirement: Open or explain the browser step

`shareslices auth login` SHALL print the verification URL and human-readable user code before attempting to open the code-complete URL in the default browser. Failure to open the browser MUST NOT cancel polling or hide the manual instructions.

#### Scenario: Browser opens

- **WHEN** the operating system opens the code-complete verification URL
- **THEN** the CLI continues polling and the user can complete authorization in the browser

#### Scenario: Browser cannot open

- **WHEN** the operating system cannot open a browser
- **THEN** the CLI keeps the printed URL and user code visible and continues waiting for manual completion

### Requirement: Authenticate and explicitly decide in the Web UI

The verification page SHALL require a valid browser Cookie Session, preserve the pending destination through email/password login, and show the signed-in account plus **ShareSlices CLI** before allowing approval or denial. Opening the page or entering a user code MUST NOT approve access without an explicit user action.

#### Scenario: Signed-out user follows the verification URL

- **WHEN** a signed-out user opens a valid verification URL
- **THEN** the Web UI sends the user through login and returns to the same pending authorization after successful login

#### Scenario: User approves the CLI

- **WHEN** the signed-in user reviews the requesting client and selects **Approve**
- **THEN** the authorization is bound to that user and becomes approved without changing the browser Session

#### Scenario: User denies the CLI

- **WHEN** the signed-in user selects **Deny**
- **THEN** the authorization becomes denied and no CLI Session is created

#### Scenario: Another user attempts approval

- **WHEN** an authorization already claimed by one user is submitted by a different signed-in user
- **THEN** the server rejects the decision without changing the claimed authorization

### Requirement: Poll within server limits

The CLI SHALL poll no faster than the server-provided interval, stop at the authorization expiry, and handle `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, and `invalid_grant` as stable protocol results. A `slow_down` result MUST increase the next delay. Cancelling the command MUST stop local polling and MUST NOT create a Session.

#### Scenario: Authorization is still pending

- **WHEN** the CLI polls a valid authorization before the user decides
- **THEN** the server returns `authorization_pending` and the CLI waits at least the required interval before polling again

#### Scenario: CLI polls too quickly

- **WHEN** the CLI polls earlier than allowed
- **THEN** the server returns `slow_down` and the CLI increases its polling delay

#### Scenario: Authorization expires

- **WHEN** the authorization reaches its expiry before approval
- **THEN** the CLI stops polling, reports expiration without exposing a secret, and no CLI Session is created

#### Scenario: User denies authorization

- **WHEN** the CLI polls after the user denied authorization
- **THEN** the CLI stops polling, reports denial, and receives no credential

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
