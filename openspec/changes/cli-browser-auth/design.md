# CLI Browser Authentication — Design

## Context

ShareSlices currently authenticates management requests only through the `shareslices_session` browser cookie. The Rust CLI has not been scaffolded, but it is the required bridge between the official Skill and the Artifact upload API. Asking the CLI for an email password would expose a user credential to terminals and agent transcripts, while copying a browser cookie would couple two clients and make independent revocation impossible.

Better Auth 1.6.23, already resolved in the repository lockfile, provides Device Authorization and Bearer plugins. Device Authorization creates a distinct server-side Session after a signed-in browser explicitly approves a short-lived code. Its token exchange returns that opaque Session token for Bearer use. ShareSlices will wrap those mechanics in checked product-owned HTTP routes rather than expose Better Auth route names or response types as the public contract.

The CLI must work when invoked by an agent, but this first auth capability remains interactive: a person approves access in a desktop browser. AK/SK credentials for unattended automation are a later capability.

## Goals / Non-Goals

**Goals:**

- Authenticate the CLI without collecting an email password in the terminal.
- Create a CLI Session that is distinct from the approving browser Session and can be revoked independently.
- Store the CLI credential only in the operating system credential store.
- Let existing management routes resolve either the existing Cookie Session or the new Bearer Session to the same ShareSlices user ID.
- Provide deterministic login, status, and logout behavior suitable for direct use and Skill orchestration.
- Keep every public request and response in checked OpenAPI and cover the API cases through YAML/Python contract tests.

**Non-Goals:**

- AK/SK credentials, user-managed API keys, service accounts, CI login, or any other headless authentication.
- OAuth client registration, third-party CLI clients, delegated scopes, organizations, or enterprise SSO.
- Storing credentials in plaintext files, shell configuration, command history, environment variables, or agent-readable output.
- Changing email/password registration and login or revoking the browser Session that approves the CLI.
- Implementing Artifact packaging or upload commands beyond the authenticated HTTP client seam needed by later CLI work.

## Decisions

### Use OAuth Device Authorization through product-owned routes

`shareslices auth login` starts a device authorization for the single fixed public client ID `shareslices-cli`. The server returns an opaque device code, a human-readable user code, the Web verification URL, its code-complete form, the expiry, and the minimum polling interval. The CLI prints the URL and user code before attempting to open the code-complete URL in the default browser. Failure to open a browser is not a login failure; the printed instructions remain usable.

The checked HTTP surface is:

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/cli-authorizations` | none | Start one short-lived authorization for `shareslices-cli` |
| `GET` | `/api/cli-authorizations/{userCode}` | Cookie Session | Validate and claim the pending code for the signed-in user |
| `POST` | `/api/cli-authorizations/{userCode}:approve` | Cookie Session | Explicitly approve the claimed code |
| `POST` | `/api/cli-authorizations/{userCode}:deny` | Cookie Session | Explicitly deny the claimed code |
| `POST` | `/api/cli-sessions` | device code | Poll or exchange an approved code for a Bearer Session |
| `DELETE` | `/api/cli-sessions/current` | Bearer Session | Revoke only the calling CLI Session |

The Web verification route is `/device?user_code=...`. If the browser is not signed in, the existing login screen retains that relative destination and returns there after login. Once signed in, the page claims the code, identifies the requesting client as **ShareSlices CLI**, and requires an explicit **Approve** or **Deny** action. Merely opening the URL never approves it.

Alternatives rejected:

- Email/password input in the CLI exposes a reusable account credential to terminal and agent surfaces.
- A localhost callback flow assumes the CLI can bind a reachable port and adds callback and state handling without improving this limited-input workflow.
- Copying the browser cookie prevents independent client lifecycle and violates the distinction between Session and cookie.

### Wrap Better Auth and keep the checked contract language-neutral

`api/src/http/cli-auth-routes.ts` calls only the selected Better Auth device and Session methods through an injected dependency, maps their results into ShareSlices DTOs, and normalizes library errors into stable lower-snake-case codes. Better Auth remains an Adapter; its internal endpoint paths, table type names, and response types do not become product contracts.

The auth configuration enables `deviceAuthorization` with the absolute Web verification URL, a fixed short expiry and polling interval, and validation that accepts only `shareslices-cli`. It also enables `bearer()` so the existing `auth.api.getSession({ headers })` calls resolve a Bearer Session without changing application service interfaces. The token returned by Better Auth 1.6.23 device exchange is the opaque Session token, so `bearer({ requireSignature: true })` is not used: that option rejects this plugin's raw device token. Transport is HTTPS outside local development, the token remains high-entropy and server-revocable, and it is never logged.

The OpenAPI contract adds a `sessionBearer` HTTP security scheme. Authenticated management operations declare Cookie Session or Bearer Session as alternatives where the route already resolves the current user through `getSession`. Viewer routes remain unauthenticated and browser-only Preview behavior remains Cookie Session-only because it renders untrusted content in a browser.

Alternatives rejected:

- Mounting Better Auth routes directly would make a library-specific surface the public API and bypass the repository's checked response contract.
- A new JWT stack would duplicate Session expiry and revocation behavior without a current need for stateless verification.

### Treat the CLI credential as a distinct server-side Session

Approval consumes the device code exactly once and creates a new Session for the approving ShareSlices user. It does not convert, copy, refresh, or revoke the browser Session. The CLI Session uses the configured server Session expiry; this change adds no separate refresh-token protocol. Expired or revoked tokens receive the ordinary `401 unauthenticated` response from management APIs.

`POST /api/cli-sessions` preserves the device-flow state machine with stable results for `authorization_pending`, `slow_down`, `expired_token`, `access_denied`, and `invalid_grant`. The CLI waits at least the returned interval, increases its delay when told to slow down, stops at the returned expiry, and consumes the token only once. Ctrl-C stops local polling and leaves the pending authorization to expire on the server.

`DELETE /api/cli-sessions/current` authenticates only with Bearer, revokes exactly that Session, returns `204`, and leaves browser and other CLI Sessions active. It does not require an Origin header because it does not accept ambient Cookie authentication.

### Store secrets in the operating system credential store

The Rust CLI uses the `keyring` crate behind a small `CredentialStore` trait so tests use an in-memory Adapter. The production key is scoped by the normalized API origin, allowing local, test, and production deployments to have independent credentials without introducing named profiles. Non-secret endpoint configuration may live in normal CLI configuration; the token may not.

There is no plaintext fallback. If the platform credential store is unavailable, login fails with an actionable message. If token issuance succeeded before storage failed, the CLI immediately attempts to revoke the new Session and never prints the token. If revocation also fails, the message tells the user that a server Session may remain until expiry without revealing it.

`auth login` first validates an existing stored credential. If it is valid, the command reports the current account and does not create another Session; switching accounts requires `auth logout` first. `auth status` reads the stored credential and calls the existing current-user endpoint. A missing credential reports signed out; an invalid or expired credential is removed and reports signed out. `auth logout` attempts server revocation first, removes the local credential after a successful revocation or an unauthenticated response, and retains it on a network or server failure so the user can retry.

### Keep CLI output safe and automation-friendly

Human output may contain the verification URL, user code, account name, and account email. It must never contain the device code, Bearer token, Cookie value, or credential-store payload. Structured output, when introduced by the CLI scaffold, follows the same rule. Application logs redact `Authorization`, device codes, Session tokens, and credential-store errors that embed secret values.

The auth commands use stable exit categories for signed-out, denied or expired authorization, network failure, server failure, and local credential-store failure. Exact numeric exit codes belong to the CLI command contract established during implementation; raw Better Auth error text is not passed through.

## Risks / Trade-offs

- [A user code is claimed by the wrong signed-in browser account] -> Show the signed-in account and requesting client before approval, require an explicit action, bind the claimed code to that user, and reject approval by another Session.
- [Polling creates unnecessary load] -> Enforce the server-provided minimum interval, return `slow_down` for early polling, and bound every authorization by expiry.
- [A device or Session token leaks through output or logs] -> Keep secrets out of DTO diagnostics, CLI output, structured logs, and files; add redaction and negative assertions to tests.
- [The operating system credential store is locked or absent] -> Provide no insecure fallback, revoke a newly issued Session after a storage failure, and return actionable failure output.
- [Enabling Bearer accidentally expands Preview access] -> Add Bearer only to JSON management contracts; keep Preview content routes Cookie-only and cover both schemes in contract tests.
- [Better Auth plugin behavior changes across upgrades] -> Pin behavior through ShareSlices route tests, migration checks, and checked OpenAPI rather than relying on unwrapped plugin routes.
- [A CLI Session has broad personal management access] -> Require visible approval and independent revocation now; defer scoped AK/SK credentials rather than imply scopes the API does not enforce.

## Migration Plan

1. Update `PRODUCT.md` with the approved CLI browser-auth policy before implementation changes.
2. Add the checked OpenAPI routes and security scheme plus a checked SQL migration for Better Auth device authorization state.
3. Deploy the database migration, then the API with device and Bearer support, then the Web approval page, and finally distribute the CLI.
4. Keep existing Cookie Session behavior unchanged throughout the rollout. Older Web clients remain compatible.
5. To roll back, stop distributing or invoking CLI login first, disable new authorization creation, allow pending codes to expire, and retain the additive table until no issued CLI Session depends on the rollout. Existing browser Sessions and management behavior continue normally.

## Open Questions

None. AK/SK credential shape, scopes, issuance, storage, and rotation are intentionally deferred to a separate change.
