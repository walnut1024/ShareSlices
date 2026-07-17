# Account Entry Delta

## MODIFIED Requirements

### Requirement: Registration with name, email, and password

A visitor SHALL be able to register with name, email, and password. Registration MUST reject an empty name, an invalid email, an invalid password, or a normalized email already owned by any verified or unverified account without creating an account, verification attempt, or verification delivery. An occupied-email rejection MUST return the stable `email_already_registered` conflict and the Web MUST keep the visitor on Signup with an Email-field message instructing them to use a different email. Successful registration creates at most one user account for the normalized email and MUST NOT create signed-in state or set an authenticated session cookie. When deployment policy requires email verification, successful registration MUST enter email verification before the account may create signed-in state. When deployment policy skips email verification, successful registration MUST direct the user to login without sending a verification email.

#### Scenario: Valid registration with verification required

- **WHEN** a visitor submits a valid name, unoccupied email, and password while registration verification is required
- **THEN** at most one unverified user account exists for the normalized email, one verification delivery is accepted subject to delivery protection, and no signed-in state or session cookie is created

#### Scenario: Valid registration with verification skipped

- **WHEN** a visitor submits a valid name, unoccupied email, and password while registration verification is skipped
- **THEN** a user account is created without a verification delivery, and no signed-in state or session cookie is created

#### Scenario: Occupied verified email

- **WHEN** a visitor submits Signup with a normalized email already owned by a verified account
- **THEN** Signup returns `email_already_registered`, creates no verification attempt or delivery, and the Web tells the visitor on the Email field that the address is occupied and must be changed

#### Scenario: Occupied unverified email

- **WHEN** a visitor submits Signup with a normalized email already owned by an unverified account
- **THEN** Signup returns `email_already_registered`, creates no verification attempt or delivery, and does not replace that account's credentials

#### Scenario: Invalid name

- **WHEN** a visitor submits registration with an empty name
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid email

- **WHEN** a visitor submits registration with an invalid email
- **THEN** registration is rejected and no account is created

#### Scenario: Invalid password

- **WHEN** a visitor submits registration with an invalid password
- **THEN** registration is rejected and no account is created
