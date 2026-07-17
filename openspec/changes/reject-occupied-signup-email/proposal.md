# Reject Occupied Signup Email Proposal

## Why

Signup currently sends an already registered visitor into an email-verification screen even though no verification email is dispatched. The visitor should instead receive an immediate, explicit occupied-email error and remain on Signup.

## What Changes

- **BREAKING** Signup reveals that a normalized email already belongs to an account by returning `email_already_registered`.
- Signup rejects both verified and unverified existing accounts before creating a verification attempt or delivery.
- The Web presents the conflict as an Email field error and does not enter verification.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-entry`: Define explicit occupied-email rejection during Signup, including deployments that require email verification.

## Impact

This changes the account-entry product contract, `POST /api/users` behavior, Signup error presentation, and focused API/Web tests. Password-reset neutrality remains unchanged.
