# Cloudflare HTTP semantics prototype evidence

## Scope

On 2026-07-19, pinned Wrangler `4.112.0` deployed two disposable Workers to the
qualified account's `workers.dev` subdomain:

- `shareslices-feasibility-trusted`
- `shareslices-feasibility-content`

Neither Worker declared a custom domain, zone route, Secret, database, Queue,
object-storage binding, or production application trigger. Both used Workers
compatibility date `2026-07-19` with `nodejs_compat`.

## Result

The deployed trusted Hono graph passed black-box checks for:

- an 81,920-byte streamed request body and streamed response body;
- status, content type, request identifier, and custom response headers;
- a `Secure`, `HttpOnly`, `SameSite=Lax` Cookie;
- structured error mapping that did not disclose the thrown error; and
- a separately constructed streamed response.

The deployed content-only Hono graph passed black-box checks for:

- streamed content with the required non-cache and content-policy headers;
- rejection of a request carrying a management Cookie; and
- absence of the representative `/api/artifacts` management route.

The prototype first reproduced a Workers runtime failure when a Hono request
body stream was reused directly as the response body. The passing implementation
uses a `TransformStream` and registers the forwarding promise with
`executionCtx.waitUntil()`, avoiding complete-body buffering.

The same checked verifier returned:

```json
{"trusted":{"requestBodyBytes":81920,"request":"passed","response":"passed","cookie":"passed","error":"passed","streaming":"passed"},"contentOnly":{"streaming":"passed","policyHeaders":"passed","managementCredentials":"rejected","managementRoute":"unreachable"}}
```

Both disposable Workers were successfully deleted after verification. Listing
either deployment name after cleanup returned no deployment inventory.

## Boundary

This evidence proves the representative HTTP semantics required by task 1.2. It
does not prove Better Auth, PostgreSQL, object storage, application-specific
routes, account authorization, or provider-resource behavior assigned to later
feasibility tasks.
