# Design current-Session sign out

## Context

ShareSlices creates browser Sessions through `POST /api/sessions`. It resolves the current user through `GET /api/users/me`. Better Auth owns the Session record and `shareslices_session` cookie. ShareSlices owns the product API routes and response contracts.

The authenticated Web shell shows the user's name and a hand-written avatar but has no account actions. The repository keeps Better Auth behind the HTTP adapter and treats `api/openapi/openapi.yaml` as the checked contract. The `account-entry` capability explicitly excludes sign out, so this change modifies that capability.

## Goals / Non-Goals

**Goals:**

- Let a signed-in user revoke only the current browser session.
- Expire the current session cookie and make subsequent authenticated requests fail.
- Expose Sign out from an accessible shadcn Base UI dropdown anchored to the existing account avatar.
- Return the Web UI to Log in without leaving authenticated state in memory.
- Keep the ShareSlices HTTP contract independent of Better Auth's route and response shapes.

**Non-Goals:**

- Revoking other sessions or signing out all devices.
- Administrative forced sign out or session administration.
- Adding account settings or additional dropdown actions.
- Changing session duration, refresh, registration, or log-in behavior.

## Decisions

### Model sign out as deletion of the current Session resource

The product API adds `DELETE /api/sessions/current` with operation ID `deleteCurrentSession`. `sessions` is the resource collection. `current` is a programmatic alias that resolves from the authenticated Session cookie. The operation has no request body. It returns `204 No Content` after revoking the current Session and expiring its cookies.

This is preferable to `POST /api/sessions:signOut` because deleting a Session is a standard resource operation, not a custom action. It is preferable to exposing Better Auth's `POST /sign-out` route because ShareSlices owns its public HTTP contract and must not leak authentication-library internals.

The endpoint returns `401 unauthenticated` when it cannot resolve a valid current Session. It returns `403 forbidden` for a present, untrusted `Origin` header. A repeated request after successful deletion returns `401`. The repeated request remains idempotent because it causes no additional state change. The endpoint returns no JSON success envelope.

### Delegate revocation to Better Auth through the existing HTTP adapter

The account HTTP adapter resolves the current Session before deletion. It passes the Session token to Better Auth's single-Session revoke primitive. That primitive reports persistence failures instead of converting them to success.

After revocation succeeds, the adapter invokes Better Auth's sign-out primitive to generate the correctly scoped cookie-expiry headers. It copies every `Set-Cookie` value to the Hono response. The Session token stays inside the authentication adapter and never appears in product types, responses, or logs.

The two calls are deliberate. Better Auth's sign-out primitive clears the browser cookie even when its internal Session deletion fails. Calling the revoke primitive first ensures that `204` means the server Session is unusable.

The route rejects any present `Origin` header that does not match the configured Web origin. This check provides cross-site request forgery (CSRF) protection for the cookie-authenticated mutation. The route also returns the standard request ID and `Cache-Control: no-store`. This change adds no domain module or persistence abstraction because it has one caller and one implementation.

### Treat `204` and `401` as signed-out Web outcomes

The Web account client sends the delete request with credentials. On `204`, `App` clears its current `user` and replaces the current history entry with `/?view=login`. On `401`, `App` performs the same transition because no usable management Session remains.

Network failures and `5xx` responses do not clear local user state. The dropdown closes and a neutral toast reports the failure. A pending guard prevents duplicate requests while a sign-out request is in flight.

Replacing rather than pushing the Log-in location prevents the immediately previous authenticated route from being restored as the current history entry. Route authorization still remains authoritative if the user navigates to any older management history entry.

### Use the official shadcn Base UI dropdown-menu and Avatar components

The official `dropdown-menu` source component is added through the shadcn command-line interface (CLI). The existing account avatar becomes an accessible button trigger through the Base UI `render` API. The account name remains visible in the header.

The end-aligned menu shows the current user's name and email, followed by a separator. One `DropdownMenuItem` appears inside a `DropdownMenuGroup`. The item uses the configured Lucide icon library and the label **Sign out**. The trigger uses the existing shadcn `Avatar` and `AvatarFallback` components.

No confirmation dialog is shown because current-session sign out does not delete product data and the user can immediately log in again.

## Risks / Trade-offs

- **[Risk] Session-store deletion fails before cookie expiry.** → Return the standard server error, retain the cookie, and let the user retry; emit sanitized failure evidence without logging the Session token.
- **[Risk] A cross-origin request attempts cookie-authenticated sign out.** → Reject a present, untrusted `Origin` header before Session lookup and add a rejection test.
- **[Risk] The current working tree already changes the account shell and account-entry specification.** → Apply this change only after reconciling those edits; do not overwrite the current header composition or archived spec work.
- **[Trade-off] A dropdown with one action is more structure than a visible button.** → The user selected the dropdown pattern, and it provides a stable account-action location without adding speculative settings.

## Migration Plan

1. Update `PRODUCT.md` with the current-session-only sign-out policy.
2. Add the OpenAPI operation and failing contract tests before implementation.
3. Add the API wrapper, Web client, dropdown component, and App state transition.
4. Run focused API and Web tests, then `mise run check`.

No database migration is required. Rollback removes the dropdown action and product endpoint; existing sessions and log-in behavior remain compatible.

## Open Questions

None.
