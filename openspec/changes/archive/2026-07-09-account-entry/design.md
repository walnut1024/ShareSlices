# Account Entry — Design

## Context

The repository is contract-first: `api/openapi/openapi.yaml` already defines the public HTTP contract for this change (`/api/users`, `/api/sessions`, `/api/users/me`, `/health`, `/ready`). No product code exists yet; this change creates the first API and Web packages. Engineering constraints come from `AGENTS.md`; the target module architecture lives in `docs/design/modules.md`.

Visual references for the Web screens: [assets/register.png](./assets/register.png) and [assets/login.png](./assets/login.png). They are non-binding directions: default shadcn/base-ui style, separate compact register and log-in screens. Exact spacing, copy, and composition may change, but included and excluded states must match the spec.

## Goals / Non-Goals

**Goals:**

- Implement the OpenAPI contract exactly, except where this document explicitly reserves behavior.
- Establish the first pnpm workspace packages (`api/`, `web/`), the first migration, and the API/Web test lanes.

**Non-Goals:**

- Rate limiting (`429` stays reserved in the contract).
- An application-layer `UserModule` (see Decision 2).
- Email verification, password reset, sign out, additional sign-in methods, artifact features, administration.

## Decisions

1. **The OpenAPI file is the public contract source of truth.** ShareSlices-owned route handlers normalize validation, error bodies, and the current-user shape. Better Auth backs password hashing and session mechanics but is not mounted as public routes in this change; handlers call `auth.api.*` directly.
2. **Minimal module structure now; target architecture later.** This change uses `api/src/http/ + api/src/auth/ + api/src/db/` without an application layer. `docs/design/modules.md` describes the target architecture; per `AGENTS.md`, a responsibility is extracted into an application module when it gains a second caller or a second implementation. Three endpoints with one caller each do not justify the layer yet.
3. **`429` is documented but excluded.** The contract documents `429 + Retry-After` for forward compatibility. This change implements no rate limiting, and the YAML contract tests MUST NOT assert 429 behavior. A future change that implements rate limiting owns un-reserving it.
4. **Session cookie name.** The contract names the cookie `shareslices_session`. First configure Better Auth to match. If the library cannot do that cleanly, update `api/openapi/openapi.yaml` in this change before claiming contract parity — the contract and the implementation must not disagree silently.
5. **Minimal email normalization.** Trim surrounding whitespace and lowercase the email. Better Auth lowercases account emails internally, so the ShareSlices route uses the same normalized value for validation, lookup, responses, and the database uniqueness constraint.
6. **Neutral login failure via catch-all mapping.** All Better Auth sign-in failures map to one `401 invalid_login` response so wrong-password and unknown-email are indistinguishable at the HTTP seam.
7. **API contract tests are YAML scenarios run by Python** (`uv` + pytest + requests), per the repository testing policy. Unit tests use Vitest.

## Risks / Trade-offs

- [Better Auth cookie name cannot be configured] → Decision 4 fallback: update the contract in the same change.
- [Better Auth error detail leaks distinguishable failures] → catch-all 401 mapping (Decision 6) plus contract test AC-10 comparing both failure cases.
- [Duplicate-email race under concurrency] → database uniqueness constraint on the normalized email is the final arbiter; the API maps constraint violations to `409 email_already_registered`.
- [Skipping the application layer hardens into habit] → extraction rule recorded in `AGENTS.md`; `docs/design/modules.md` keeps the target shape visible.

## Implementation Playbook

The detailed task-by-task execution plan (exact file contents, commands, and expected outputs) is [plan.md](./plan.md). `tasks.md` tracks the same work as checkboxes; the playbook is the reference for each step.
