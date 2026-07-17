# Reject Occupied Signup Email Tasks

## 1. Product and API

- [x] 1.1 Update the durable account-entry product contract for explicit occupied-email Signup rejection.
- [x] 1.2 Reject existing verified and unverified accounts before creating registration verification work.
- [x] 1.3 Add focused API and wire-contract coverage for the occupied-email conflict under required verification.

## 2. Web

- [x] 2.1 Map `email_already_registered` to a clear Email field error while preserving the Signup form.
- [x] 2.2 Add focused Web coverage confirming no verification screen appears for an occupied email.

## 3. Verification

- [x] 3.1 Validate the OpenSpec change and run focused API, Web, and end-to-end checks.
- [ ] 3.2 Run the repository quality gate and confirm the local stack remains healthy.
