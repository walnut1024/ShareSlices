# Add email verification and password reset tasks

## 1. Lock contracts and persistence

- [x] 1.1 Update `api/openapi/openapi.yaml` with verification, delivery, password-reset, neutral response, limit, and error contracts; update YAML API cases before implementation.
- [x] 1.2 Add checked SQL migrations for verification attempts, encrypted delivery values, restricted reset grants, authentication-email deliveries, leases, and circuit-breaker state.
- [x] 1.3 Extend environment validation with registration-verification policy, email-provider, encryption-key, waiting-period, rate-limit, retry, and circuit-breaker configuration.

## 2. Build verification and delivery foundations

- [x] 2.1 Add focused failing application tests for code purpose binding, ten-minute expiry, single use, five-attempt blocking, and terminal encrypted-value deletion.
- [x] 2.2 Implement the `EmailVerification` application module and repository transitions with one pending verification per normalized email and purpose.
- [x] 2.3 Add focused failing tests for the 60-second wait, independent email, source-IP, and deployment limits, and neutral public results.
- [x] 2.4 Implement `AuthenticationEmailDelivery` with durable creation, request idempotency, concurrent deduplication, configurable rate-limit buckets, and the deployment circuit breaker.
- [x] 2.5 Add the development capture adapter, configured transactional-email adapter, templates, and API-runtime dispatcher with expiring leases, provider idempotency where available, and bounded retries.
- [x] 2.6 Add structured verification, delivery, limit, circuit-breaker, and failure events without prohibited authentication data.

## 3. Integrate registration verification

- [x] 3.1 Add failing API and application tests for verification-required registration, verification-skipped registration, existing-account neutrality, unverified login, policy changes, resend, and code verification.
- [x] 3.2 Configure Better Auth and the account application boundary so required verification creates no Session, successful code proof marks email verified, skipped verification permits login, and errors remain product-owned.
- [x] 3.3 Implement the registration verification and delivery routes with trusted-origin validation, `no-store` responses, and checked OpenAPI behavior.
- [x] 3.4 Add failing Web tests for registration code entry, paste and whitespace input, masked destination, server countdown, resend, different-email, error, completion, and policy-skipped states.
- [x] 3.5 Implement the `RegisterPage` verification states with existing authentication layout and shadcn Base UI primitives.

## 4. Add password reset

- [x] 4.1 Add failing application and API tests for real and synthetic reset attempts, neutral behavior, code proof, restricted grant expiry and single use, password validation, full Session revocation, and notification delivery.
- [x] 4.2 Implement the `PasswordReset` application module, repository transitions, Better Auth password update, full Session revocation, and password-changed notification.
- [x] 4.3 Implement password-reset attempt, code-verification, and completion routes with trusted-origin validation, `no-store` responses, and checked OpenAPI behavior.
- [x] 4.4 Add failing Web tests for reaching reset from login, neutral request results, code states, resend protection, matching new passwords, completion, and return to login.
- [x] 4.5 Implement password-reset request, code, new-password, and completion pages using the current authentication composition.

## 5. Verify supported behavior

- [x] 5.1 Run all YAML API contract cases, focused API and Web tests, and TypeScript type checks.
- [x] 5.2 Exercise concurrent requests, provider failure, dispatcher restart, limit exhaustion, circuit-breaker recovery, and retention cleanup against PostgreSQL.
- [x] 5.3 Inspect structured output and persisted delivery records to confirm codes, passwords, reset grants, raw emails, and message bodies are absent.
- [x] 5.4 Render registration verification and password-reset flows at `1440x900` and compare their composition with the current authentication design.
- [x] 5.5 Run `mise exec -- openspec validate add-email-verification-and-password-reset --strict` and `mise run check`.
