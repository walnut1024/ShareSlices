# Account Entry

## Why

ShareSlices has no account system yet, and every artifact flow in `PRODUCT.md` starts from a signed-in owner. This change delivers the minimum Web/API account entry flow — register with name, email, and password, then log in with email/password — so later artifact work has a real user to attach ownership to.

## What Changes

- Add `POST /api/users` (register), `POST /api/sessions` (log in), and `GET /api/users/me` (current-user check) to the Hono API, wrapping Better Auth behind ShareSlices-owned routes.
- Add `GET /health` and `GET /ready` system routes.
- Add the PostgreSQL foundation: Better Auth-compatible tables with a unique normalized-email constraint, plus Drizzle schema and a migration runner.
- Add the Web register screen and log-in screen with field-level validation feedback, neutral login failure, and lightweight signed-in confirmation.
- Add YAML-defined API contract tests with a Python runner, plus Vitest unit and UI tests.
- Everything else stays deferred: profile management, email verification, password reset, sign out, phone/Google/WeChat login, CLI and Skill authentication, artifact upload/publish/view, and administration.

## Capabilities

### New Capabilities

- `account-entry`: register with name, email, and password; log in with email/password; neutral login failure; signed-in state; current-user check; Web register and log-in screens.

### Modified Capabilities

<!-- None. This is the first capability. -->

## Impact

- `api/`: new Hono app, routes, Better Auth configuration, Drizzle client and schema.
- `web/`: new Vite React app with register and log-in screens.
- `db/migrations/`: first migration.
- `api/openapi/openapi.yaml`: already written contract-first; this change implements it. The documented `429` responses are reserved and explicitly excluded from this change (see `design.md`).
- Root tooling: pnpm workspace, `compose.yaml` for local PostgreSQL, new `mise` tasks for API and Web tests.
