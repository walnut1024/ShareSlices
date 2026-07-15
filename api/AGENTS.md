# API engineering guidance

Inherits [repository-wide guidance](../AGENTS.md) and owns rules specific to `api/**`.

## Architecture

- Treat Hono as the Node.js HTTP adapter, not as the application architecture.
- Keep route handlers limited to authentication context, request parsing, Zod validation, application invocation, and HTTP response mapping.
- Do not pass Hono `Context`, `Request`, `Response`, runtime APIs, or OpenAPI glue into application or domain modules.
- Keep state-, ownership-, authorization-, Upload-, and Publication-dependent validation in application modules.
- Keep Drizzle access behind repository or query modules and object-storage access behind an interface.

## Authentication

- Mount Better Auth under the HTTP adapter when its routes are exposed. ShareSlices-owned routes may wrap `auth.api.*` calls directly.
- Resolve the ShareSlices `user_id` through Better Auth session validation before invoking product application modules.
- Keep email verification and account linking aligned with [PRODUCT.md](../PRODUCT.md). Provider email matching must not override ShareSlices account resolution rules.
- Do not expose Better Auth library types as product types.

## HTTP contract

- [api/openapi/](openapi/) is the checked HTTP wire-contract source of truth.
- Update OpenAPI and focused contract coverage in the same change as any path, parameter, request, response, status, header, authentication, or error-shape change.
- Keep management JSON routes under `/api` and Viewer routes outside management route groups.
- Use plural resource nouns and standard HTTP methods. Model durable business events as resources before introducing a custom action.
- Use lowercase kebab-case for multi-word path segments, camelCase for path parameters, JSON fields, operation IDs, and TypeScript data transfer objects (DTOs), and lower_snake_case for stable error codes.
- Avoid trailing slashes on JSON API routes. Keep nested resources shallow.
- Follow [Google API Improvement Proposals](https://google.aip.dev/121) only when the local rules do not decide a new API shape. Record intentional exceptions in OpenAPI or the active design.

## Security and content handling

- Validate transport-shaped input with Zod, then map it into an application command.
- Validate archive paths and entry files on the Server. CLI and Skill checks are not a security boundary.
- Do not decompress Artifact archives in Hono request handlers.
- Keep object storage private. Do not return object-storage or signed object-storage URLs to browsers.
- Authorize and validate manifest paths before streaming Preview or Viewer assets.
- Do not add management handlers to Viewer paths or public Viewer ingress.

## Verification

- Cover changed request validation, authentication, authorization, semantic validation, and error mapping at the appropriate seam.
- When a wire contract changes, test the API adapter and affected consumers.
- Run `mise run api-test` for API integration or contract changes.
