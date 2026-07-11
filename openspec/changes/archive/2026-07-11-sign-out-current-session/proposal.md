# Sign out of the current browser Session

## Why

Signed-in users cannot end their ShareSlices management Session from the Web UI. They need a sign-out action that revokes the current browser Session without affecting any other Session.

## What Changes

- Add a current-session sign-out operation to the checked management API contract.
- Add a shadcn Base UI dropdown menu to the existing account avatar, with a Sign out action.
- After sign out, remove local signed-in state and open the Log in screen.
- Leave other Sessions active. Keep all-Session revocation and administrative forced sign out out of scope.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `account-entry`: extend signed-in state behavior with current-session sign out and its Web interaction.

## Impact

- `PRODUCT.md`: add the user-visible current-session sign-out policy before implementation.
- `api/openapi/openapi.yaml`: define `DELETE /api/sessions/current` and its cookie-expiry response.
- `api/src/http/account-routes.ts`: wrap Better Auth Session lookup, revocation, and cookie expiry without exposing Better Auth routes or types.
- `api/tests/account-entry.yaml` and its runner: cover no-content responses, cookie expiry, Origin validation, persistence failure, and isolation between browser Sessions.
- `web/src/api/account.ts`, `web/src/App.tsx`, and `web/src/components/ManagementShell.tsx`: call sign out, clear signed-in state, navigate to Log in, and expose the action through the account dropdown.
- `web/src/components/ui/dropdown-menu.tsx`: add the official shadcn Base UI dropdown-menu source component.
- Web account and management tests: cover menu interaction, success, expired-session handling, and server or network failure.
