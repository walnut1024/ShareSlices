# account-entry Specification

## Purpose

Account entry covers the minimum Web/API account flow for registering with name, email, and password, logging in with email/password, and checking the current signed-in user.

## Requirements

### Requirement: Registration with name, email, and password

A visitor SHALL be able to register with name, email, and password. Registration MUST reject an empty name, an invalid email, or an invalid password without creating an account. Successful registration creates a user account with the submitted name and MUST NOT create signed-in state or set an authenticated session cookie.

#### Scenario: Valid registration

- **WHEN** a visitor submits a valid name, email, and password
- **THEN** a user account is created with the submitted name, and no signed-in state or session cookie is created

#### Scenario: Invalid name

- **WHEN** a visitor submits registration with an empty name
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid email

- **WHEN** a visitor submits registration with an invalid email
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid password

- **WHEN** a visitor submits registration with an invalid password
- **THEN** registration is rejected and no account is created

### Requirement: One account per normalized email

One email SHALL map to at most one user account. Email uniqueness MUST use the same normalized value in validation, account lookup, and a database uniqueness constraint. Minimum normalization trims surrounding whitespace and lowercases the email before uniqueness comparison.

#### Scenario: Repeated registration

- **WHEN** a visitor registers twice sequentially with the same normalized email
- **THEN** only one account exists

#### Scenario: Concurrent registration

- **WHEN** two concurrent registrations are submitted for the same normalized email
- **THEN** at most one user account is created

### Requirement: Email/password login

A registered user SHALL be able to log in with the correct email and password. Successful login creates a signed-in state. A wrong password or an unregistered email MUST NOT log in or create signed-in state.

#### Scenario: Correct credentials

- **WHEN** a registered user logs in with the correct email and password
- **THEN** login succeeds and a signed-in state is created

#### Scenario: Wrong password

- **WHEN** a user logs in with a registered email and a wrong password
- **THEN** login fails and no signed-in state is created

#### Scenario: Unknown email

- **WHEN** a user logs in with an unregistered email
- **THEN** login fails and no signed-in state is created

### Requirement: Neutral login failure

Wrong-password and unknown-email login failures MUST be indistinguishable to the user and to ordinary API clients: same HTTP status, same response body shape, same user-facing message. Neither case creates or refreshes signed-in state, and neither case sets an authenticated session cookie. Repeated failed logins keep returning the same neutral failure.

#### Scenario: Failure comparison

- **WHEN** a wrong-password failure and an unknown-email failure are compared
- **THEN** status, body shape, user-facing message, and session/cookie effects are equivalent

### Requirement: Signed-in state ownership

Only successful login SHALL create signed-in state. A signed-in state belongs to exactly one user. User-initiated sign out SHALL revoke only the current signed-in state. Managing, refreshing, or revoking other signed-in states is outside this capability.

#### Scenario: Registration does not sign in

- **WHEN** registration succeeds
- **THEN** an account exists but no signed-in state is created

### Requirement: Current-user check

The current-user check SHALL verify signed-in state and return the ShareSlices user identity without exposing authentication-library internals.

#### Scenario: Valid signed-in state

- **WHEN** a request carries a valid signed-in state
- **THEN** the check returns the ShareSlices user ID for that session

#### Scenario: No signed-in state

- **WHEN** a request carries no signed-in state
- **THEN** the check returns unauthenticated

#### Scenario: After failed login

- **WHEN** a request follows a failed login attempt
- **THEN** the check returns unauthenticated

### Requirement: Web register screen

The Web UI SHALL expose a dedicated registration screen with name, email, password, and a create-account action. Invalid input MUST produce visible field-level feedback and MUST NOT imply account creation.

#### Scenario: Reach the register form

- **WHEN** a visitor opens the register screen
- **THEN** a form with name, email, password, and a create-account action is available

#### Scenario: Invalid input feedback

- **WHEN** a visitor submits invalid name, email, or password input
- **THEN** field-level feedback is visible and no account is created

### Requirement: Web log-in screen

The Web UI SHALL expose a dedicated log-in screen with email, password, and a log-in action. Failed login shows neutral failure feedback. Successful login MUST open the signed-in user's Artifact list without requiring a separate confirmation action.

#### Scenario: Failed login feedback

- **WHEN** a visitor submits failing log-in input
- **THEN** neutral failure feedback is visible and the visitor remains on the log-in screen

#### Scenario: Successful login navigation

- **WHEN** a visitor submits correct log-in input
- **THEN** signed-in state is retained and the Web UI opens `/artifacts` without showing a continuation action

### Requirement: Scope boundary

The account entry surface MUST NOT expose password reset, email verification, social login, phone login, artifact actions, all-session revocation, or administration actions. Rate limiting is NOT implemented by this capability; the `429` responses in `api/openapi/openapi.yaml` are reserved for a future change and MUST be excluded from contract tests.

#### Scenario: No deferred actions

- **WHEN** a visitor opens the account entry screens
- **THEN** register and log-in forms are available without any deferred product actions

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
