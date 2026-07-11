# CLI Browser Authentication

## Why

The agent-first upload path requires the ShareSlices CLI to act for a user, but the product currently exposes only browser-cookie authentication. The CLI needs an interactive sign-in flow that never asks an agent or terminal to handle the user's email password and that produces an independently revocable CLI Session.

## What Changes

- Add `shareslices auth login`, which starts browser-based device authorization, opens the verification page when possible, and also prints the URL and user code.
- Require the user to sign in and explicitly approve the pending CLI authorization in the ShareSlices Web UI.
- Let the CLI poll within the server-provided interval until approval, denial, or expiry, then store the resulting credential in the operating system credential store.
- Authenticate CLI management API requests with a Bearer credential representing a distinct server-side Session rather than with a copied browser cookie.
- Add `shareslices auth status` and `shareslices auth logout` for inspecting the signed-in account and revoking only the current CLI Session.
- Keep AK/SK credentials, API keys, headless login, service accounts, and organization credentials outside this change.

## Capabilities

### New Capabilities

- `cli-auth`: Browser authorization, local credential handling, Bearer authentication, status, logout, and CLI-specific failure behavior.

### Modified Capabilities

None.

## Impact

- Product contract: define interactive browser authorization as the first CLI sign-in method and defer AK/SK credentials.
- API and authentication: add checked device-authorization and CLI Session contracts, Better Auth device-authorization and Bearer support, and the required database migration.
- Web: add the signed-in device approval or denial page without changing the existing email/password sign-in policy.
- CLI: establish the Rust binary, auth commands, browser launch and polling behavior, operating-system credential storage, and authenticated request handling.
- Tests: add YAML/Python API contract coverage plus TypeScript, Rust, and browser-flow tests at the new security seams.
