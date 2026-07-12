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

### Keep SMTP configuration independent of the secret store

Development and production use the same Nodemailer SMTP adapter. The adapter reads one Nodemailer connection URL from exactly one of `AUTH_EMAIL_SMTP_URL` or `AUTH_EMAIL_SMTP_URL_FILE`; startup fails when neither or both are configured in SMTP mode. The URL is passed to Nodemailer without ShareSlices-specific parsing or provider branches. It carries the scheme, host, port, optional percent-encoded credentials, and only transport query parameters supported by Nodemailer, so changing deployment requires replacing one value rather than changing application behavior.

`AUTH_EMAIL_FROM` separately owns the stable RFC 5322 sender identity, such as `ShareSlices <no-reply@example.com>`. The SMTP URL selects transport; the sender setting selects the identity that the deployment has authorized with its mail provider. Switching providers for the same authorized identity changes only the SMTP URL, while a deployment using another sender domain configures its sender once.

The file form lets Docker secrets, systemd credentials, Kubernetes Secrets, Vault agents, or another deployment facility mount the URL without making ShareSlices depend on that facility. Local Compose uses the non-secret URL `smtp://mailpit:1025`. Production uses the provider's documented host, port, credentials, and encryption mode expressed as a Nodemailer URL: `smtp://...:587?requireTLS=true` for required STARTTLS or `smtps://...:465` for implicit TLS. Neither URL nor credentials may be logged.

A Kubernetes-only secret contract was rejected because supported intranet deployments may not use Kubernetes. Separate host, port, username, password, and TLS variables were rejected because they make provider switching a coordinated multi-value change and create more invalid configuration combinations. A ShareSlices-specific SMTP URL grammar and provider-specific adapters were rejected because they duplicate Nodemailer behavior and make ordinary provider changes application concerns.

SMTP is the only authentication-email delivery mode in development, automated integration tests, and production. Local Compose delivers to Mailpit through SMTP, while production changes the SMTP URL and sender identity. Unit tests may replace the adapter at a module boundary, but dispatcher integration and end-to-end account-flow tests must exercise an SMTP server and assert the received message content.

The previous capture mode was rejected because it marked a delivery sent while discarding the message, so it could not prove that a person could obtain the code. The generic HTTP mode was rejected because its private JSON contract was not compatible with provider APIs and created a second production transport without a product requirement.

Startup reads exactly one SMTP URL source, validates its protocol and sender configuration, and constructs the transporter. SMTP network reachability is not an API readiness dependency: an SMTP outage must not prevent login or Artifact management. Deployments run `mise run smtp-check` explicitly to call Nodemailer's transport verification before enabling email-dependent account flows; local Compose separately waits for Mailpit health. Runtime connection, TLS, authentication, and provider failures remain isolated behind durable retries and the circuit breaker.

Making SMTP connectivity part of API readiness was rejected because an external mail outage would take unrelated product capabilities offline. Deferring even local configuration validation until the first delivery was rejected because malformed or conflicting configuration should fail deterministically at startup.

SMTP delivery is at least once. Each durable delivery owns one stable RFC 5322 `Message-ID`; every bounded retry reuses that ID and sends the same recipient, subject, body, and six-digit code. A crash after SMTP acceptance but before the database records success may therefore produce a duplicate message. The duplicate remains usable because retries do not rotate the code, and an `ambiguous_delivery_retry` event identifies this recovery path.

Strict provider-side deduplication was rejected because standard SMTP has no idempotency-key contract and `Message-ID` deduplication is not guaranteed. Adding a provider HTTP API only to close this rare ambiguity was rejected in favor of transport portability, bounded retries, stable message identity, and the existing delivery limits.

Local Compose runs Mailpit as a container. A containerized API reaches its SMTP listener through the Compose network at `mailpit:1025`; a host-process API reaches it through `smtp://127.0.0.1:1025`. Compose publishes SMTP only as `127.0.0.1:1025:1025` and the Web interface only as `127.0.0.1:8025:8025`, so development processes and a browser on the Docker host can use Mailpit while other machines on the network cannot reach either port by default. Kubernetes and production manifests do not deploy Mailpit.

Local Compose enables registration email verification by default so the complete registration flow is available immediately through Mailpit; a local `.env` may turn it off for policy testing. Kubernetes and production examples keep registration verification disabled until the operator validates SMTP with `mise run smtp-check` and deliberately enables the policy.

Authentication email has three explicit English templates: registration verification, password-reset verification, and password-changed notification. Each message has plain-text and minimal HTML bodies. Verification messages contain the six-digit code, its ten-minute lifetime, and guidance to ignore an unrequested message; the password-changed notification contains no code and directs an unintended recipient to contact their administrator. Subjects never contain codes, and templates contain no login link, reset link, button, application origin, domain, or IP address.

A template engine and deployment-aware links were rejected because three fixed transactional messages do not justify another abstraction and link delivery would reintroduce the intranet-domain problem that led to six-digit codes.

The SMTP adapter supports unauthenticated relay and username/password SMTP AUTH as represented by a Nodemailer connection URL. SMTP OAuth2 is outside the first version because token acquisition and refresh require additional provider-specific configuration that cannot be reduced to one stable URL. A deployment that mandates OAuth2 places an organization-managed SMTP relay between ShareSlices and that provider.

TLS certificate validation cannot be disabled by SMTP configuration. Public providers use the system trust store; intranet deployments add their private CA through Node's standard `NODE_EXTRA_CA_CERTS` file mechanism. The adapter forces Nodemailer protocol and message debugging off regardless of URL query parameters so credentials, recipients, codes, and message bodies cannot enter application logs. Local Mailpit uses plain SMTP only inside the private Compose network.

An application-specific insecure-TLS flag was rejected because it would turn a temporary certificate workaround into a deployable credential-interception mode. Private-CA injection preserves certificate verification without adding SMTP-provider behavior to ShareSlices.

The default quality gate starts a disposable in-process SMTP server for adapter integration tests, covering the SMTP exchange, envelope, sender, recipient, subjects, bodies, six-digit code, stable `Message-ID`, failure handling, and secret-free logs without requiring Docker. The full YAML account-flow gate depends on Compose Mailpit, retrieves each message through Mailpit's API by its unique test recipient, extracts the code, and completes registration verification and password reset through public HTTP routes. Tests do not use a capture delivery mode.

Every deployment explicitly configures `AUTH_EMAIL_FROM`; only local Compose supplies the development identity `ShareSlices <no-reply@shareslices.local>`. ShareSlices never derives the sender from SMTP credentials. `mise run smtp-check` always runs Nodemailer's connection verification; when `AUTH_EMAIL_SMTP_CHECK_TO` is configured, it additionally sends a probe message to verify that the provider accepts the configured sender. The probe recipient is optional because some environments permit connectivity checks but prohibit unsolicited test delivery.

SMTP configuration is immutable for one API process lifetime. The URL or URL file is read once and one transporter is constructed at startup. Provider changes update the single URL source, run `mise run smtp-check`, and roll the API replicas; pending deliveries remain durable in PostgreSQL and continue after restart. The adapter does not watch secret files or hot-swap transporters.

Hot reload was rejected because concurrent replicas could retain different credentials and open connections while obscuring which provider handled a delivery. A controlled restart gives one configuration generation per process without losing queued work.

SMTP timing and durable retry behavior use the existing environment-variable configuration system, including Compose `.env` and systemd `EnvironmentFile`; ShareSlices does not add a YAML, JSON, or TOML runtime configuration file. Defaults are a 60-second delivery lease, 5-second DNS timeout, 10-second connection timeout, 10-second greeting timeout, 30-second socket timeout, 30-second persistent retry delay, and three total attempts. Startup requires positive finite integers and rejects a maximum SMTP operation window that is not shorter than the delivery lease. Nodemailer-internal unbounded requeue is disabled so durable retry policy remains in PostgreSQL.

Deployment configuration has one typed code entry point per runtime: `api/src/env.ts` for API configuration and `worker/src/config.rs` for Worker configuration. Runtime modules do not read process environment directly. A root `.env.example` is the operator-facing catalog for every API, Worker, Web proxy, storage, and SMTP variable, grouped by owner and annotated with required, optional, sensitive, and default behavior. Compose and Kubernetes inject those names but do not redefine their semantics, and a repository check detects drift between the catalog, typed runtime schemas, and deployment manifests.

A single cross-language configuration code file was rejected because TypeScript, Rust, Caddy, Compose, and Kubernetes cannot consume it without code generation or a new parser. Per-runtime typed ownership plus one checked deployment catalog provides one maintenance surface for operators without weakening runtime validation.

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
