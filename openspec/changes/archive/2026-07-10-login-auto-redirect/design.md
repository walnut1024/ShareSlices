# Automatic Post-Login Navigation — Design

## Context

`LoginScreen` already returns the authenticated user through `onSignedIn`. `App` owns both the user state and the local `navigate` helper, so it is the narrowest place to coordinate state and route changes.

## Goals / Non-Goals

**Goals:**

- Complete successful Web log-in by opening `/artifacts` immediately.
- Preserve the authenticated user returned by the session API so the management shell renders without another current-user request.

**Non-Goals:**

- Changing registration behavior.
- Changing the session API or authentication policy.
- Adding a configurable post-login destination.

## Decision

`App` supplies a successful-login callback that first stores the returned user and then calls the existing `navigate("/artifacts")` helper. `LoginScreen` remains responsible only for form submission and failure feedback; it no longer stores or renders a successful-login confirmation.

## Error Handling

Failed session creation continues to show the existing neutral error. Navigation occurs only after `createSession` resolves successfully.

## Testing

The account-entry component test submits valid credentials, waits for the Artifact-list heading, asserts the URL is `/artifacts`, and asserts the removed confirmation text is absent. Existing failed-login tests continue to cover the error path.
