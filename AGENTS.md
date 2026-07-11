# AGENTS.md

Project-level engineering guidance for agents working on ShareSlices.

## Documentation scope

- The documentation map, ownership rules, and conflict precedence live in `docs/README.md`. Read it before editing any durable document.
- Use `PRODUCT.md` as the product contract and `CONTEXT.md` as the glossary. Do not duplicate product scope, user vocabulary, or feature policy in this file.
- Update `PRODUCT.md` first when a change alters product behavior.
- Implemented requirements live in `openspec/specs/`; work in progress lives in `openspec/changes/` and follows the OpenSpec workflow (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`).
- Keep this file focused on technology choices, architecture constraints, and implementation discipline. Target architecture and module interfaces live in `docs/design/modules.md`.

## Technology choices

- Frontend: React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui with Base UI primitives.
- Frontend design reference: Vercel Geist tokens from `https://vercel.com/design.md`.
- API: TypeScript with Hono.
- API runtime: Node.js unless deployment constraints require another Hono runtime.
- API validation and contracts: Zod with `@hono/zod-openapi`.
- Authentication infrastructure: Better Auth inside the Hono API. Authentication methods are defined in `PRODUCT.md`; all of them are implemented through Better Auth.
- Application logging: one OpenTelemetry-compatible structured record contract across Web, API, and Worker.
- Worker: Rust on Tokio, for performance-sensitive background functions: archive expansion, artifact validation, manifest generation, and concurrency-limited object storage writes.
- Database: PostgreSQL. API access through Drizzle ORM; worker access through `sqlx`, limited to job leases, processing state transitions, artifact metadata, and version commit records.
- Database migrations: checked SQL migration files under `db/`.
- CLI: Rust, optimized for small single-binary distribution.
- Object storage: S3-compatible private storage; use AWS SDK for JavaScript v3 in the API and AWS SDK for Rust in the worker.

## Quality gates

- Use `mise` tasks as the only documented automation entry point.
- `mise run check` is the local quality gate. It currently runs: markdownlint-cli2, CSpell, documentation reference checks (`tools/check-doc-refs.mjs`, `tools/check-doc-links.mjs`), and OpenSpec change validation.
- Gates land together with the code they check: Biome and `tsc --noEmit` arrive with the first TypeScript package, Vitest with the first TypeScript tests, `cargo fmt` / `cargo clippy --all-targets --all-features` / `cargo test` (plus `cargo sqlx prepare --check` when SQLx macros are used) with the first Rust package, and Knip, Secretlint, and dependency audits when CI is established.
- Not yet established: a full `ci` task and `prek` Git hooks. Do not reference them in documents or scripts before they exist.
- When Git hooks land: keep pre-commit fast and staged-file focused (formatting, low-cost linting, secret scanning, typo checks); run full typechecks, test suites, builds, and audits in pre-push or CI; route hook, CI, and local commands through the same `mise run` tasks.
- Add Playwright smoke tests in CI when the Web UI has real user flows beyond the scaffold.
- Vibe-coded changes should pass `mise run check` before being considered reviewable.
- Do not bypass failing quality tools by weakening configuration unless the tool is wrong and the reason is documented in the same change.

## Repository shape

- Use direct top-level product surfaces: `web/`, `api/`, `worker/`, `cli/`, `skill/`, `db/`, `docs/`, and `tools/`, plus `openspec/` for the change workflow.
- Put API implementation modules under `api/src/`, worker modules under `worker/src/`.
- Keep `worker/` and `cli/` as separate Rust packages; use a root Cargo workspace when shared Rust tooling needs one.
- Keep database migrations and seeds in `db/`, not under runtime directories.
- Put OpenAPI, JSON Schema, and example request or response files under `api/openapi/`.
- Do not create top-level `apps/`, `packages/`, `crates/`, or `contracts/` directories without a product or tooling reason.
- Do not let `web/` import API or worker internals.
- Do not let `skill/` bypass the CLI execution path unless the user asks for a separate integration.

## Module design

- Design modules with a small interface and deep implementation.
- Keep import direction one-way inside each runtime: adapters call application Modules, application Modules call domain Modules, and infrastructure Adapters satisfy Interfaces consumed by application Modules.
- Do not import runtime-specific frameworks, database clients, OpenAPI generation glue, or object storage SDKs from domain Modules.
- Do not expose Better Auth library internals as product domain types.
- Do not duplicate account, authorization, sign-in, or publication policy inside the Rust worker.
- Avoid generic `shared`, `common`, `utils`, and `helpers` modules unless they hide real behavior behind a small interface.
- Introduce a seam only when there is a real second adapter, a test adapter, or a planned backend migration need.
- Extract a responsibility into an application module when it gains a second caller or a second implementation; until then, thin route handlers may hold it directly.
- The target module architecture, seams, and interface sketches live in `docs/design/modules.md`. Each OpenSpec change declares in its `design.md` which subset it realizes. Once built, code is the source of truth and `docs/design/modules.md` is updated to match.

## Logging guidance

- Use the same OpenTelemetry-compatible logical record in the Web, TypeScript API, and Rust Worker: `timestamp`, `severityText`, `severityNumber`, `body`, `eventName`, optional `traceId` and `spanId`, `resource`, and `attributes`.
- Use OpenTelemetry severity numbers `1`, `5`, `9`, `13`, `17`, and `21` for `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, and `FATAL` respectively.
- Set `resource.service.name` to `shareslices-web`, `shareslices-api`, or `shareslices-worker`; also include `service.version` and `deployment.environment.name`.
- Name application events and attributes with stable dot-delimited namespaces. Use lower snake case within a multi-word namespace component, such as `shareslices.artifact.processing.retry_scheduled` and `shareslices.retry.reason_code`.
- Emit one JSON object per line from server processes. Web code passes the same structured object to a project logger that selects the browser console level; application code does not call `console.*` directly.
- Preserve request, Artifact, Upload session, processing job, attempt, and retry identifiers when available. Propagate W3C Trace Context fields when tracing context exists.
- Record retry and unclassified failures with a stable reason code plus sanitized `exception.type`, `exception.message`, `exception.stacktrace`, and cause-chain fields. Keep enough error evidence to classify additional failures in later versions.
- Never log credentials, session cookies, Share slugs, raw Artifact content, or archive entries without redaction. Treat exception messages and stack traces as potentially sensitive and redact before emission.

## Frontend guidance

- Build the Web UI as a quiet management surface, not a marketing site.
- Name route-level Web components with the `*Page` suffix. Name reusable containers for their concrete role, such as `*Layout`, `*Shell`, `*Section`, or `*Panel`; do not introduce `*Screen` component or file names.
- Target desktop browsers only. Use `1440x900` as the default design and screenshot viewport; the minimum supported viewport is `1280x720`.
- Do not design, implement, test, review, or propose mobile or tablet layouts. Do not add mobile breakpoints, responsive navigation, mobile stacking, touch-specific interactions, or mobile screenshots unless the user explicitly changes the product scope.
- Behavior below the minimum supported viewport is not an acceptance criterion. Frontend plans and implementation reports must not spend tokens discussing mobile responsiveness or mobile compatibility.
- Use shadcn/ui Base UI components for Web interface primitives and compositions, installed as local source components through the shadcn CLI. Do not mix shadcn component bases in this project. When touching a hand-written UI primitive, migrate that component and its usages to the shadcn Base UI variant instead of expanding mixed primitive stacks.
- Use lucide icons for common actions.
- Use Tailwind CSS v4 with the Vite plugin and CSS-first configuration.
- Keep design tokens in CSS. Align visual tokens with the Geist reference where practical.
- Do not add a global client state store until server state and component state are insufficient.
- Prefer TanStack Query for client-side server state when the app needs caching.

## Backend guidance

- Treat the backend as the only business source of truth.
- Treat Hono as the current HTTP adapter, not as the backend architecture.
- Keep route handlers thin.
- Do not pass Hono `Context`, `Request`, `Response`, runtime-specific APIs, or OpenAPI generation glue into domain or application modules.
- Mount Better Auth under `api/src/http/` as an auth adapter, such as `/api/auth/*`, when its routes are exposed; ShareSlices-owned routes may instead wrap `auth.api.*` calls directly.
- Use Better Auth session validation to resolve ShareSlices `user_id` before calling product application modules.
- Keep Better Auth email verification and account linking configuration aligned with `PRODUCT.md`; do not let provider email matching override ShareSlices account resolution rules.
- Use Zod schemas at the HTTP seam, then map validated DTOs into application commands.
- Keep the checked OpenAPI spec in `api/openapi/` as the contract source of truth. Move to `@hono/zod-openapi` generation once routes are typed, and add OpenAPI drift validation when CI is established, so public contracts do not change accidentally.
- API naming and method shapes follow Google AIP resource-oriented design (AIP-121, 122, 130–136: `https://google.aip.dev/121`). Microsoft REST API guidance is the secondary practical reference for URIs, casing, request IDs, and operational concerns; Zalando RESTful API Guidelines and JSON:API Recommendations are tie-breakers only. If external guidelines conflict with this file, follow this file. If this file conflicts with `PRODUCT.md`, stop and resolve the product decision first.
- Keep JSON management API routes under `/api`; keep public Viewer routes such as `/a/{shareSlug}/` outside management API route groups.
- Name path resources with plural nouns, not verbs. Express standard operations with HTTP methods: `GET` reads, `POST` creates or starts non-idempotent operations, `PUT` replaces, `PATCH` partially updates, and `DELETE` removes.
- Use lowercase kebab-case for multi-word path segments and camelCase for OpenAPI path parameter names, JSON object fields, operation IDs, and TypeScript DTO fields. Use lower_snake_case for stable machine-readable error codes.
- Avoid trailing slashes on JSON API routes. Viewer page routes may keep trailing slashes when the public URL contract requires them.
- Keep nested resources shallow; avoid paths deeper than collection/item/collection/item unless the product model requires it.
- Model durable business events as resources when possible (`POST /api/artifacts/{artifactId}/publications`, not `:publish`). Custom action routes only when the operation cannot be modeled as a resource; follow AIP-136 `:{verb}`, use `POST` for mutations, and document idempotency and side effects in OpenAPI.
- Keep semantic validation in application modules when it depends on account state, authorization, upload state, or publication state.
- Add automated tests for HTTP request validation and authorization seams.
- Keep structured event names, attribute names, and reason codes stable for operational search across all runtimes.
- Validate archive paths and entry files on the server. Do not treat CLI or Skill checks as a security guarantee.
- Store immutable asset metadata with path, object key, size, content type, and sha256.
- Keep object storage private. Do not return object storage URLs or signed object storage URLs to browsers.
- Keep app-origin routes and viewer-origin routes separate in code. Do not expose management APIs from viewer-origin route groups.
- Stream viewer assets through the backend after route authorization and path validation.
- Set `Cache-Control: no-store` on all Preview and Viewer responses in version 0.0.1; later versions can introduce version-aware caching without weakening Publish and Unpublish behavior.
- Do not decompress artifact archives in Hono request handlers.

Migration readiness:

- Keep HTTP contracts, database schema, object storage layout, and CLI-facing behavior stable enough that API and worker processes can scale independently later.
- Keep database access behind repository or query modules; do not let Drizzle query builders or sqlx query macros become cross-module contracts.
- Keep object storage access behind a storage interface; expose object keys and metadata through domain types.
- Keep public request and response contracts language-neutral through OpenAPI, JSON Schema, or checked contract tests.
- Do not implement parallel all-Node.js, all-Rust, Go, or alternative backend stacks before measurements justify the extra runtime.

## Worker guidance

- Keep upload intake in `api/`; it validates the signed-in user, creates upload sessions, records raw object keys, and queues processing jobs.
- Keep performance-sensitive artifact work in `worker/`: archive expansion, entry-file validation, manifest generation, processed-file storage, and version commit orchestration.
- Run the Rust worker as a separate process that claims jobs from durable storage.
- Do not embed Rust into the Hono API through native addons, FFI, or request-time subprocess calls.
- Avoid loading full archives or expanded artifacts into memory; use bounded readers, temporary files when archive formats require seeking, and stream each expanded file to object storage.
- Write expanded files to object storage with an explicit concurrency limit, such as a Tokio semaphore around upload tasks.
- Keep database transitions for job lease, upload session, version commit, and failure state idempotent.
- Treat the Rust worker as the only accepted second backend runtime until measurements or product requirements justify another one.
- Do not move ordinary account, authorization, or publication API work into Rust without measured pressure or a product reason.

## CLI guidance

- Keep CLI output readable for the user audience defined in `PRODUCT.md`.
- Keep auth, packaging, transfer progress, retries, and REST calls in the CLI.
- Keep shortcut commands as orchestration over the same server APIs used by stepwise commands. Do not let shortcut commands bypass server validation.
- Return machine-readable output behind an explicit flag when agents need structured results.

## Skill guidance

- Keep the official Skill thin: discover entry files, call the CLI, summarize results.
- Do not put lifecycle, storage, or access rules in the Skill.
- Prefer CLI invocation over hand-written REST calls in the official Skill. This does not block external API integrations described by `PRODUCT.md`.

## Viewer security

- Treat served user HTML, JavaScript, CSS, images, fonts, and data files as untrusted content.
- Keep management API routes and Viewer routes in separate HTTP route groups, and never expose management operations from the Viewer route group.
- Resolve Web, API, and Viewer addresses from deployment configuration. Do not hardcode Docker Compose, Kubernetes, IP, port, or public-domain values in application behavior.
- Version 0.0.1 Preview reuses the current management session and verifies Artifact ownership plus ready-Version state on every Preview request. Do not add a separate Preview session or grant in this version.
- Serve Preview content from authenticated API routes so the current management session is available. Accept the same-origin untrusted-content risk for version 0.0.1 as documented in the active change.
- Keep object storage private, validate requested asset paths, and stream only committed Version objects referenced by the manifest.
- Preserve relative Artifact paths under trailing-slash entry URLs. Do not rewrite HTML or promise support for root-absolute Artifact URLs in version 0.0.1.
- Defer separate-site Cookie isolation, strict CSP and Permissions Policy, opener isolation, and other browser hardening until after the functional 0.0.1 flow.

Deployment profiles for version 0.0.1:

- Local development uses containerized PostgreSQL and object storage with the Web, API, and Worker running as local processes through `mise run dev` for fast feedback.
- Local production simulation and end-to-end validation use the full Docker Compose stack through `mise run dev-compose`.
- Unit tests, static checks, and other local quality gates run directly through `mise run check`.
- Shared testing and intranet production use Kubernetes without requiring domain names.
- Public production uses Kubernetes with configured public domain names.
