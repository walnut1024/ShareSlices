# Add email verification and password reset design

## Context

The current account-entry capability registers a user with name, email, and password, creates no Session at registration, and then allows normal email/password login. It explicitly defers email verification, password reset, and rate limiting. `PRODUCT.md` already defines registration email verification as deployment policy and includes a future administration setting for that policy.

Verification must work in intranet deployments that expose ShareSlices by IP address. Authentication emails therefore use six-digit codes rather than links. The design must also prevent a public request surface from flooding one inbox or exhausting the deployment's email provider.

The implementation spans Web, API, PostgreSQL, Better Auth, OpenAPI, and email infrastructure. Account policy remains in the TypeScript API and does not move into the Rust artifact worker.

## Goals / Non-Goals

**Goals:**

- Prove control of a registration email when deployment policy requires it.
- Recover an email/password account through a six-digit email code.
- Keep registration verification configurable while keeping password-reset verification mandatory.
- Prevent repeated clicks, client retries, targeted inbox flooding, bulk triggering, and provider failure from causing an email storm.
- Keep account existence, limit dimensions, codes, passwords, and reset credentials private.
- Preserve the current quiet desktop authentication design and ordinary login after either flow completes.

**Non-Goals:**

- Building the future administration UI for the registration-verification setting.
- Adding CAPTCHA, multi-factor authentication, email changes, social recovery, phone recovery, organization policy, or mobile layouts.
- Moving account behavior or email dispatch into the Rust artifact worker.

## Decisions

### Use one six-digit code flow for registration and password reset

An `EmailVerification` has an opaque ID and one purpose: `registration` or `password_reset`. Purpose binding prevents a code from crossing flows. The Web uses one semantic numeric input that accepts paste and whitespace rather than six independent fields.

Codes expire after ten minutes, work once, and become blocked after five incorrect submissions. Blocking a verification does not lock the account. A password-reset code produces a single-use restricted reset grant that lasts ten minutes and authorizes only one password change.

Alternatives considered:

- Email links were rejected because an intranet-only deployment may have only an IP address and mail gateways may treat a raw IP link as suspicious.
- Supporting both links and codes was rejected because it doubles states and contract combinations without a current product need.

### Keep registration policy separate from recovery proof

When registration verification is enabled, registration creates or resumes an unverified account state, accepts one code delivery, and creates no Session. Verification marks the email verified, then directs the user to login. An unverified account cannot create a Session while the policy is enabled.

When registration verification is disabled, registration creates the account without a verification delivery and directs the user to login. Disabling the policy also permits email/password login for an account whose email has not been verified. Policy changes do not revoke an active Session.

Password reset always requires a code regardless of registration policy. Successful reset changes the password, revokes every existing Session for that user, sends a password-changed notification, and directs the user to login without creating a Session.

Automatic login after either flow was rejected because the email and browser may be on different devices and because ordinary login keeps Session creation in one existing path.

### Resume one active verification without invalidating a received code

Only one pending verification exists for the same normalized email and purpose. A delivery request during its ten-minute lifetime uses the same code so an attacker cannot continuously invalidate the legitimate user's latest message.

The database stores a salted code hash for verification and a separately encrypted code value for delivery rendering. The encrypted value uses deployment-secret key material, is never logged, and is deleted when the verification is consumed, blocked, or expired. After that point, the next permitted request creates a new verification and code.

Generating a new code on every delivery was rejected because repeated attacker-triggered deliveries could make the user's received codes unusable.

### Enforce server-owned waiting periods and independent limits

The first accepted delivery starts a 60-second server-owned waiting period for the same normalized email and purpose. The Web countdown only displays a rounded server result; repeated requests during the wait do not enqueue email.

Every accepted delivery must pass independent sliding-window or token-bucket limits:

| Dimension | Initial default |
| --- | ---: |
| Normalized email and purpose | 5 deliveries per hour |
| Normalized email and purpose | 10 deliveries per 24 hours |
| Source IP | 20 deliveries per hour |
| Source IP | 100 deliveries per 24 hours |
| Deployment | 500 deliveries per hour |

These values are deployment configuration, not settings in the future administration UI. Email and source-IP buckets are evaluated separately; a combined `IP + email` key would allow an attacker to evade a limit by rotating either value.

Rate-limited responses are neutral. They do not identify the exhausted bucket, its capacity, account existence, or remaining count. The Web may receive a coarse retry duration for user guidance.

A single browser-only countdown was rejected because direct API calls and alternate clients bypass it. An account lockout was rejected because it would allow an attacker to deny access to another user.

### Persist and deduplicate delivery before dispatch

Account HTTP requests do not send email inline. The account transaction creates an `EmailDelivery` with a unique verification-and-sequence key. The request idempotency key resolves repeated client submissions to the same accepted result, and concurrent delivery requests create at most one delivery for a waiting-period interval.

A background dispatcher in the TypeScript API runtime leases pending delivery records, invokes a configurable email adapter, and records success or bounded failure. Multiple API replicas may dispatch safely through expiring leases and compare-and-set state transitions. A provider idempotency key is used when supported.

An in-request email send was rejected because timeout retries can duplicate messages and provider latency would expose account-dependent timing. Dispatch in the Rust worker was rejected because authentication email is ordinary account infrastructure and the worker must not own account policy.

### Stop broad storms with a deployment circuit breaker

A circuit breaker is a deployment-wide pause on new authentication-email deliveries. It opens when the global delivery limit is exhausted or a configured run of provider failures indicates that continued retries would amplify an outage.

While open, new delivery requests return a neutral temporary-unavailable response. Existing codes may still be verified, and password changes authorized by an existing reset grant may still complete. Recovery occurs after a configured pause or explicit operator action. Opening, closing, and suppressed delivery events use stable reason codes without raw email addresses or secrets.

Provider retries are bounded with backoff. Permanent rejection is not retried indefinitely.

### Keep account-recovery responses neutral

Password-reset requests return the same public status, shape, message, and comparable asynchronous path for registered and unregistered emails. A missing email receives a synthetic opaque attempt but no email delivery.

Registration while verification is required also avoids revealing whether a normalized email belongs to a verified or unverified account. An eligible unverified registration may resume its pending verification; a verified account does not receive another registration code. Public content directs the person to check the entered address or login without stating account status.

### Use focused application modules and resource-oriented contracts

- `EmailVerification` owns creation, purpose binding, code checks, consumption, expiry, and failed attempts.
- `PasswordReset` owns restricted grants, password changes, and Session revocation.
- `AuthenticationEmailDelivery` owns durable delivery creation, idempotency, limits, leases, and the circuit breaker.
- Repositories hide Drizzle and transaction details; an email adapter hides provider-specific sending.
- Thin Hono routes validate DTOs and map application results to the checked OpenAPI contract.

The contract direction is:

- `POST /api/users` for registration;
- `POST /api/email-verifications/{verificationId}/deliveries` for another delivery;
- `POST /api/email-verifications/{verificationId}:verify` for registration code proof;
- `POST /api/password-reset-attempts` for a neutral reset attempt;
- `POST /api/password-reset-attempts/{attemptId}:verify` for reset code proof;
- `POST /api/password-resets` to consume a restricted reset grant.

The two `:verify` custom actions are used because proving a secret is not a standard resource create, replace, partial update, or delete. All mutation routes validate trusted origins and return `Cache-Control: no-store`.

### Reuse current authentication composition

The Web reuses `AuthLayout`, existing shadcn Base UI form primitives, and current Geist-aligned tokens. `RegisterPage` replaces its form with a code-entry state when verification is required. `LoginPage` adds `Forgot password?` and can enter a verification-required state for an unverified account. Password reset uses request, code, new-password, and completion pages.

The code page shows a masked destination, the server-owned countdown, `Send another code`, and `Use a different email`. It never receives the full normalized email in a neutral password-reset response.

## Risks / Trade-offs

- **[Risk] Six digits provide limited search space.** → Expire codes after ten minutes, allow five failures, bind purpose and opaque attempt ID, and rate-limit verification submissions.
- **[Risk] Reusing a code requires reversible storage for delivery.** → Encrypt the delivery value with separate deployment-secret key material, restrict decryption to the email adapter path, and delete it with terminal verification state.
- **[Risk] A dispatcher crash after provider acceptance can leave ambiguous delivery state.** → Use provider idempotency when available, bounded retries, and an explicit ambiguous-delivery event instead of unbounded resend.
- **[Risk] IP limits can affect many users behind one intranet gateway.** → Keep IP and deployment thresholds configurable and return retryable neutral feedback; do not weaken the email limit.
- **[Risk] Synthetic missing-account attempts consume storage.** → Give them the same short retention as real attempts and reconcile expired attempts.
- **[Trade-off] Turning registration verification off permits login by previously unverified accounts.** → Accept this as the meaning of deployment policy; turning it on again requires verification at the next login but does not revoke current Sessions.
- **[Trade-off] Authentication email adds background work to the API runtime.** → Keep a deep delivery module and durable leases so it can later move behind another adapter without changing account contracts.

## Migration Plan

1. Add schema and repositories for verification, reset grants, deliveries, limits, and circuit-breaker state.
2. Add the email adapter and dispatcher with a development capture adapter before enabling real delivery.
3. Add application modules, structured events, and API routes behind the deployment policy.
4. Add Web registration verification and password-reset pages.
5. Deploy with registration verification disabled, validate delivery and recovery in the target environment, then enable registration verification.

Rollback disables registration verification and stops accepting new reset attempts while leaving existing account credentials and Sessions intact. Database records remain available for audit and expire through reconciliation; no user or Artifact data is removed.

## Open Questions

None.
