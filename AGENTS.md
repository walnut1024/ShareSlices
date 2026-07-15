# AGENTS.md

Repository-wide engineering guidance for ShareSlices. Keep this file limited to rules that apply across product surfaces; scoped implementation rules live with the surface they govern.

## Read scoped guidance

Codex may start from the repository root, so read every applicable scoped file before changing those surfaces:

- `web/**`: [web/AGENTS.md](web/AGENTS.md)
- `api/**`: [api/AGENTS.md](api/AGENTS.md)
- `worker/**`: [worker/AGENTS.md](worker/AGENTS.md)
- `cli/**`: [cli/AGENTS.md](cli/AGENTS.md)
- `skill/**`: [skill/AGENTS.md](skill/AGENTS.md)
- `db/**`: this file. If a migration also changes API or Worker code, read the scoped guidance for each affected runtime before editing its code
- `docs/**`, `PRODUCT.md`, `CONTEXT.md`, or `openspec/**`: [docs/README.md](docs/README.md)
- All other paths: this file unless a closer `AGENTS.md` applies

Scoped files inherit this file. When authoring scoped guidance, specialize only subtree implementation. Do not copy mutable product or contract details or claim ownership of documentation authority, cross-runtime boundaries, or repository-wide security; update the durable owner instead.

## Agent workflows

- Issues and product requirement documents (PRDs) use the local Markdown tracker described in [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).
- Triage role names and tracker status mapping live in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- Read [CONTEXT.md](CONTEXT.md) and relevant architecture decision records (ADRs) as directed by [docs/agents/domain.md](docs/agents/domain.md) before exploring a domain area.

## Documentation authority

- [docs/README.md](docs/README.md) owns the documentation map, fact ownership, lifecycle, and conflict rules. Read it before editing a durable document.
- [PRODUCT.md](PRODUCT.md) owns product behavior and boundaries. Update it first when product policy changes.
- [CONTEXT.md](CONTEXT.md) owns accepted product and system vocabulary. An active OpenSpec change may propose candidate terms; add accepted terms to `CONTEXT.md` before using them in code or durable documents and before archiving the change.
- Implemented requirements live in `openspec/specs/`. Use `openspec/changes/` and the OpenSpec workflow (`/opsx:propose`, `/opsx:apply`, `/opsx:archive`) for changes to observable product behavior, public contracts, cross-runtime workflows, or target architecture. A scoped fix that restores an implemented contract does not require a new change.
- [api/openapi/](api/openapi/) owns the HTTP wire contract: paths, parameters, fields, status codes, headers, and schemas. Keep it synchronized with implemented behavior and OpenSpec requirements.
- [docs/design/modules.md](docs/design/modules.md) records current and target module architecture. Code is authoritative for implemented structure; update the design document when that structure changes.
- Durable documents must not depend on an active change. Move lasting decisions into their durable owner before archiving the change.

## Technology and runtime boundaries

- Web uses React, TypeScript, Vite, Tailwind CSS v4, and shadcn/ui with Base UI primitives.
- The API uses TypeScript on Node.js with Hono, Zod, Better Auth, Drizzle ORM, PostgreSQL, and private S3-compatible storage.
- The Worker and CLI are separate Rust packages. The Worker uses Tokio and `sqlx`; the CLI remains a small single-binary client of the HTTP contract.
- The backend is the only business source of truth. Web, CLI, and Skill clients must not reproduce account, authorization, Artifact lifecycle, or Publication policy.
- The API and Worker do not import one another. They coordinate through checked migrations, durable state, object layouts, and language-neutral contracts.
- Do not add another backend runtime or a parallel implementation stack without measured pressure or a product requirement.

## Repository shape

- Keep direct top-level surfaces: `web/`, `api/`, `worker/`, `cli/`, `skill/`, `db/`, `deploy/`, `docs/`, `tools/`, and `openspec/`.
- Put API implementation under `api/src/`, Worker implementation under `worker/src/`, database migrations and seeds under `db/`, and HTTP contract files under `api/openapi/`.
- Keep `worker/` and `cli/` as separate Cargo workspace members.
- Do not create top-level `apps/`, `packages/`, `crates/`, or `contracts/` directories without a product or tooling reason.
- Do not let `web/` import API or Worker internals.
- The official Skill always uses the CLI execution path. Treat a separately requested external API integration as a different surface governed by [PRODUCT.md](PRODUCT.md) and the checked OpenAPI contract.

## Module design

- Prefer a small public interface with a deep implementation.
- Keep import direction one-way inside each runtime: adapters call application modules, application modules call domain modules, and infrastructure adapters implement interfaces consumed by application modules.
- Keep frameworks, database clients, OpenAPI glue, and object-storage SDKs out of domain modules.
- Do not expose Better Auth internals as product types or duplicate account, authorization, sign-in, or Publication policy in the Worker.
- Add a seam only for a real second adapter, a test adapter, or a planned backend migration. Extract an application module when a responsibility gains a second caller or implementation.
- Avoid generic `shared`, `common`, `utils`, and `helpers` modules unless they hide a coherent responsibility behind a small interface.

## Development and verification

- Use `mise run <task>` as the documented entry point for repository development, build, test, validation, and local operations.
- Use `mise run dev` for normal local development and `mise run dev-compose` for full-stack production simulation.
- `mise run check` is the authoritative local quality gate. `.mise.toml` and package scripts own its current contents; do not copy that list into durable documents.
- Run focused `mise` tasks while iterating, then run `mise run check` before handing off code or durable-document changes.
- Add a new gate to the relevant `mise` task in the same change as the behavior it checks.
- Do not weaken a failing tool to make a change pass unless the tool is wrong and the reason is documented in the same change.

## Logging and sensitive data

- Use the existing OpenTelemetry-compatible project loggers and record contract. Server processes emit one JSON object per line; Web application code does not call `console.*` directly.
- Keep event names, attribute names, reason codes, request identifiers, Artifact identifiers, job identifiers, attempt identifiers, and trace context stable when available.
- Treat exception messages and stack traces as sensitive. Redact credentials, session cookies, Share slugs, raw Artifact content, archive entries, and other secrets before logging.
- Treat the logging modules and their tests as the executable schema; do not create a competing record definition.

## Viewer security

- Treat served user HTML, JavaScript, CSS, images, fonts, and data files as untrusted content.
- Keep object storage private. Authorize each request, validate requested paths against the committed manifest, and stream only committed Version objects.
- Do not expose management operations from Viewer paths or public Viewer ingress. Keep management, Preview, internal capture, and Viewer authorization boundaries explicit.
- Resolve Web, API, Viewer, and internal service addresses from deployment configuration. Do not hardcode deployment topology in application behavior.
- Product policy and implemented specs own Preview sessions, Viewer URLs, caching, relative-path support, and browser-hardening scope. Do not duplicate version-specific behavior here.
