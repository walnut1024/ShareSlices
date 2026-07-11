# Automatic Post-Login Navigation

## Why

The Web log-in screen currently confirms successful authentication but requires the user to click a second link before reaching their Artifacts. Successful authentication should complete the entry flow without another confirmation action.

## What Changes

- Navigate directly to `/artifacts` after a successful Web log-in.
- Remove the signed-in confirmation and its manual continuation link.
- Keep failed-login feedback and registration behavior unchanged.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `account-entry`: replace the successful log-in confirmation with automatic navigation to the Artifact list.

## Impact

- `PRODUCT.md`: records the post-login product behavior.
- `web/src/App.tsx`: owns signed-in state and navigation after successful log-in.
- `web/src/screens/LoginScreen.tsx`: stops rendering an intermediate success state.
- `web/src/screens/account-entry.test.tsx`: verifies automatic navigation.
