# Account entry delta

## ADDED Requirements

### Requirement: Current-session sign out

A signed-in user SHALL be able to sign out of only the current browser Session through `DELETE /api/sessions/current`. Successful sign out MUST revoke the Session identified by the authenticated cookie, expire its cookies, and return `204 No Content`. The response MUST leave every other Session active, contain no body, and expose no authentication-library internals.

#### Scenario: Sign out the current browser session

- **WHEN** a signed-in user deletes the current Session
- **THEN** the API returns `204`, expires the current Session cookies, and subsequent current-user checks with that Session return unauthenticated

#### Scenario: Preserve another browser session

- **WHEN** a user has two browser Sessions and signs out from one of them
- **THEN** the selected Session becomes unauthenticated and the other Session remains authenticated

#### Scenario: Sign out without a valid Session

- **WHEN** a request without a valid authenticated Session deletes the current Session
- **THEN** the API returns the standard `401 unauthenticated` response and does not affect any Session

#### Scenario: Reject a cross-origin sign-out request

- **WHEN** an untrusted origin attempts a cookie-authenticated current-Session deletion
- **THEN** the API returns the standard `403 forbidden` response and the current Session remains authenticated

### Requirement: Web account dropdown sign out

The authenticated Web shell SHALL expose an account dropdown triggered by the current user's avatar. The dropdown MUST show the current user's name and email and provide a **Sign out** action. A successful sign out or an `unauthenticated` response MUST clear local signed-in state and replace the current history entry with the Log-in screen. A network or server failure MUST retain local signed-in state and show neutral failure feedback.

#### Scenario: Reach Sign out from the account dropdown

- **WHEN** a signed-in user opens the avatar account dropdown
- **THEN** the dropdown shows the current user's name and email and exposes a **Sign out** action

#### Scenario: Complete sign out

- **WHEN** the user selects Sign out and the API deletes the current Session
- **THEN** the Web UI clears the current user and replaces the current location with the Log-in screen

#### Scenario: Session already expired

- **WHEN** the user selects Sign out and the API returns `unauthenticated`
- **THEN** the Web UI clears the current user and replaces the current location with the Log-in screen

#### Scenario: Sign-out request fails

- **WHEN** the user selects Sign out and the request fails because of a network or server error
- **THEN** the Web UI retains the current user and shows neutral failure feedback

#### Scenario: Sign-out request is already pending

- **WHEN** the user invokes Sign out while a sign-out request is in flight
- **THEN** the Web UI sends no additional sign-out request

## MODIFIED Requirements

### Requirement: Signed-in state ownership

Only successful login SHALL create signed-in state. A signed-in state belongs to exactly one user. User-initiated sign out SHALL revoke only the current signed-in state. Managing, refreshing, or revoking other signed-in states is outside this capability.

#### Scenario: Registration does not sign in

- **WHEN** registration succeeds
- **THEN** an account exists but no signed-in state is created

### Requirement: Scope boundary

The account entry surface MUST NOT expose password reset, email verification, social login, phone login, artifact actions, all-session revocation, or administration actions. Rate limiting is NOT implemented by this capability; the `429` responses in `api/openapi/openapi.yaml` are reserved for a future change and MUST be excluded from contract tests.

#### Scenario: No deferred actions

- **WHEN** a visitor opens the account entry screens
- **THEN** register and log-in forms are available without any deferred product actions
