# V0.0.0 Account Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V0.0.0 Web/API account entry flow: a visitor can register with name, email, and password, then log in with email/password and see lightweight signed-in confirmation.

**Architecture:** The Hono API owns the public contract from `api/openapi/openapi.yaml`: `/api/users`, `/api/sessions`, `/api/users/me`, `/health`, and `/ready`. Better Auth backs password hashing and session mechanics, but ShareSlices-owned route handlers normalize request validation, login failures, response bodies, and current-user shape. The Web UI is a Vite React app using local shadcn/ui-style components and calls only the ShareSlices public API routes.

**Tech Stack:** TypeScript, Node.js 26.4.0, Hono, Better Auth, Drizzle ORM, PostgreSQL, Zod, `@hono/zod-openapi`, React, Vite, Tailwind CSS v4, shadcn/ui-style local components, Vitest, React Testing Library, Python 3.13 through `mise`, `uv`, Pytest, Requests, and PyYAML.

## Global Constraints

- Updated at: 2026-07-09.
- Behavioral requirements, scope, and deferred work are owned by the delta spec at `specs/account-entry/spec.md` in this change directory; do not restate them here.
- Public API behavior must match `api/openapi/openapi.yaml`. The documented `429` responses are reserved and excluded (see `design.md` Decision 3).
- Web UI style must follow the default shadcn/base-ui direction from the prototype images in `assets/`.
- API tests must be defined in YAML and executed by a Python runner.
- Use `mise` tasks as documented automation entry points.
- Use `uv` for Python packages and execution.
- Do not expose Better Auth library internals in `/api/users/me` or Web UI state.

---

## API Design Alignment

No blocking conflict was found between the delta spec at `specs/account-entry/spec.md` (in this change directory) and `api/openapi/openapi.yaml`.

The plan treats `api/openapi/openapi.yaml` as the public API source of truth:

| Operation | OpenAPI path | Plan owner |
| --- | --- | --- |
| Register | `POST /api/users` | ShareSlices route wrapping Better Auth sign-up |
| Log in | `POST /api/sessions` | ShareSlices route wrapping Better Auth sign-in |
| Current-user check | `GET /api/users/me` | ShareSlices route using Better Auth session lookup |
| Liveness | `GET /health` | Hono system route |
| Readiness | `GET /ready` | Hono system route with database check |

Two alignment risks should be checked during execution:

| Area | Risk | Recommended handling |
| --- | --- | --- |
| Session cookie name | OpenAPI names the cookie `shareslices_session`; Better Auth defaults may differ by configuration. | First try to configure Better Auth cookies to match `shareslices_session`. If the library cannot do that cleanly, update `api/openapi/openapi.yaml` before claiming contract parity. |
| `429` responses | OpenAPI documents `429` responses, but the V0.0.0 spec does not require rate limiting behavior. | Do not add durable rate limiting in V0.0.0. Keep `429` documented as an allowed operational response unless strict contract enforcement requires removing it from OpenAPI. |

## File Structure

### Root

| File | Responsibility |
| --- | --- |
| `.gitignore` | Ignore generated installs, logs, build outputs, and `.venv/`. |
| `.mise.toml` | Pin Node and Python; expose one entry point for install, checks, API tests, Web tests, and local dev. |
| `package.json` | Workspace-level scripts that delegate to versioned app packages and document checks. |
| `pnpm-workspace.yaml` | Include `api` and `web` packages. |
| `compose.yaml` | Local PostgreSQL service for API development and contract tests. |
| `.env.example` | Document local environment variables without secrets. |

### Database

| File | Responsibility |
| --- | --- |
| `db/migrations/0001_account_entry.sql` | Create Better Auth-compatible user, session, account, and verification tables with unique normalized email storage. |

### API

| File | Responsibility |
| --- | --- |
| `api/package.json` | API runtime, scripts, and dependencies. |
| `api/tsconfig.json` | API TypeScript compiler configuration. |
| `api/src/main.ts` | Node server entry point. |
| `api/src/http/app.ts` | Compose Hono app and mount routes. |
| `api/src/http/system-routes.ts` | `/health` and `/ready`. |
| `api/src/http/account-routes.ts` | `/api/users`, `/api/sessions`, and `/api/users/me`. |
| `api/src/http/http-error.ts` | Stable OpenAPI-compatible error responses. |
| `api/src/auth/auth.ts` | Better Auth configuration. |
| `api/src/auth/email.ts` | Email normalization and basic field validation helpers. |
| `api/src/db/client.ts` | PostgreSQL pool and Drizzle database client. |
| `api/src/db/schema.ts` | Drizzle table definitions aligned with migration. |
| `api/src/env.ts` | Runtime environment parsing. |
| `api/src/openapi.ts` | Optional typed OpenAPI metadata binding for future generation; V0.0.0 keeps checked YAML as source. |
| `api/tests/account-entry.yaml` | YAML contract scenarios matching OpenAPI and spec acceptance criteria. |
| `api/tests/test_account_entry_contract.py` | Python runner that executes the YAML scenarios against a running API. |
| `api/tests/test-email.ts` | Unit tests for email normalization. |

### Web

| File | Responsibility |
| --- | --- |
| `web/package.json` | Web runtime, scripts, and dependencies. |
| `web/index.html` | Vite document entry. |
| `web/tsconfig.json` | Web TypeScript compiler configuration. |
| `web/vite.config.ts` | Vite, React, and test setup. |
| `web/src/main.tsx` | React entry point. |
| `web/src/App.tsx` | Route shell for register and log-in screens. |
| `web/src/api/account.ts` | Small typed client for ShareSlices account API routes. |
| `web/src/components/ui/button.tsx` | Local shadcn/ui-style button. |
| `web/src/components/ui/card.tsx` | Local shadcn/ui-style card primitives. |
| `web/src/components/ui/input.tsx` | Local shadcn/ui-style input. |
| `web/src/components/ui/label.tsx` | Local shadcn/ui-style label. |
| `web/src/components/ui/alert.tsx` | Local shadcn/ui-style alert. |
| `web/src/screens/RegisterScreen.tsx` | Dedicated register screen. |
| `web/src/screens/LoginScreen.tsx` | Dedicated log-in screen and signed-in confirmation. |
| `web/src/styles.css` | Tailwind v4 import and shadcn/default neutral tokens. |
| `web/src/test/setup.ts` | Web test setup. |
| `web/src/screens/account-entry.test.tsx` | Register and log-in UI behavior tests. |

## Task 1: Workspace Tooling and Local Services

**Files:**

- Modify: `.gitignore`
- Modify: `.mise.toml`
- Modify: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `compose.yaml`
- Create: `.env.example`

**Interfaces:**

- Consumes: Existing root document scripts in `package.json`.
- Produces: `mise run install`, `mise run check`, `mise run api-test`, `mise run web-test`, and a PostgreSQL service named `postgres`.

- [ ] **Step 1: Write the workspace package files**

Replace root `package.json` with:

```json
{
  "name": "shareslices",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "scripts": {
    "check": "pnpm run docs:check && pnpm run spellcheck && pnpm run docs:refs && pnpm run docs:links && pnpm run specs:check && pnpm run -r typecheck && pnpm run -r test",
    "docs:check": "markdownlint-cli2",
    "spellcheck": "cspell .",
    "docs:refs": "node tools/check-doc-refs.mjs",
    "docs:links": "node tools/check-doc-links.mjs",
    "specs:check": "openspec validate --all --no-interactive",
    "api:test": "pnpm --dir api run test && uv run pytest api/tests/test_account_entry_contract.py",
    "web:test": "pnpm --dir web run test"
  },
  "devDependencies": {
    "cspell": "^10.0.1",
    "markdownlint-cli2": "^0.23.0"
  }
}
```

The `docs:*`, `specs:check`, and existing document scripts must survive this replacement; they are the repository's documentation consistency gates (see `docs/README.md`).

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "api"
  - "web"
```

Update `.gitignore` so it contains:

```gitignore
node_modules/
dist/
target/
.env
.env.*
!.env.example
*.log
.DS_Store
.sqlx/
.venv/
coverage/
```

- [ ] **Step 2: Update `mise` tasks**

Replace `.mise.toml` with:

```toml
[tools]
node = "26.4.0"
python = "3.13.14"

[tasks.install]
description = "Install workspace dependencies"
run = "pnpm install"

[tasks.check]
description = "Run the local quality gate"
run = "pnpm run check"

[tasks.docs-check]
description = "Lint Markdown documents"
run = "pnpm run docs:check"

[tasks.spellcheck]
description = "Run spelling checks"
run = "pnpm run spellcheck"

[tasks.api-test]
description = "Run API unit and contract tests"
run = "pnpm run api:test"

[tasks.web-test]
description = "Run Web tests"
run = "pnpm run web:test"
```

- [ ] **Step 3: Add local database service**

Create `compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: shareslices
      POSTGRES_USER: shareslices
      POSTGRES_PASSWORD: shareslices
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shareslices -d shareslices"]
      interval: 2s
      timeout: 5s
      retries: 20
    volumes:
      - shareslices-postgres:/var/lib/postgresql/data

volumes:
  shareslices-postgres:
```

Create `.env.example`:

```dotenv
DATABASE_URL=postgres://shareslices:shareslices@127.0.0.1:5432/shareslices
BETTER_AUTH_SECRET=replace-with-a-32-byte-local-secret
BETTER_AUTH_URL=http://127.0.0.1:7456
WEB_ORIGIN=http://127.0.0.1:5173
PORT=7456
NODE_ENV=development
```

- [ ] **Step 4: Install and verify workspace tooling**

Run:

```bash
mise install
mise run install
pnpm run docs:check
```

Expected:

```text
markdownlint-cli2
```

The exact lint output may include file counts, but it must exit with status 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add .gitignore .mise.toml package.json pnpm-workspace.yaml compose.yaml .env.example pnpm-lock.yaml
git commit -m "chore: add account entry workspace tooling"
```

## Task 2: Database and Auth Foundation

**Files:**

- Create: `db/migrations/0001_account_entry.sql`
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/src/env.ts`
- Create: `api/src/db/schema.ts`
- Create: `api/src/db/client.ts`
- Create: `api/src/auth/email.ts`
- Create: `api/src/auth/auth.ts`
- Test: `api/tests/test-email.ts`

**Interfaces:**

- Consumes: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `WEB_ORIGIN`.
- Produces:
  - `normalizeEmailForAccount(input: string): string`
  - `assertRegistrationFields(input: unknown): RegistrationInput`
  - `auth` Better Auth instance
  - `db` Drizzle client
  - SQL tables `"user"`, `session`, `account`, and `verification`

- [ ] **Step 1: Write the failing email normalization test**

Create `api/tests/test-email.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeEmailForAccount } from "../src/auth/email";

describe("normalizeEmailForAccount", () => {
  it("trims surrounding whitespace and lowercases the email", () => {
    expect(normalizeEmailForAccount("  Ada@EXAMPLE.COM  ")).toBe("ada@example.com");
  });

  it("rejects values without one local part and one domain", () => {
    expect(() => normalizeEmailForAccount("not-an-email")).toThrow("invalid_email");
    expect(() => normalizeEmailForAccount("a@b@c")).toThrow("invalid_email");
    expect(() => normalizeEmailForAccount("@example.com")).toThrow("invalid_email");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir api run test -- api/tests/test-email.ts
```

Expected:

```text
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
```

or:

```text
Cannot find module '../src/auth/email'
```

- [ ] **Step 3: Add API package and TypeScript config**

Create `api/package.json`:

```json
{
  "name": "@shareslices/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.6",
    "@hono/zod-openapi": "^1.1.0",
    "better-auth": "^1.3.4",
    "drizzle-orm": "^0.44.5",
    "hono": "^4.10.7",
    "pg": "^8.16.3",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^26.0.0",
    "@types/pg": "^8.15.5",
    "tsx": "^4.20.6",
    "typescript": "^5.9.3",
    "vitest": "^4.0.15"
  }
}
```

Create `api/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Create root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Add migration**

Create `db/migrations/0001_account_entry.sql`:

```sql
create table if not exists "user" (
  id text primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id text not null references "user"(id) on delete cascade
);

create index if not exists session_user_id_idx on session(user_id);

create table if not exists account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references "user"(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_user_id_idx on account(user_id);
create unique index if not exists account_provider_account_idx on account(provider_id, account_id);

create table if not exists verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists verification_identifier_idx on verification(identifier);
```

- [ ] **Step 5: Add environment and database modules**

Create `api/src/env.ts`:

```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  PORT: z.coerce.number().int().positive().default(7456),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export type ApiEnv = z.infer<typeof envSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return envSchema.parse(source);
}

export const env = readEnv();
```

Create `api/src/db/schema.ts`:

```typescript
import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" })
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId)
  ]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account)
}));
```

Create `api/src/db/client.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export const db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
```

- [ ] **Step 6: Add email validation and Better Auth configuration**

Create `api/src/auth/email.ts`:

```typescript
import { z } from "zod";

export class AccountInputError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "AccountInputError";
  }
}

export function normalizeEmailForAccount(input: string): string {
  const trimmed = input.trim();
  const parts = trimmed.split("@");

  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new AccountInputError("invalid_email");
  }

  return `${parts[0]}@${parts[1]}`.toLowerCase();
}

export const registrationInputSchema = z.object({
  name: z.string().trim().min(1, "invalid_name").max(120, "invalid_name"),
  email: z.string().max(320, "invalid_email").transform(normalizeEmailForAccount).pipe(z.string().email("invalid_email")),
  password: z.string().min(8, "invalid_password").max(128, "invalid_password")
});

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().max(320, "invalid_email").transform(normalizeEmailForAccount).pipe(z.string().email("invalid_email")),
  password: z.string().min(1, "invalid_password").max(128, "invalid_password")
});

export type LoginInput = z.infer<typeof loginInputSchema>;
```

Create `api/src/auth/auth.ts`:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../env";
import { db } from "../db/client";
import * as schema from "../db/schema";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false
  }
});
```

- [ ] **Step 7: Add a migration runner**

Create `api/src/db/migrate.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./client";

async function main(): Promise<void> {
  const migrationPath = join(process.cwd(), "..", "db", "migrations", "0001_account_entry.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Run tests and typecheck**

Run:

```bash
pnpm install
pnpm --dir api run test -- api/tests/test-email.ts
pnpm --dir api run typecheck
```

Expected:

```text
Test Files  1 passed
```

and:

```text
tsc --noEmit
```

with exit status 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add tsconfig.base.json db/migrations/0001_account_entry.sql api/package.json api/tsconfig.json api/src api/tests/test-email.ts pnpm-lock.yaml
git commit -m "feat: add account entry auth foundation"
```

## Task 3: ShareSlices Public API Routes

**Files:**

- Create: `api/src/http/http-error.ts`
- Create: `api/src/http/system-routes.ts`
- Create: `api/src/http/account-routes.ts`
- Create: `api/src/http/app.ts`
- Create: `api/src/main.ts`
- Modify: `api/src/auth/auth.ts`
- Test: `api/tests/account-routes.test.ts`

**Interfaces:**

- Consumes:
  - `auth.api.signUpEmail({ body, returnHeaders })`
  - `auth.api.signInEmail({ body, returnHeaders })`
  - `auth.api.getSession({ headers })`
  - `registrationInputSchema`
  - `loginInputSchema`
- Produces:
  - `buildApp(): Hono`
  - `toUserResponse(user): { user: { id: string; name: string; email: string } }`
  - OpenAPI-compatible responses for `/health`, `/ready`, `/api/users`, `/api/sessions`, and `/api/users/me`

- [ ] **Step 1: Write failing route tests**

Create `api/tests/account-routes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";

describe("account routes", () => {
  it("returns health response matching OpenAPI", async () => {
    const app = buildApp();
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "shareslices-api"
    });
  });

  it("rejects invalid registration shape with OpenAPI error shape", async () => {
    const app = buildApp();
    const response = await app.request("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", email: "bad", password: "short" })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.fields.length).toBeGreaterThan(0);
  });

  it("returns unauthenticated for current user without signed-in state", async () => {
    const app = buildApp();
    const response = await app.request("/api/users/me");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue."
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir api run test -- api/tests/account-routes.test.ts
```

Expected:

```text
Cannot find module '../src/http/app'
```

- [ ] **Step 3: Add stable error helper**

Create `api/src/http/http-error.ts`:

```typescript
import type { Context } from "hono";

export type FieldError = {
  path: string;
  code: string;
  message: string;
};

export type ErrorCode =
  | "invalid_request"
  | "email_already_registered"
  | "invalid_login"
  | "unauthenticated"
  | "rate_limited"
  | "internal_error";

const messages: Record<ErrorCode, string> = {
  invalid_request: "Invalid request.",
  email_already_registered: "An account already exists for this email.",
  invalid_login: "Email or password is incorrect.",
  unauthenticated: "Sign in to continue.",
  rate_limited: "Too many attempts. Try again later.",
  internal_error: "Internal server error."
};

export function requestId(c: Context): string {
  const existing = c.req.header("x-request-id");
  if (existing && existing.trim().length > 0) {
    return existing;
  }
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function errorJson(c: Context, status: 400 | 401 | 409 | 429 | 500, code: ErrorCode, fields?: FieldError[]) {
  const id = requestId(c);
  c.header("X-Request-Id", id);

  return c.json(
    {
      error: {
        code,
        message: messages[code],
        requestId: id,
        ...(fields && fields.length > 0 ? { fields } : {})
      }
    },
    status
  );
}
```

- [ ] **Step 4: Add system routes**

Create `api/src/http/system-routes.ts`:

```typescript
import { Hono } from "hono";
import { pool } from "../db/client";
import { requestId } from "./http-error";

export function systemRoutes(): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    c.header("X-Request-Id", requestId(c));
    return c.json({ status: "ok", service: "shareslices-api" });
  });

  app.get("/ready", async (c) => {
    const id = requestId(c);
    c.header("X-Request-Id", id);

    try {
      await pool.query("select 1");
      return c.json({ status: "ready", checks: { database: { status: "pass" } } });
    } catch {
      return c.json(
        {
          status: "not_ready",
          checks: {
            database: {
              status: "fail",
              message: "Database is not reachable."
            }
          }
        },
        503
      );
    }
  });

  return app;
}
```

- [ ] **Step 5: Add account routes**

Create `api/src/http/account-routes.ts`:

```typescript
import { Hono } from "hono";
import { ZodError } from "zod";
import { auth } from "../auth/auth";
import { loginInputSchema, registrationInputSchema } from "../auth/email";
import { errorJson, type FieldError, requestId } from "./http-error";

type AuthUser = {
  id: string;
  name: string;
  email: string;
};

function toUserResponse(user: AuthUser) {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  };
}

function zodFields(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: String(issue.message),
    message: fieldMessage(String(issue.message))
  }));
}

function fieldMessage(code: string): string {
  if (code === "invalid_name") {
    return "Enter a name.";
  }
  if (code === "invalid_email") {
    return "Enter a valid email.";
  }
  if (code === "invalid_password") {
    return "Enter a valid password.";
  }
  return "Invalid field.";
}

function copyAuthSetCookie(from: Headers, to: Headers): void {
  const setCookie = from.get("set-cookie");
  if (setCookie) {
    to.append("Set-Cookie", setCookie);
  }
}

export function accountRoutes(): Hono {
  const app = new Hono();

  app.post("/api/users", async (c) => {
    const parsed = registrationInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    try {
      const { response } = await auth.api.signUpEmail({
        returnHeaders: true,
        body: {
          name: parsed.data.name,
          email: parsed.data.email,
          password: parsed.data.password
        }
      });

      const id = requestId(c);
      c.header("X-Request-Id", id);
      return c.json(toUserResponse(response.user as AuthUser), 201);
    } catch {
      return errorJson(c, 409, "email_already_registered");
    }
  });

  app.post("/api/sessions", async (c) => {
    const parsed = loginInputSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request", zodFields(parsed.error));
    }

    try {
      const { headers, response } = await auth.api.signInEmail({
        returnHeaders: true,
        body: {
          email: parsed.data.email,
          password: parsed.data.password
        }
      });

      copyAuthSetCookie(headers, c.res.headers);

      const id = requestId(c);
      c.header("X-Request-Id", id);
      return c.json(
        {
          signedIn: true,
          user: toUserResponse(response.user as AuthUser).user
        },
        201
      );
    } catch {
      return errorJson(c, 401, "invalid_login");
    }
  });

  app.get("/api/users/me", async (c) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers
    });

    if (!session) {
      return errorJson(c, 401, "unauthenticated");
    }

    const id = requestId(c);
    c.header("X-Request-Id", id);
    return c.json(toUserResponse(session.user as AuthUser));
  });

  return app;
}
```

- [ ] **Step 6: Compose app and server entry**

Create `api/src/http/app.ts`:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { accountRoutes } from "./account-routes";
import { systemRoutes } from "./system-routes";
import { env } from "../env";

export function buildApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      allowMethods: ["GET", "POST", "OPTIONS"]
    })
  );

  app.route("/", systemRoutes());
  app.route("/", accountRoutes());

  return app;
}
```

Create `api/src/main.ts`:

```typescript
import { serve } from "@hono/node-server";
import { env } from "./env";
import { buildApp } from "./http/app";

const app = buildApp();

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    console.log(`ShareSlices API listening on http://127.0.0.1:${info.port}`);
  }
);
```

- [ ] **Step 7: Verify route tests and typecheck**

Run:

```bash
pnpm --dir api run test -- api/tests/account-routes.test.ts
pnpm --dir api run typecheck
```

Expected:

```text
Test Files  1 passed
```

and typecheck exits 0.

- [ ] **Step 8: Manually check OpenAPI path parity**

Run:

```bash
rg -n "(/health|/ready|/api/users|/api/sessions|/api/users/me)" api/openapi/openapi.yaml api/src/http
```

Expected output includes all five public paths in both the OpenAPI file and API route source.

- [ ] **Step 9: Commit**

Run:

```bash
git add api/src/http api/src/main.ts api/tests/account-routes.test.ts
git commit -m "feat: add account entry api routes"
```

## Task 4: YAML API Contract Tests

**Files:**

- Create: `api/tests/account-entry.yaml`
- Create: `api/tests/test_account_entry_contract.py`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Running API at `http://127.0.0.1:7456`.
- Produces: YAML-defined contract coverage for AC-1 through AC-11.

- [ ] **Step 1: Add YAML contract scenarios**

Create `api/tests/account-entry.yaml`:

```yaml
base_url: "http://127.0.0.1:7456"
cases:
  - id: health
    request:
      method: GET
      path: /health
    expect:
      status: 200
      json:
        status: ok
        service: shareslices-api

  - id: register_valid_user
    request:
      method: POST
      path: /api/users
      json:
        name: Ada Lovelace
        email: "Ada@EXAMPLE.COM"
        password: "correct horse battery staple"
    expect:
      status: 201
      json_paths:
        user.name: Ada Lovelace
        user.email: "ada@example.com"
      no_set_cookie: true
    save:
      user_id: user.id

  - id: register_duplicate_user
    request:
      method: POST
      path: /api/users
      json:
        name: Ada Again
        email: "ada@example.com"
        password: "correct horse battery staple"
    expect:
      status: 409
      json_paths:
        error.code: email_already_registered

  - id: register_invalid_name
    request:
      method: POST
      path: /api/users
      json:
        name: ""
        email: "bad-name@example.com"
        password: "correct horse battery staple"
    expect:
      status: 400
      json_paths:
        error.code: invalid_request

  - id: register_invalid_email
    request:
      method: POST
      path: /api/users
      json:
        name: Bad Email
        email: "not-an-email"
        password: "correct horse battery staple"
    expect:
      status: 400
      json_paths:
        error.code: invalid_request

  - id: register_invalid_password
    request:
      method: POST
      path: /api/users
      json:
        name: Bad Password
        email: "bad-password@example.com"
        password: "short"
    expect:
      status: 400
      json_paths:
        error.code: invalid_request

  - id: current_user_without_login
    request:
      method: GET
      path: /api/users/me
    expect:
      status: 401
      json_paths:
        error.code: unauthenticated

  - id: login_wrong_password
    request:
      method: POST
      path: /api/sessions
      json:
        email: "ada@example.com"
        password: "wrong password"
    expect:
      status: 401
      json_paths:
        error.code: invalid_login
        error.message: Email or password is incorrect.
      no_set_cookie: true

  - id: login_unknown_email
    request:
      method: POST
      path: /api/sessions
      json:
        email: "unknown@example.com"
        password: "wrong password"
    expect:
      status: 401
      json_paths:
        error.code: invalid_login
        error.message: Email or password is incorrect.
      no_set_cookie: true
      same_error_as: login_wrong_password

  - id: login_valid_user
    request:
      method: POST
      path: /api/sessions
      json:
        email: "ada@example.com"
        password: "correct horse battery staple"
    expect:
      status: 201
      set_cookie: true
      json_paths:
        signedIn: true
        user.name: Ada Lovelace
        user.email: "ada@example.com"
    save_cookie: session

  - id: current_user_with_login
    request:
      method: GET
      path: /api/users/me
      cookie_ref: session
    expect:
      status: 200
      json_paths:
        user.name: Ada Lovelace
        user.email: "ada@example.com"
```

- [ ] **Step 2: Add Python contract runner**

Create `api/tests/test_account_entry_contract.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import requests
import yaml


ROOT = Path(__file__).parent
SPEC_PATH = ROOT / "account-entry.yaml"


def read_path(data: dict[str, Any], dotted_path: str) -> Any:
    current: Any = data
    for part in dotted_path.split("."):
        current = current[part]
    return current


@pytest.fixture(scope="session")
def contract() -> dict[str, Any]:
    with SPEC_PATH.open("r", encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle)
    assert isinstance(loaded, dict)
    return loaded


def test_account_entry_contract(contract: dict[str, Any]) -> None:
    base_url = contract["base_url"]
    saved: dict[str, Any] = {}
    cookies: dict[str, requests.cookies.RequestsCookieJar] = {}
    responses: dict[str, dict[str, Any]] = {}

    with requests.Session() as session:
        for case in contract["cases"]:
            request_spec = case["request"]
            method = request_spec["method"].lower()
            url = f"{base_url}{request_spec['path']}"
            request_cookies = None

            if "cookie_ref" in request_spec:
                request_cookies = cookies[request_spec["cookie_ref"]]

            response = session.request(
                method,
                url,
                json=request_spec.get("json"),
                cookies=request_cookies,
                timeout=10,
            )

            expect = case["expect"]
            assert response.status_code == expect["status"], case["id"]

            if expect.get("set_cookie"):
                assert response.headers.get("set-cookie"), case["id"]

            if expect.get("no_set_cookie"):
                assert response.headers.get("set-cookie") is None, case["id"]

            body = response.json()

            if "json" in expect:
                assert body == expect["json"], case["id"]

            for path, expected_value in expect.get("json_paths", {}).items():
                assert read_path(body, path) == expected_value, case["id"]

            if "same_error_as" in expect:
                other = responses[expect["same_error_as"]]
                assert body["error"]["code"] == other["error"]["code"], case["id"]
                assert body["error"]["message"] == other["error"]["message"], case["id"]

            for name, path in case.get("save", {}).items():
                saved[name] = read_path(body, path)

            if "save_cookie" in case:
                cookies[case["save_cookie"]] = response.cookies.copy()

            responses[case["id"]] = body

    assert saved["user_id"]
```

- [ ] **Step 3: Install Python test packages**

Run:

```bash
uv venv
uv pip install pytest requests pyyaml
```

Expected:

```text
Installed
```

- [ ] **Step 4: Run contract test to verify it fails when API is not running**

Run:

```bash
uv run pytest api/tests/test_account_entry_contract.py -q
```

Expected:

```text
Connection refused
```

- [ ] **Step 5: Run contract test against the API**

Run:

```bash
docker compose up -d postgres
pnpm --dir api run db:migrate
pnpm --dir api run start
```

In a second terminal, run:

```bash
uv run pytest api/tests/test_account_entry_contract.py -q
```

Expected:

```text
1 passed
```

- [ ] **Step 6: Commit**

Run:

```bash
git add .gitignore api/tests/account-entry.yaml api/tests/test_account_entry_contract.py
git commit -m "test: add account entry api contract tests"
```

## Task 5: Web Scaffold and Account API Client

**Files:**

- Create: `web/package.json`
- Create: `web/index.html`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/src/api/account.ts`
- Create: `web/src/test/setup.ts`
- Test: `web/src/api/account.test.ts`

**Interfaces:**

- Consumes: Public API paths from `api/openapi/openapi.yaml`.
- Produces:
  - `createUser(input: CreateUserInput): Promise<User>`
  - `createSession(input: CreateSessionInput): Promise<CreateSessionResult>`
  - `getCurrentUser(): Promise<User | null>`

- [ ] **Step 1: Write failing account client tests**

Create `web/src/api/account.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, createUser } from "./account";

describe("account API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts registration to /api/users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(createUser({ name: "Ada", email: "ada@example.com", password: "password123" })).resolves.toEqual({
      id: "user_1",
      name: "Ada",
      email: "ada@example.com"
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "POST",
        credentials: "include"
      })
    );
  });

  it("normalizes login failures to one client error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "invalid_login", message: "Email or password is incorrect.", requestId: "req_1" } }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(createSession({ email: "unknown@example.com", password: "wrong password" })).rejects.toThrow(
      "Email or password is incorrect."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir web run test -- web/src/api/account.test.ts
```

Expected:

```text
Cannot find module './account'
```

- [ ] **Step 3: Add Web package and config**

Create `web/package.json`:

```json
{
  "name": "@shareslices/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.1.1",
    "lucide-react": "^0.562.0",
    "react": "^19.2.3",
    "react-dom": "^19.2.3",
    "tailwindcss": "^4.1.18",
    "vite": "^7.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.1",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^26.0.0",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "jsdom": "^27.3.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.15"
  }
}
```

Create `web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

Create `web/vite.config.ts`:

```typescript
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:7456",
      "/health": "http://127.0.0.1:7456",
      "/ready": "http://127.0.0.1:7456"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
```

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ShareSlices</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `web/src/test/setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Add account API client**

Create `web/src/api/account.ts`:

```typescript
export type User = {
  id: string;
  name: string;
  email: string;
};

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
};

export type CreateSessionInput = {
  email: string;
  password: string;
};

export type CreateSessionResult = {
  signedIn: true;
  user: User;
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Array<{ path: string; code: string; message: string }>;
  };
};

export class AccountApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly fields: ErrorResponse["error"]["fields"] = []
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await parseJson<ErrorResponse>(response);
    throw new AccountApiError(error.error.message, error.error.code, error.error.fields);
  }

  return parseJson<T>(response);
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const response = await request<{ user: User }>("/api/users", input);
  return response.user;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  return request<CreateSessionResult>("/api/sessions", input);
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const response = await request<{ user: User }>("/api/users/me");
    return response.user;
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "unauthenticated") {
      return null;
    }
    throw error;
  }
}
```

- [ ] **Step 5: Verify Web client tests and typecheck**

Run:

```bash
pnpm install
pnpm --dir web run test -- web/src/api/account.test.ts
pnpm --dir web run typecheck
```

Expected:

```text
Test Files  1 passed
```

and typecheck exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add web/package.json web/index.html web/tsconfig.json web/vite.config.ts web/src/api web/src/test pnpm-lock.yaml
git commit -m "feat: add account entry web client"
```

## Task 6: Web Register and Log-In Screens

**Files:**

- Create: `web/src/styles.css`
- Create: `web/src/components/ui/button.tsx`
- Create: `web/src/components/ui/card.tsx`
- Create: `web/src/components/ui/input.tsx`
- Create: `web/src/components/ui/label.tsx`
- Create: `web/src/components/ui/alert.tsx`
- Create: `web/src/screens/RegisterScreen.tsx`
- Create: `web/src/screens/LoginScreen.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/main.tsx`
- Test: `web/src/screens/account-entry.test.tsx`

**Interfaces:**

- Consumes:
  - `createUser(input): Promise<User>`
  - `createSession(input): Promise<CreateSessionResult>`
- Produces:
  - Dedicated register screen at `?view=register`
  - Dedicated log-in screen at `?view=login`
  - Lightweight signed-in confirmation after successful login

- [ ] **Step 1: Write failing UI tests**

Create `web/src/screens/account-entry.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

describe("account entry screens", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/?view=register");
  });

  it("shows dedicated register form without deferred actions", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText(/password reset/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  });

  it("shows field feedback for invalid registration input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
  });

  it("shows neutral feedback for failed login", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "invalid_login", message: "Email or password is incorrect.", requestId: "req_1" } }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "unknown@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.queryByText(/signed in/i)).not.toBeInTheDocument();
  });

  it("shows signed-in confirmation after successful login", async () => {
    window.history.replaceState(null, "", "/?view=login");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ signedIn: true, user: { id: "user_1", name: "Ada", email: "ada@example.com" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Signed in as Ada.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
pnpm --dir web run test -- web/src/screens/account-entry.test.tsx
```

Expected:

```text
Cannot find module '../App'
```

- [ ] **Step 3: Add shadcn-style components and styles**

Create `web/src/styles.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light;
  --background: #ffffff;
  --foreground: #171717;
  --card: #ffffff;
  --card-foreground: #171717;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --input: #e5e5e5;
  --primary: #171717;
  --primary-foreground: #fafafa;
  --destructive: #dc2626;
  font-family:
    Geist,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

* {
  box-sizing: border-box;
}
```

Create `web/src/components/ui/button.tsx`:

```typescript
import type { ButtonHTMLAttributes } from "react";

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={[
        "inline-flex h-10 items-center justify-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white",
        "transition-colors hover:bg-neutral-800 disabled:pointer-events-none disabled:opacity-50",
        props.className ?? ""
      ].join(" ")}
    />
  );
}
```

Create `web/src/components/ui/input.tsx`:

```typescript
import type { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm outline-none",
        "focus:border-neutral-950 focus:ring-2 focus:ring-neutral-950/10",
        props.className ?? ""
      ].join(" ")}
    />
  );
}
```

Create `web/src/components/ui/label.tsx`:

```typescript
import type { LabelHTMLAttributes } from "react";

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={["text-sm font-medium text-neutral-950", props.className ?? ""].join(" ")} />;
}
```

Create `web/src/components/ui/card.tsx`:

```typescript
import type { HTMLAttributes } from "react";

export function Card(props: HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={["rounded-lg border border-neutral-200 bg-white shadow-sm", props.className ?? ""].join(" ")} />;
}

export function CardHeader(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["space-y-1.5 p-6", props.className ?? ""].join(" ")} />;
}

export function CardTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  return <h1 {...props} className={["text-2xl font-semibold tracking-normal text-neutral-950", props.className ?? ""].join(" ")} />;
}

export function CardDescription(props: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={["text-sm text-neutral-500", props.className ?? ""].join(" ")} />;
}

export function CardContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["space-y-4 p-6 pt-0", props.className ?? ""].join(" ")} />;
}
```

Create `web/src/components/ui/alert.tsx`:

```typescript
import type { HTMLAttributes } from "react";

export function Alert(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="alert"
      {...props}
      className={["rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700", props.className ?? ""].join(" ")}
    />
  );
}
```

- [ ] **Step 4: Add register and log-in screens**

Create `web/src/screens/RegisterScreen.tsx`:

```typescript
import { useState } from "react";
import { createUser } from "../api/account";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export function RegisterScreen() {
  const [errors, setErrors] = useState<Errors>({});
  const [createdName, setCreatedName] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const nextErrors: Errors = {};

    if (!name) {
      nextErrors.name = "Enter a name.";
    }
    if (!email.includes("@")) {
      nextErrors.email = "Enter a valid email.";
    }
    if (password.length < 8) {
      nextErrors.password = "Use at least 8 characters.";
    }

    setErrors(nextErrors);
    setCreatedName(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      const user = await createUser({ name, email, password });
      setCreatedName(user.name);
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Registration failed." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Use your name, email, and password to start.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" />
            {errors.name ? <p className="text-sm text-red-600">{errors.name}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
            {errors.email ? <p className="text-sm text-red-600">{errors.email}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" />
            {errors.password ? <p className="text-sm text-red-600">{errors.password}</p> : null}
          </div>
          {errors.form ? <Alert>{errors.form}</Alert> : null}
          {createdName ? <Alert>Account created for {createdName}. Log in to continue.</Alert> : null}
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

Create `web/src/screens/LoginScreen.tsx`:

```typescript
import { useState } from "react";
import { createSession } from "../api/account";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function LoginScreen() {
  const [message, setMessage] = useState<string | null>(null);
  const [signedInName, setSignedInName] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setMessage(null);
    setSignedInName(null);

    try {
      const result = await createSession({ email, password });
      setSignedInName(result.user.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Email or password is incorrect.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Enter the email and password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </div>
          {message ? <Alert>{message}</Alert> : null}
          {signedInName ? <Alert>Signed in as {signedInName}.</Alert> : null}
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Add app shell and entry**

Create `web/src/App.tsx`:

```typescript
import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";

function currentView(): "register" | "login" {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "login" ? "login" : "register";
}

export default function App() {
  const view = currentView();

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-[420px]">
        {view === "register" ? <RegisterScreen /> : <LoginScreen />}
        <nav className="mt-4 flex justify-center text-sm text-neutral-500">
          {view === "register" ? <a href="/?view=login">Log in instead</a> : <a href="/?view=register">Create an account</a>}
        </nav>
      </div>
    </main>
  );
}
```

Create `web/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 6: Verify UI tests and typecheck**

Run:

```bash
pnpm --dir web run test -- web/src/screens/account-entry.test.tsx
pnpm --dir web run typecheck
```

Expected:

```text
Test Files  1 passed
```

and typecheck exits 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add web/src
git commit -m "feat: add account entry web screens"
```

## Task 7: Full Verification and Documentation Sync

**Files:**

- Modify: `tasks.md` in this change directory (mark completed checkboxes)
- Modify: `api/openapi/openapi.yaml` only if implementation cannot match the documented session cookie name.

**Interfaces:**

- Consumes: Completed API, Web UI, contract tests, and document checks.
- Produces: A verified V0.0.0 account entry implementation ready for review.

- [ ] **Step 1: Check public API against OpenAPI**

Run:

```bash
rg -n "operationId: (createUser|createSession|getCurrentUser|getHealth|getReadiness)" api/openapi/openapi.yaml
rg -n "\"/api/users\"|\"/api/sessions\"|\"/api/users/me\"|\"/health\"|\"/ready\"" api/src web/src api/tests
```

Expected:

```text
operationId: createUser
operationId: createSession
operationId: getCurrentUser
operationId: getHealth
operationId: getReadiness
```

and route usages are limited to V0.0.0 account entry, health, and readiness.

- [ ] **Step 2: Verify no deferred UI actions leaked into Web**

Run:

```bash
rg -n "password reset|email verification|Google|WeChat|phone|sign out|upload|publish|artifact|admin" web/src
```

Expected:

```text
```

No matches.

- [ ] **Step 3: Run full local checks**

Run:

```bash
docker compose up -d postgres
pnpm --dir api run db:migrate
mise run check
mise run api-test
mise run web-test
```

Expected:

```text
1 passed
```

from the Python API contract test, all Vitest suites pass, markdownlint exits 0, CSpell exits 0, and TypeScript typechecks exit 0.

- [ ] **Step 4: Manually verify Web screens**

Run:

```bash
pnpm --dir api run start
pnpm --dir web run dev
```

Open:

```text
http://127.0.0.1:5173/?view=register
http://127.0.0.1:5173/?view=login
```

Expected:

```text
Register screen: name, email, password, create-account action, field-level feedback.
Log-in screen: email, password, log-in action, neutral failure feedback, signed-in confirmation after successful login.
No deferred password reset, social login, phone login, email verification, sign out, artifact, or admin actions.
```

- [ ] **Step 5: Sync change artifacts**

Mark the completed checkboxes in this change's `tasks.md`. If the implementation deviated from `design.md` decisions or the delta spec, update those artifacts to match what was actually built before archiving.

- [ ] **Step 6: Commit**

Run:

```bash
git add openspec/changes/account-entry api/openapi/openapi.yaml
git commit -m "docs: finalize account entry implementation plan"
```

## Self-Review

Spec coverage:

| Spec area | Covered by task |
| --- | --- |
| REG-1 through REG-5 | Tasks 2, 3, and 4 |
| LOG-1 through LOG-4 | Tasks 3 and 4 |
| WEB-1 through WEB-6 | Tasks 5 and 6 |
| AC-1 through AC-11 | Task 4 |
| AC-12 through AC-15 | Task 6 |
| Deferred work exclusions | Tasks 6 and 7 |
| OpenAPI contract | Tasks 3, 4, and 7 |

Placeholder scan:

| Check | Result |
| --- | --- |
| Placeholder terms | None intentionally left in task steps. |
| Unspecified validation | Name, email, and password rules are concrete. |
| Unspecified commands | Every task includes exact verification commands. |

Type consistency:

| Interface | First defined | Later use |
| --- | --- | --- |
| `normalizeEmailForAccount(input: string): string` | Task 2 | Tasks 2 and 3 |
| `createUser(input: CreateUserInput): Promise<User>` | Task 5 | Task 6 |
| `createSession(input: CreateSessionInput): Promise<CreateSessionResult>` | Task 5 | Task 6 |
| `buildApp(): Hono` | Task 3 | Task 3 route tests |
