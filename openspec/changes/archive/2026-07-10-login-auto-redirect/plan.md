# Automatic Post-Login Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the Artifact list immediately after a successful Web log-in.

**Architecture:** `LoginScreen` reports a successful session through `onSignedIn`. `App` owns the resulting user state and the route transition, using its existing `navigate` helper so React observes the new location without a full page reload.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library.

## Global Constraints

- Registration continues to create an account without creating signed-in state.
- Failed log-in continues to show the neutral message `Email or password is incorrect.`.
- The successful destination is exactly `/artifacts`.
- No new dependency or routing abstraction is introduced.

---

### Task 1: Automatic Successful-Login Navigation

**Files:**

- Modify: `web/src/screens/account-entry.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/LoginScreen.tsx`

**Interfaces:**

- Consumes: `LoginScreen` callback `onSignedIn(user)` and the existing `navigate(path)` helper.
- Produces: successful log-in updates `App` user state and changes the browser path to `/artifacts`.

- [x] **Step 1: Write the failing test**

Replace the successful-login confirmation assertion with assertions that the Artifact-list heading is rendered, `window.location.pathname` equals `/artifacts`, and no `Signed in as` text remains.

- [x] **Step 2: Run the test to verify it fails**

Run: `mise exec -- pnpm --dir web test -- src/screens/account-entry.test.tsx`

Expected: FAIL because the current UI remains on the log-in screen and renders `Signed in as Ada.`.

- [x] **Step 3: Write the minimal implementation**

In `App`, add one successful-login callback that calls `setUser(signedInUser)` and `navigate("/artifacts")`, then pass it to both log-in render paths. In `LoginScreen`, remove `signedInName`, its resets and updates, and the successful-login `Alert`.

- [x] **Step 4: Run focused verification**

Run: `mise exec -- pnpm --dir web test -- src/screens/account-entry.test.tsx`

Expected: all account-entry tests pass.

Run: `mise exec -- pnpm --dir web typecheck`

Expected: TypeScript exits successfully.

- [x] **Step 5: Run the repository quality gate**

Run: `mise run check`

Expected: documentation, spelling, references, OpenSpec, TypeScript, tests, and Rust checks all pass.
