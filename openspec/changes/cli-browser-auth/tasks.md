# CLI Browser Authentication — Tasks

## 1. Product and HTTP Contracts

- [x] 1.1 Update `PRODUCT.md` first with interactive browser authorization as the initial CLI sign-in method, independent CLI Session and logout behavior, secure local storage, and explicit AK/SK deferral; update `CONTEXT.md` only if implementation introduces a durable new product term.
- [x] 1.2 Extend `api/openapi/openapi.yaml` with the product-owned CLI authorization and Session resources, required CLI version and operating-system headers, `426 cli_upgrade_required`, stable device-flow errors, no-store responses, and the `sessionBearer` scheme; add Bearer as an alternative only on JSON management operations and keep Preview Cookie-only.
- [x] 1.3 Add all new API cases and assertions to a checked YAML contract file and its `uv` Python runner, including supported, missing, malformed, and outdated CLI compatibility metadata; start, claim, approve, deny, pending, slow-down, expiry, one-time exchange, current CLI logout, Session isolation, Bearer management access, and Preview rejection; assert client metadata is not persisted.

## 2. API Authentication Foundation

- [x] 2.1 Write migration and schema tests for the Better Auth device-authorization record, then add the checked SQL migration and matching Drizzle schema fields required by Better Auth 1.6.23.
- [x] 2.2 Write focused Vitest route tests with fake auth dependencies for fixed-client validation, semantic-version and operating-system header validation, `426 cli_upgrade_required` before state changes, Cookie-only claim and decisions, error normalization, one-time exchange, no-store secret responses, Bearer-only CLI logout, and preservation of other Sessions.
- [x] 2.3 Configure the server-owned minimum CLI version and Better Auth Device Authorization and Bearer plugins with the fixed `shareslices-cli` client, absolute Web verification URL, bounded expiry and polling interval, and no credential, device-code, or client-metadata persistence.
- [x] 2.4 Implement and mount `api/src/http/cli-auth-routes.ts` as a thin product-contract Adapter over selected Better Auth methods, then make the new YAML/Python and Vitest API tests pass.
- [x] 2.5 Extend management-route tests to prove Cookie and Bearer requests resolve the same user and ownership rules while Bearer-only requests cannot read Preview content.

## 3. Web Approval Flow

- [x] 3.1 Write Web API-client tests for reading, approving, and denying a pending CLI authorization with stable normalized errors and retained Cookie credentials.
- [x] 3.2 Write component tests from `docs/high-fidelity/ShareSlices CLI Auth.dc.html` for the three `/device?user_code=...` states: login with prominent code comparison, signed-in account review with explicit Approve/Deny and no account switch, and **CLI authorized** completion on the same route; also cover invalid, expired, claimed-by-another-user, approved, and denied states.
- [x] 3.3 Implement the focused Web API client and desktop-only device authorization screen using existing shadcn Base UI components and the high-fidelity 1280×800 composition; do not display device or CLI metadata, Scope, Session ID, credential, expiry, refresh behavior, credential-store internals, or Better Auth values.
- [x] 3.4 Add a Playwright browser flow at `1280x800` covering code visibility before login, preserved `/device?user_code=...` return after email/password login, absence of account switching, explicit approval, in-place authorization success, denial, and successful CLI token exchange against the local stack.

## 4. Rust CLI Foundation and Credential Storage

- [x] 4.1 Add `cli/` as a separate Rust workspace package and establish `shareslices auth login|status|logout`, endpoint configuration, test fixtures, and `mise`-routed CLI checks without adding Artifact upload behavior.
- [x] 4.2 Write command and output tests first for auth subcommand parsing, automatic CLI version and operating-system headers, exact upgrade-required output with current and minimum versions, safe human-readable auth results, stable failure categories, and negative assertions that device codes, Bearer tokens, Cookies, Session IDs, Scope, credential paths, and credential payloads never reach output or logs.
- [x] 4.3 Define a narrow `CredentialStore` trait with an in-memory test Adapter, then implement the production Adapter with `keyring`, origin-scoped entries, no plaintext fallback, and tests for missing, stored, deleted, locked, and unavailable credential-store states.
- [x] 4.4 Write HTTP-client tests with a fake server for compatibility-header propagation on every request, upgrade-required short-circuiting before authorization or mutation, authorization creation, manual-browser fallback, server-paced polling, slow-down backoff, expiry, denial, invalid grant, successful one-time exchange, current-user lookup, and current CLI Session revocation.

## 5. CLI Auth Commands

- [x] 5.1 Implement `auth login` to send compatibility metadata and stop with upgrade instructions on `426`; otherwise validate an existing credential, print instructions, attempt browser launch, poll within the server limits, store the issued credential, and attempt immediate revocation if secure storage fails.
- [x] 5.2 Implement `auth status` to validate the selected origin's credential, report only the current account and active state, remove a confirmed-invalid credential, tell an expired or revoked user to run `shareslices auth login`, and distinguish signed-out state from network or server failure.
- [x] 5.3 Implement `auth logout` to revoke only the calling CLI Session, remove the local credential after `204` or `401`, retain it after network or server failure for retry, and report **Signed out of ShareSlices** without a Session ID or credential-store implementation detail.
- [x] 5.4 Add Rust integration tests that exercise login, already-signed-in login, status, logout, expired credentials, credential-store failure cleanup, cancellation, and browser/other-CLI Session preservation through fake HTTP and credential Adapters.

## 6. Architecture and Verification

- [x] 6.1 Update `docs/design/modules.md` to mark the implemented CLI command, HTTP auth Adapter, credential-store Adapter, and test seams current without moving Better Auth types into application or domain interfaces.
- [x] 6.2 Run focused API unit and YAML/Python contract tests, Web unit tests and the CLI-auth Playwright flow at its `1280x800` high-fidelity viewport, the remaining Web checks at `1440x900`, and Rust format, Clippy, and workspace tests; fix failures without weakening configured gates.
- [x] 6.3 Run `mise run check` and `openspec validate cli-browser-auth --strict`, then confirm the diff contains no account switch, device persistence or display, delegated Scope, Session-ID display, fixed CLI lifetime, refresh protocol, credential-store path, AK/SK, API-key, service-account, headless-login, mobile-layout, or plaintext-credential implementation.
