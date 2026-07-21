# Cloudflare database runtime prototype evidence

## Scope

On 2026-07-19, the feasibility gate used pinned Wrangler `4.112.0`, Workers
compatibility date `2026-07-19`, `nodejs_compat`, Better Auth `1.6.23`, Drizzle
ORM `0.44.7`, Hono `4.12.28`, and `pg` `8.22.0` against a disposable Supabase
PostgreSQL `17.6` project in `ap-southeast-1`.

The repository migration `db/migrations/0001_account_entry.sql` was applied to
the disposable database. A cache-disabled Hyperdrive configuration used TLS
mode `require` and the provider's direct PostgreSQL endpoint. Under the current
Cloudflare contract this mode validates the certificate chain against WebPKI,
but it does not add the hostname match provided by `verify-full`; this prototype
therefore does not qualify production origin identity. Cloudflare
accepted a minimum origin connection limit of `5`; it rejected the attempted
value `3` with provider error code `2021` and documented the accepted range as
`5` through `20`.

The disposable database Worker bundled the real packages without aliases or
Node stubs. Its deployed bundle was 2,357.69 KiB before compression and 399.85
KiB gzip, with a measured startup time of 61 ms.

## Result

A route-free verifier Worker invoked the database Worker through a production
Service Binding, so the test ran inside Cloudflare's network without exposing a
verification route. The scheduled edge invocation passed all of these checks:

```json
{"event":"database_runtime_verified","evidence":{"pg":{"query":"passed","ssl":true},"drizzle":{"query":"passed","matchingUsers":1},"betterAuth":{"signup":"passed","cookie":"passed","cleanup":"passed"},"transport":"service_binding"}}
```

The check exercised:

- a repository `pg.Pool` query through `env.HYPERDRIVE.connectionString`;
- confirmation from `pg_stat_ssl` that the origin database connection used TLS;
- a Drizzle query against the migrated `user` table;
- Better Auth email/password signup with the repository's actual Drizzle schema
  mapping;
- issuance of an `HttpOnly` session Cookie; and
- deletion of the test-owned account after verification.

The first Better Auth attempt intentionally exposed an integration boundary:
passing `pg.Pool` directly to Better Auth made the library query default
camelCase columns such as `emailVerified`, while the repository migration uses
snake_case columns such as `email_verified`. Reusing the repository's
`drizzleAdapter` and schema made the same edge test pass. The Cloudflare target
therefore must preserve the existing account model and adapter instead of
adding a Cloudflare-specific account or authorization implementation.

The verifier Worker and its recurring trigger were deleted immediately after
the passing run. The database Worker was retained only through task 1.4 and was
then deleted. The isolated Hyperdrive configuration and disposable database
remain temporarily available for later feasibility checks.

The `pg_stat_ssl` result proves encrypted transport only. Task 5.3 must repeat
the runtime path with `verify-full` or a subsequently qualified equivalent and
must include a wrong-host or untrusted-certificate negative case before this
evidence can support production database qualification.

## Official contract alignment

- Cloudflare lists Supabase and PostgreSQL 17.x as supported Hyperdrive targets
  and recommends a second direct connection for statements Hyperdrive does not
  support: <https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/>.
- Cloudflare documents that `env.HYPERDRIVE.connectionString` is intended for
  existing database drivers and ORMs: <https://developers.cloudflare.com/hyperdrive/get-started/>.
- Supabase documents the direct endpoint as the persistent-backend connection
  and identifies its IPv6 network property: <https://supabase.com/docs/guides/database/connecting-to-postgres>.

## Boundary

This evidence completes task 1.3. It proves package and repository account-model
compatibility through the Cloudflare entrypoint, but it does not yet classify
all application queries, transactions, session-level operations, or direct
PostgreSQL fallbacks required by task 1.4.
