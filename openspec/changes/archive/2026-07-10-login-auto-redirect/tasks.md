# Automatic Post-Login Navigation — Tasks

## 1. Product and Specification

- [x] 1.1 Record automatic post-login navigation in `PRODUCT.md`.
- [x] 1.2 Define the modified `account-entry` requirement and design boundary.

## 2. Web Behavior

- [x] 2.1 Replace the successful-login confirmation test with an automatic-navigation test and verify it fails for the missing behavior.
- [x] 2.2 Make `App` store the authenticated user and navigate to `/artifacts` after successful log-in.
- [x] 2.3 Remove the obsolete successful-login state and confirmation UI from `LoginScreen`.

## 3. Verification

- [x] 3.1 Run the focused account-entry test and Web typecheck.
- [x] 3.2 Run `mise run check` and confirm the repository quality gate passes.
