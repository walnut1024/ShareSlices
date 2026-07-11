# CLI Browser Authentication — Tasks

## 1. Product and HTTP Contracts

- [ ] 1.1 Update `PRODUCT.md` first with interactive browser authorization as the initial CLI sign-in method, independent CLI Session and logout behavior, secure local storage, and explicit AK/SK deferral; update `CONTEXT.md` only if implementation introduces a durable new product term.
- [ ] 1.2 Extend `api/openapi/openapi.yaml` with the product-owned CLI authorization and Session resources, stable device-flow errors, no-store responses, and the `sessionBearer` scheme; add Bearer as an alternative only on JSON management operations and keep Preview Cookie-only.
- [ ] 1.3 Add all new API cases and assertions to a checked YAML contract file and its `uv` Python runner, including start, claim, approve, deny, pending, slow-down, expiry, one-time exchange, current CLI logout, Session isolation, Bearer management access, and Preview rejection.

## 2. API Authentication Foundation

- [ ] 2.1 Write migration and schema tests for the Better Auth device-authorization record, then add the checked SQL migration and matching Drizzle schema fields required by Better Auth 1.6.23.
- [ ] 2.2 Write focused Vitest route tests with fake auth dependencies for fixed-client validation, Cookie-only claim and decisions, error normalization, one-time exchange, no-store secret responses, Bearer-only CLI logout, and preservation of other Sessions.
- [ ] 2.3 Configure Better Auth Device Authorization and Bearer plugins with the fixed `shareslices-cli` client, absolute Web verification URL, bounded expiry and polling interval, and no credential or device-code logging.
- [ ] 2.4 Implement and mount `api/src/http/cli-auth-routes.ts` as a thin product-contract Adapter over selected Better Auth methods, then make the new YAML/Python and Vitest API tests pass.
- [ ] 2.5 Extend management-route tests to prove Cookie and Bearer requests resolve the same user and ownership rules while Bearer-only requests cannot read Preview content.

## 3. Web Approval Flow

- [ ] 3.1 Write Web API-client tests for reading, approving, and denying a pending CLI authorization with stable normalized errors and retained Cookie credentials.
- [ ] 3.2 Write component tests for preserving `/device?user_code=...` through login, showing the signed-in account and **ShareSlices CLI**, requiring an explicit decision, and handling invalid, expired, claimed-by-another-user, approved, and denied states.
- [ ] 3.3 Implement the focused Web API client and desktop-only device authorization screen using existing shadcn Base UI components, with no token, device-code, or Better Auth internal values exposed.
- [ ] 3.4 Add a Playwright browser flow covering signed-out redirect, return after email/password login, explicit approval, and successful CLI token exchange against the local stack.

## 4. Rust CLI Foundation and Credential Storage

- [ ] 4.1 Add `cli/` as a separate Rust workspace package and establish `shareslices auth login|status|logout`, endpoint configuration, test fixtures, and `mise`-routed CLI checks without adding Artifact upload behavior.
- [ ] 4.2 Write command and output tests first for auth subcommand parsing, safe human-readable results, stable failure categories, and negative assertions that device codes, Bearer tokens, Cookies, and credential payloads never reach output or logs.
- [ ] 4.3 Define a narrow `CredentialStore` trait with an in-memory test Adapter, then implement the production Adapter with `keyring`, origin-scoped entries, no plaintext fallback, and tests for missing, stored, deleted, locked, and unavailable credential-store states.
- [ ] 4.4 Write HTTP-client tests with a fake server for authorization creation, manual-browser fallback, server-paced polling, slow-down backoff, expiry, denial, invalid grant, successful one-time exchange, current-user lookup, and current CLI Session revocation.

## 5. CLI Auth Commands

- [ ] 5.1 Implement `auth login` to validate an existing credential, otherwise print instructions, attempt browser launch, poll within the server limits, store the issued credential, and attempt immediate revocation if secure storage fails.
- [ ] 5.2 Implement `auth status` to validate the selected origin's credential, report the current account, remove only a confirmed-invalid credential, and distinguish signed-out state from network or server failure.
- [ ] 5.3 Implement `auth logout` to revoke only the calling CLI Session, remove the local credential after `204` or `401`, and retain it after network or server failure for retry.
- [ ] 5.4 Add Rust integration tests that exercise login, already-signed-in login, status, logout, expired credentials, credential-store failure cleanup, cancellation, and browser/other-CLI Session preservation through fake HTTP and credential Adapters.

## 6. Architecture and Verification

- [ ] 6.1 Update `docs/design/modules.md` to mark the implemented CLI command, HTTP auth Adapter, credential-store Adapter, and test seams current without moving Better Auth types into application or domain interfaces.
- [ ] 6.2 Run focused API unit and YAML/Python contract tests, Web unit and Playwright tests at `1440x900`, and Rust format, Clippy, and workspace tests; fix failures without weakening configured gates.
- [ ] 6.3 Run `mise run check` and `openspec validate cli-browser-auth --strict`, then confirm the diff contains no AK/SK, API-key, service-account, headless-login, mobile-layout, or plaintext-credential implementation.
