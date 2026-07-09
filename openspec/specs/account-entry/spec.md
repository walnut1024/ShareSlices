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

Only successful login SHALL create signed-in state. A signed-in state belongs to exactly one user. Managing, refreshing, revoking, or signing out of signed-in state is outside this capability.

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

The Web UI SHALL expose a dedicated log-in screen with email, password, and a log-in action. Failed login shows neutral failure feedback; successful login shows a lightweight signed-in confirmation.

#### Scenario: Failed login feedback

- **WHEN** a visitor submits failing log-in input
- **THEN** neutral failure feedback is visible and no signed-in confirmation is shown

#### Scenario: Successful login feedback

- **WHEN** a visitor submits correct log-in input
- **THEN** a lightweight signed-in confirmation is shown

### Requirement: Scope boundary

The account entry surface MUST NOT expose password reset, email verification, social login, phone login, sign out, artifact actions, or administration actions. Rate limiting is NOT implemented by this capability; the `429` responses in `api/openapi/openapi.yaml` are reserved for a future change and MUST be excluded from contract tests.

#### Scenario: No deferred actions

- **WHEN** a visitor opens the account entry screens
- **THEN** register and log-in forms are available without any deferred product actions
