# Reject Occupied Signup Email Design

## Context

With required email verification, `POST /api/users` currently creates a synthetic verification attempt for an already verified email and returns the same `202` response as a new account. The Web therefore opens a verification form even though no delivery exists. The product decision is to reveal the conflict at Signup instead.

## Goals / Non-Goals

**Goals:**

- Reject any existing normalized email before verification work.
- Return the existing `409 email_already_registered` wire error.
- Keep the visitor on Signup and attach a clear error to Email.

**Non-Goals:**

- Changing neutral login or password-reset behavior.
- Adding a separate availability endpoint or validation request while typing.
- Changing email normalization or database uniqueness.

## Decisions

- Perform the lookup inside the existing Signup submission. This avoids a race-prone preflight endpoint; the database uniqueness constraint remains the final concurrency guard.
- Reject both verified and unverified existing accounts. An unverified account can resume verification through the existing login flow, while Signup consistently treats the normalized email as occupied.
- Map `email_already_registered` directly to the Email field in the Web. The API already owns the stable error code and `409` response schema.

## Risks / Trade-offs

- [Signup exposes account existence] → This is an explicit product trade-off requested for clearer Signup feedback; password reset and login remain neutral.
- [Concurrent requests can pass the initial lookup] → Preserve the existing database uniqueness handling and map its duplicate result to the same `409` error.
