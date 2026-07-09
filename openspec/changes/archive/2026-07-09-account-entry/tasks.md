# Account Entry — Tasks

Each task maps to a section of [plan.md](./plan.md), which carries exact file contents, commands, and expected outputs.

## 1. Workspace Tooling and Local Services

- [x] 1.1 Write workspace package files: root `package.json` scripts, `pnpm-workspace.yaml`, `.gitignore`
- [x] 1.2 Update `.mise.toml`: pin Python, add `api-test` and `web-test` tasks
- [x] 1.3 Add local database service: `compose.yaml`, `.env.example`
- [x] 1.4 Install and verify workspace tooling (`mise install`, `mise run install`, `pnpm run docs:check`)

## 2. Database and Auth Foundation

- [x] 2.1 Write the failing email normalization test (`api/tests/test-email.ts`)
- [x] 2.2 Add API package, `api/tsconfig.json`, root `tsconfig.base.json`
- [x] 2.3 Add migration `db/migrations/0001_account_entry.sql` (Better Auth tables, unique normalized email)
- [x] 2.4 Add `api/src/env.ts`, `api/src/db/schema.ts`, `api/src/db/client.ts`
- [x] 2.5 Add `api/src/auth/email.ts` (normalization + Zod schemas) and `api/src/auth/auth.ts` (Better Auth config)
- [x] 2.6 Add migration runner `api/src/db/migrate.ts`
- [x] 2.7 Run email tests and typecheck to green

## 3. ShareSlices Public API Routes

- [x] 3.1 Write failing route tests (`api/tests/account-routes.test.ts`)
- [x] 3.2 Add `api/src/http/http-error.ts` (stable OpenAPI-compatible error responses)
- [x] 3.3 Add `api/src/http/system-routes.ts` (`/health`, `/ready`)
- [x] 3.4 Add `api/src/http/account-routes.ts` (`/api/users`, `/api/sessions`, `/api/users/me`)
- [x] 3.5 Compose `api/src/http/app.ts` and `api/src/main.ts`
- [x] 3.6 Route tests and typecheck green; verify OpenAPI path parity

## 4. YAML API Contract Tests

- [x] 4.1 Add YAML contract scenarios (`api/tests/account-entry.yaml`) — 429 excluded per design Decision 3
- [x] 4.2 Add Python contract runner (`api/tests/test_account_entry_contract.py`)
- [x] 4.3 Set up `.venv` with `uv` and verify the runner fails without a running API
- [x] 4.4 Run contract tests against the live API (postgres up, migrated) to green

## 5. Web Scaffold and Account API Client

- [x] 5.1 Write failing account client tests (`web/src/api/account.test.ts`)
- [x] 5.2 Add Web package, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, test setup
- [x] 5.3 Add typed account API client (`web/src/api/account.ts`)
- [x] 5.4 Web client tests and typecheck green

## 6. Web Register and Log-In Screens

- [x] 6.1 Write failing UI tests (`web/src/screens/account-entry.test.tsx`)
- [x] 6.2 Add styles and local shadcn-style components (button, card, input, label, alert)
- [x] 6.3 Add `RegisterScreen`, `LoginScreen`, `App.tsx`, `main.tsx`
- [x] 6.4 UI tests and typecheck green

## 7. Full Verification and Documentation Sync

- [x] 7.1 Check public API against OpenAPI (operation IDs and route usage parity)
- [x] 7.2 Verify no deferred UI actions leaked into Web
- [x] 7.3 Run full local checks (`mise run check`, `mise run api-test`, `mise run web-test`)
- [x] 7.4 Manually verify Web register and log-in screens
- [x] 7.5 Resolve the session cookie name (design Decision 4): configure Better Auth or update `api/openapi/openapi.yaml`
- [x] 7.6 Confirm all checkboxes here are accurate, then run `/opsx:archive account-entry`
