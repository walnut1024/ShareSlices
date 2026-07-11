# Implement current-Session sign out

## 1. Product and Contract

- [x] 1.1 Update `PRODUCT.md` with current-browser-session sign out while retaining all-session and administrative revocation as later scope.
- [x] 1.2 Add `DELETE /api/sessions/current` to `api/openapi/openapi.yaml` with no request body; an empty `204` response; standard `401`, `403`, and `500` responses; all cookie-expiry and request-ID headers; and `Cache-Control: no-store`.
- [x] 1.3 Extend the Python contract runner with named browser clients, request headers, empty-response assertions, and cookie-presence assertions before adding sign-out cases to `api/tests/account-entry.yaml`.
- [x] 1.4 Add YAML cases for successful revocation, every cookie expiry header, a repeated unauthenticated request, isolation between two browser Sessions, untrusted-Origin rejection, and persistence failure; extend the failure fixture where required.

## 2. API Implementation

- [x] 2.1 Extend the account HTTP adapter to resolve the current Session, revoke its token through Better Auth, then call Better Auth sign out and copy every cookie-expiry header; keep Better Auth Session types and tokens inside the adapter.
- [x] 2.2 Reject a present, untrusted `Origin` header before Session lookup and prove that rejection leaves the Session active.
- [x] 2.3 Return the checked `204`, `401`, and sanitized `500` behavior with request IDs and no-store caching, then make the focused API route and YAML contract tests pass.

## 3. Web Implementation

- [x] 3.1 Add the official shadcn Base UI `dropdown-menu` source component through the project package runner and review the generated component for the configured `base-nova` preset.
- [x] 3.2 Add the current-session delete operation to the Web account client, including no-content handling and typed `unauthenticated` errors.
- [x] 3.3 Add failing Web interaction tests for opening the account dropdown, successful sign out, an already-expired Session, duplicate submission prevention, and network or server failure.
- [x] 3.4 Compose the existing shadcn Avatar with the account dropdown, identity context, grouped Sign out item, and configured Lucide icon without adding speculative account actions.
- [x] 3.5 Coordinate sign out in `App`: clear the current user and replace navigation on `204` or `401`, retain signed-in state and show neutral toast feedback on network or server failure, and prevent concurrent attempts.
- [x] 3.6 Extend the desktop Playwright flow to verify that signing out reaches Log in and that revisiting a management route requires authentication.

## 4. Verification

- [x] 4.1 Run the focused account API contract and route tests plus the focused Web account and management interaction tests.
- [x] 4.2 Run the sign-out Playwright smoke flow at the supported desktop viewport.
- [x] 4.3 Run `mise run check` and reconcile only failures caused by this change.
