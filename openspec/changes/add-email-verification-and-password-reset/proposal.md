# Add email verification and password reset

## Why

Email registration currently accepts an address without proving that the user controls it, and the product has no password-reset flow. ShareSlices needs a deployment-controlled registration check and an always-verified recovery path that also prevents repeated requests or attacks from creating an email storm.

## What Changes

- Add six-digit email verification for registration when the deployment policy requires it.
- Keep registration verification controlled by deployment policy so a future administration setting can turn it off.
- Add email-code password reset independently of the registration verification setting.
- Add code expiry, single use, failed-attempt limits, resend waiting periods, layered delivery limits, durable delivery deduplication, and a deployment-wide delivery circuit breaker.
- Add neutral account-recovery responses that do not reveal whether an email is registered.
- Add Web states for entering a code, requesting another code, setting a new password, and returning to login.
- Revoke existing Sessions after a successful password reset and do not automatically sign in after registration verification or password reset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-entry`: Extend registration and login with deployment-controlled email verification, add password reset, and replace the deferred email-verification, password-reset, and rate-limit boundaries with implemented requirements.

## Impact

- Affected Web code: account routes, `RegisterPage`, `LoginPage`, shared authentication forms, and new verification and reset pages.
- Affected API code: Better Auth configuration, account application modules, Hono routes, repositories, environment configuration, structured events, and OpenAPI contracts.
- Affected persistence: verification attempts, restricted reset grants, authentication-email deliveries, delivery leases, rate-limit state, and circuit-breaker state.
- Affected infrastructure: one configurable transactional-email adapter and background delivery dispatch in the TypeScript API runtime.
- The Rust artifact worker, CLI authentication, Artifact behavior, Viewer behavior, mobile scope, and future administration UI remain unchanged.
