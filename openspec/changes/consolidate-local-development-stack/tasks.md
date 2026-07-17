# Implementation Tasks

## 1. Canonical local stack

- [x] 1.1 Add focused tests for local stack command construction, canonical endpoint reporting, readiness failures, and explicit operation separation.
- [x] 1.2 Implement `tools/local-stack.mjs` with `up`, `down`, `status`, and `logs` actions over the base Compose file and isolated Gallery overlay.
- [x] 1.3 Parameterize every Compose published port with a loopback default and ensure the canonical Gallery overlay resolves to `app.localhost` and `content.localhost`.
- [x] 1.4 Replace the overlapping `mise` lifecycle tasks with `dev`, `dev-down`, `dev-status`, and `dev-logs`; rename retained mutation commands with an `ops-` prefix and remove the obsolete host launcher.

## 2. Test isolation

- [x] 2.1 Add a test-only orchestration controller with a dedicated Compose project, centralized alternate ports, exact-project cleanup, and failure-safe teardown.
- [x] 2.2 Make account-entry and Artifact-flow contract fixtures consume test endpoint overrides instead of fixed development ports.
- [x] 2.3 Route `mise run api-test` through the isolated controller and verify that a running development project is not stopped or reconfigured.

## 3. Durable guidance and verification

- [x] 3.1 Update README, root and Worker agent guidance, and Gallery operations documentation to describe the single lifecycle, canonical origins, diagnostics, and explicit bootstrap operation.
- [x] 3.2 Run focused controller/config tests, OpenSpec validation, documentation checks, and `git diff --check`.
- [x] 3.3 Exercise `dev`, `dev-status`, repeat `dev`, and `dev-down`; verify current images, loopback publication, all required health probes, and stable canonical URLs.
- [ ] 3.4 Run `mise run api-test` while the canonical development stack is healthy, confirm the developer containers remain unchanged, then run `mise run check`.
