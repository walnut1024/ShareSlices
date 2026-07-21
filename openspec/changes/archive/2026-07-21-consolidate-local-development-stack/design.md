# Local Development Stack Design

## Context

Local operations currently expose three startup models. `mise run dev` runs Web and API as host processes with container infrastructure, `mise run dev-compose` runs the base Compose topology at `127.0.0.1`, and `mise run dev-gallery` applies the isolated Gallery overlay at `app.localhost`. The hybrid launcher also duplicates environment defaults and starts the Worker without rebuilding it. Root API integration orchestration reuses the default Compose project and published ports, so it stops and reconfigures a developer's running stack.

The Gallery security contract requires a distinct trusted site and content-only site. A canonical local topology therefore cannot use a same-host, different-port split for Gallery content. Local policy and Administrator bootstrap remain explicit because selecting an Administrator is a user decision.

## Goals / Non-Goals

**Goals:**

- Give local development one canonical startup command and stable origins.
- Guarantee that startup builds current application and Worker sources, applies migrations, recreates services, and waits for readiness.
- Separate lifecycle, diagnostic, and maintenance commands.
- Keep test orchestration isolated from the developer Compose project and ports.
- Bind every host-published local service to loopback by default.
- Remove duplicated environment defaults from the obsolete hybrid launcher.

**Non-Goals:**

- Change production deployment profiles or Gallery eligibility policy.
- Automatically choose or grant a Gallery Administrator.
- Add a second local backend/runtime topology.
- Preserve the old hybrid host-process launcher as a supported workflow.
- Change application HTTP behavior or public contracts.

## Decisions

### Use one local stack controller

`tools/local-stack.mjs` will be the only implementation behind development lifecycle tasks. It will select the checked base Compose file plus the isolated Gallery local overlay and expose `up`, `down`, `status`, and `logs` actions. The controller will print the canonical URLs and will fail when required HTTP, SMTP, or container readiness checks fail.

Alternative: keep each `mise` task as an inline Docker command. Rejected because profile selection, endpoint reporting, and verification would remain duplicated and prone to drift.

### Make the isolated Gallery topology canonical

`mise run dev` will always use `app.localhost:5173` for trusted Web/API traffic and `content.localhost:7460` for untrusted content. Gallery can still fail closed until checked policies and an explicit Administrator are bootstrapped, but enabling or disabling Gallery will not change the trusted Web address.

Alternative: retain `127.0.0.1` for the default and switch hosts only for Gallery. Rejected because feature state would continue changing cookies, auth origins, browser state, and user instructions.

### Prefer correctness over a second fast launcher

The canonical startup builds all images with Compose, recreates the stack, and waits for health. The old host-process launcher and separate Worker rebuild task will be removed. Build cache keeps unchanged starts inexpensive while guaranteeing source changes are reflected.

Alternative: retain a `dev-source` HMR mode immediately. Rejected for this change because it would preserve a second process topology before a demonstrated need and would require a trusted reverse-proxy design for the same canonical origins.

### Isolate API integration orchestration

API integration tests will run through `tools/run-api-tests.mjs` using a fixed test-only Compose project and test-only published ports. The controller will clean up only that exact project in a `finally` path. Contract fixtures will read endpoint overrides from environment variables instead of hardcoding development ports.

Alternative: stop the development stack before tests and restore it afterward. Rejected because restoration is failure-prone and still invalidates active browser/session state.

### Keep local defaults in Compose configuration

Compose and its Gallery overlay remain the owner of container-local defaults. Host-side scripts will select profiles and pass explicit test overrides but will not reproduce the API environment catalog. Published ports become parameterized with loopback defaults so the isolated test project can coexist with development.

### Separate maintenance from lifecycle

Gallery bootstrap and thumbnail requeue remain explicit operations with `ops-` names. They are not folded into startup because bootstrap requires an explicitly verified User ID and requeue mutates durable job state.

## Risks / Trade-offs

- [Every normal start rebuilds images] → Rely on Docker layer caching and measure before adding another launcher.
- [Existing bookmarks and cookies use `127.0.0.1`] → Document `app.localhost` as the sole local Web URL and accept a one-time local session reset.
- [Gallery remains unavailable on a fresh database] → Print the bootstrap command without choosing an Administrator automatically.
- [Test-only ports can collide with unrelated software] → Keep them centralized in the test controller and report the exact conflicting endpoint.
- [Removing old task names can break personal scripts] → Update every repository reference in the same change; the repository has not published these as a stable external interface.

## Migration Plan

1. Add and test the local stack controller and parameterized loopback port mappings.
2. Route `dev`, `dev-down`, and new diagnostic tasks through the controller.
3. Add isolated API test orchestration and environment-configurable contract fixtures.
4. Remove obsolete launch tasks and `tools/dev.mjs`, then update all repository documentation and scoped guidance.
5. Verify a cold start, repeat start, status, shutdown, and API test run while the development stack remains healthy.

Rollback is a source revert. Persistent PostgreSQL and object-storage volumes retain their existing Compose volume names for the development project.

## Open Questions

None.
