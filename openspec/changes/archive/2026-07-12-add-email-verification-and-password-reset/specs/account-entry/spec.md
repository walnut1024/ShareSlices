# account-entry delta specification

## MODIFIED Requirements

### Requirement: Registration with name, email, and password

A visitor SHALL be able to register with name, email, and password. Registration MUST reject an empty name, an invalid email, or an invalid password without creating an account. Successful registration creates or resumes at most one user account for the normalized email and MUST NOT create signed-in state or set an authenticated session cookie. When deployment policy requires email verification, successful registration MUST enter email verification before the account may create signed-in state. When deployment policy skips email verification, successful registration MUST direct the user to login without sending a verification email.

#### Scenario: Valid registration with verification required

- **WHEN** a visitor submits a valid name, email, and password while registration verification is required
- **THEN** at most one unverified user account exists for the normalized email, one verification delivery is accepted subject to delivery protection, and no signed-in state or session cookie is created

#### Scenario: Valid registration with verification skipped

- **WHEN** a visitor submits a valid name, email, and password while registration verification is skipped
- **THEN** a user account is created without a verification delivery, and no signed-in state or session cookie is created

#### Scenario: Invalid name

- **WHEN** a visitor submits registration with an empty name
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid email

- **WHEN** a visitor submits registration with an invalid email
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid password

- **WHEN** a visitor submits registration with an invalid password
- **THEN** registration is rejected and no account is created

### Requirement: Email/password login

A registered user SHALL be able to log in with the correct email and password. Successful login creates a signed-in state. A wrong password or an unregistered email MUST NOT log in or create signed-in state. When deployment policy requires email verification, an account whose email is unverified MUST NOT create signed-in state and SHALL be able to request a registration-purpose code subject to delivery protection. When deployment policy skips email verification, an unverified email marker MUST NOT block otherwise valid email/password login.

#### Scenario: Correct verified credentials

- **WHEN** a registered user with a verified email logs in with the correct email and password
- **THEN** login succeeds and a signed-in state is created

#### Scenario: Correct unverified credentials while verification is required

- **WHEN** a registered user with an unverified email submits correct credentials while registration verification is required
- **THEN** no signed-in state is created and the user can request a registration-purpose verification code

#### Scenario: Correct unverified credentials while verification is skipped

- **WHEN** a registered user with an unverified email submits correct credentials while registration verification is skipped
- **THEN** login succeeds and a signed-in state is created

#### Scenario: Wrong password

- **WHEN** a user logs in with a registered email and a wrong password
- **THEN** login fails and no signed-in state is created

#### Scenario: Unknown email

- **WHEN** a user logs in with an unregistered email
- **THEN** login fails and no signed-in state is created

### Requirement: Web log-in screen

The Web UI SHALL expose a dedicated login page with email, password, a login action, and a **Forgot password?** action. Failed login shows neutral failure feedback. Successful login MUST open the signed-in user's Artifact list without requiring a separate confirmation action. An unverified-account response while registration verification is required SHALL offer a protected way to request a verification code without exposing whether a submitted password was correct in other failure cases.

#### Scenario: Failed login feedback

- **WHEN** a visitor submits failing login input
- **THEN** neutral failure feedback is visible and the visitor remains on the login page

#### Scenario: Successful login navigation

- **WHEN** a visitor submits correct login input permitted by the current verification policy
- **THEN** signed-in state is retained and the Web UI opens `/artifacts` without showing a continuation action

#### Scenario: Reach password reset

- **WHEN** a visitor selects **Forgot password?**
- **THEN** the Web opens a password-reset request page that asks for email

### Requirement: Scope boundary

The account-entry surface MUST NOT expose social login, phone login, artifact actions, administration actions, CAPTCHA, multi-factor authentication, email changes, or recovery methods other than email. Registration email verification and password reset SHALL use six-digit email codes. The registration-verification deployment setting, email delivery limits, and circuit-breaker thresholds MUST NOT be editable from the user-facing account-entry surface. The future administration setting is outside this capability change.

#### Scenario: Account-entry actions remain focused

- **WHEN** a visitor opens the account-entry pages
- **THEN** only registration, login, registration email verification, and email password-reset actions required by the current state are available

## ADDED Requirements

### Requirement: Web sign-up page

The Web UI SHALL expose a dedicated self-service sign-up page with name, email, password, and a sign-up action. Invalid input MUST produce visible field-level feedback and MUST NOT imply account creation. When registration verification is required, accepted sign-up SHALL replace the form with a code-entry state that includes a masked destination, one accessible numeric code input, a server-owned resend countdown, a resend action, and an action to use a different email. Successful verification SHALL direct the user to login without creating signed-in state.

#### Scenario: Reach the sign-up form

- **WHEN** a visitor opens the sign-up page
- **THEN** a form with name, email, password, and a sign-up action is available

#### Scenario: Invalid input feedback

- **WHEN** a visitor submits invalid name, email, or password input
- **THEN** field-level feedback is visible and no account is created

#### Scenario: Enter registration verification

- **WHEN** registration is accepted while registration verification is required
- **THEN** the Web shows the masked destination, verification-code input, resend waiting period, resend action, and use-different-email action

#### Scenario: Complete registration verification

- **WHEN** the visitor submits the correct active registration code
- **THEN** the email becomes verified and the Web directs the visitor to login without creating signed-in state

#### Scenario: Skip registration verification

- **WHEN** registration is accepted while registration verification is skipped
- **THEN** the Web shows that the account was created and directs the visitor to login without showing code controls

### Requirement: Deployment-controlled registration verification

The backend SHALL treat registration email verification as deployment policy. Enabling the policy MUST require a verified email before email/password login creates signed-in state. Disabling the policy MUST permit otherwise valid email/password login without email verification. A policy change MUST NOT revoke an active signed-in state or disable password-reset verification.

#### Scenario: Enable registration verification

- **WHEN** registration verification changes from skipped to required
- **THEN** a later login by an account with an unverified email requires verification and existing signed-in states remain active

#### Scenario: Disable registration verification

- **WHEN** registration verification changes from required to skipped
- **THEN** a later valid email/password login is allowed without email verification and password reset still requires an email code

### Requirement: Purpose-bound email verification codes

The backend SHALL create cryptographically random six-digit email codes bound to an opaque verification ID, normalized email, and one purpose. A code MUST expire ten minutes after creation, MUST work successfully at most once, MUST become blocked after five incorrect submissions, and MUST NOT cross registration and password-reset purposes. Blocking or expiry MUST NOT lock or deactivate the user account.

#### Scenario: Verify a correct active code

- **WHEN** a user submits the correct unexpired code for its verification ID and purpose
- **THEN** the verification succeeds once and the code cannot be successfully used again

#### Scenario: Reject a wrong-purpose code

- **WHEN** a registration code is submitted to a password-reset attempt or a password-reset code is submitted to registration verification
- **THEN** verification fails without completing the other purpose

#### Scenario: Block repeated incorrect codes

- **WHEN** five incorrect codes are submitted for one verification
- **THEN** that verification becomes blocked and the user account remains available for a later protected attempt

#### Scenario: Reject an expired code

- **WHEN** a code is submitted more than ten minutes after its verification was created
- **THEN** verification fails as expired and a later protected attempt may create a new code

### Requirement: Reuse one pending verification

The backend SHALL maintain at most one pending verification for the same normalized email and purpose. A permitted repeated delivery during its lifetime MUST send the same code and MUST NOT invalidate a code already received. The backend MUST store the code hash separately from an encrypted delivery value and MUST delete the encrypted value when the verification is consumed, blocked, or expired.

#### Scenario: Request another delivery during code lifetime

- **WHEN** another delivery is permitted for a pending verification
- **THEN** the accepted delivery contains the same code and the previously delivered code remains valid

#### Scenario: Reach terminal verification state

- **WHEN** a verification is consumed, blocked, or expired
- **THEN** its encrypted delivery value is deleted and a later permitted attempt creates a new verification and code

### Requirement: Authentication-email delivery protection

The backend SHALL enforce a 60-second server-owned waiting period after an accepted delivery and independent configurable limits for normalized email and purpose, source IP, and deployment-wide volume. The initial defaults SHALL be 5 per email and purpose per hour, 10 per email and purpose per 24 hours, 20 per source IP per hour, 100 per source IP per 24 hours, and 500 per deployment per hour. Requests that exceed a wait or limit MUST NOT enqueue email. Public limit responses MUST NOT identify the exhausted dimension, account existence, capacity, or remaining count.

#### Scenario: Repeat during the waiting period

- **WHEN** another delivery is requested for the same email and purpose within 60 seconds of an accepted delivery
- **THEN** no email is enqueued and the response provides only neutral waiting guidance

#### Scenario: Exhaust the email limit from multiple sources

- **WHEN** requests from multiple source IPs exhaust a normalized email and purpose limit
- **THEN** further deliveries to that email and purpose are suppressed without identifying the exhausted limit

#### Scenario: Exhaust the source limit across multiple emails

- **WHEN** one source IP exhausts its limit across different email addresses
- **THEN** further deliveries from that source are suppressed without identifying the exhausted limit

#### Scenario: Exhaust the deployment limit

- **WHEN** accepted requests reach the configured deployment-wide delivery limit
- **THEN** further authentication-email deliveries are suppressed without preventing verification of existing codes

### Requirement: Durable and idempotent email delivery

An account request SHALL persist an authentication-email delivery before returning and MUST NOT send email inline. Repeated client submissions with the same idempotency key and concurrent delivery requests in the same waiting-period interval MUST produce at most one accepted delivery. A background dispatcher SHALL claim delivery records through expiring leases, record each outcome once, and use bounded provider retries.

#### Scenario: Repeat one delivery request

- **WHEN** a client repeats a delivery request with the same idempotency key
- **THEN** the API returns the original accepted outcome and does not create another delivery

#### Scenario: Submit concurrent delivery requests

- **WHEN** concurrent requests target the same pending verification in one waiting-period interval
- **THEN** at most one delivery is accepted

#### Scenario: Retry a failed provider call

- **WHEN** a temporary provider failure occurs
- **THEN** the dispatcher retries with a bound and does not retry a permanent rejection indefinitely

### Requirement: Authentication-email circuit breaker

The backend SHALL pause new authentication-email deliveries when the deployment-wide limit is exhausted or configured provider-failure conditions are met. While paused, delivery requests MUST return neutral temporary-unavailable results, existing codes MUST remain verifiable, and password changes authorized by an existing reset grant MUST remain completable. Circuit-breaker transitions MUST emit structured operational events without authentication secrets or raw email addresses.

#### Scenario: Open the circuit breaker

- **WHEN** a configured global-volume or provider-failure condition is met
- **THEN** new deliveries pause while existing verification and authorized password-reset completion remain available

#### Scenario: Recover the circuit breaker

- **WHEN** the configured pause ends or an operator explicitly restores delivery
- **THEN** new protected deliveries may be accepted again and the transition is recorded

### Requirement: Neutral password-reset request

A visitor SHALL be able to request password reset by email. Registered and unregistered emails MUST receive the same public status, response shape, message, and comparable asynchronous behavior. An unregistered email MUST NOT enqueue a delivery. The public response MUST expose only a synthetic or real opaque attempt ID and a masked destination.

#### Scenario: Request reset for a registered email

- **WHEN** a visitor requests password reset for a registered eligible email
- **THEN** the API returns the neutral accepted response and accepts a password-reset code delivery subject to delivery protection

#### Scenario: Request reset for an unregistered email

- **WHEN** a visitor requests password reset for an unregistered email
- **THEN** the API returns an equivalent neutral accepted response without enqueueing email

### Requirement: Complete password reset

A correct password-reset code SHALL produce an opaque single-use restricted reset grant that expires after ten minutes and authorizes only one password change for the resolved account. Successful password change MUST consume the grant, revoke all existing Sessions for the user, send a password-changed notification without including the password, and MUST NOT create a new Session.

#### Scenario: Verify a password-reset code

- **WHEN** a visitor submits the correct active code for a password-reset attempt
- **THEN** the API returns a restricted single-use reset grant without creating signed-in state

#### Scenario: Change the password

- **WHEN** a visitor submits matching valid new passwords with an active restricted reset grant
- **THEN** the password changes, the grant is consumed, all existing Sessions are revoked, a password-changed notification is accepted, and no new Session is created

#### Scenario: Reuse a reset grant

- **WHEN** a consumed or expired reset grant is submitted
- **THEN** the password does not change and no Session is affected

### Requirement: Web password-reset flow

The Web SHALL provide password-reset request, code-entry, new-password, and completion states in the existing authentication layout. The code state SHALL use one accessible numeric input, show only a masked destination, display the server-owned resend countdown, and provide resend and use-different-email actions. The new-password state SHALL require the new password twice and apply the registration password policy. Completion SHALL direct the user to login.

#### Scenario: Request password reset in the Web

- **WHEN** a visitor submits an email on the password-reset request page
- **THEN** the Web shows the same code-entry state whether or not the email is registered

#### Scenario: Enter an incorrect code

- **WHEN** a visitor enters an incorrect, malformed, expired, blocked, or already-used reset code
- **THEN** the Web shows neutral state-appropriate feedback without exposing account existence or secrets

#### Scenario: Complete password reset in the Web

- **WHEN** a visitor verifies the code and submits matching valid new passwords
- **THEN** the Web shows password-reset completion and a login action without creating signed-in state

### Requirement: Authentication-secret logging protection

Authentication-email and password-reset logs, traces, errors, and ordinary job-inspection surfaces MUST NOT contain verification codes, passwords, reset grants, message bodies, or raw email addresses. Operational correlation SHALL use safe opaque IDs or a keyed hash of the normalized email.

#### Scenario: Inspect authentication-email operations

- **WHEN** verification, delivery, limit, circuit-breaker, or password-reset events are recorded
- **THEN** the records contain stable reason codes and safe correlation identifiers without authentication secrets or raw email addresses

## REMOVED Requirements

### Requirement: Web register screen

**Reason**: The self-service account action and route component now use the product term sign up.

**Migration**: Use the Web sign-up page requirement and the `signup` query route.
