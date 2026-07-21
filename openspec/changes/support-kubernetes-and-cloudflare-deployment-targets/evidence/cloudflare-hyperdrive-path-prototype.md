# Cloudflare Hyperdrive path prototype evidence

## Scope

On 2026-07-19, the disposable database from task 1.3 was advanced through all
repository migrations from `0001` through `0028` (there is no repository
`0023`). The same deployed Worker and cache-disabled Hyperdrive configuration
then exercised representative SQL for authentication, authorization, Viewer,
Gallery, and processing job-state paths.

The edge-only verifier used a production Service Binding and one-minute Cron.
No public verifier route or custom domain was created.

## Passing result

The final scheduled invocation emitted this redacted result:

```json
{"event":"database_runtime_verified","evidence":{"pg":{"query":"passed","ssl":true},"drizzle":{"query":"passed","matchingUsers":1},"betterAuth":{"signup":"passed","cookie":"passed","cleanup":"passed"},"hyperdrive":{"paths":{"authentication":"passed","authorization":"passed","viewer":"passed","gallery":"passed","jobState":"passed"},"transactionRollback":"passed","advisoryLock":"observed_succeeded_but_unsupported"},"transport":"service_binding"}}
```

The path checks covered parameterized user/session-compatible reads,
owner-scoped Artifact authorization, Viewer Publication resolution joins,
Gallery discovery joins, and a processing-job claim read using `FOR UPDATE SKIP
LOCKED`. A transaction inserted a verification fixture, rolled it back, and
proved the row did not persist. These checks passed through the same
cache-disabled binding; none relied on Hyperdrive query-cache invalidation.

## Direct PostgreSQL inventory

The official Hyperdrive contract excludes advisory locks, `LISTEN`/`NOTIFY`,
SQL-level prepared-statement management, and undocumented per-session state.
A repository-wide source scan found no `LISTEN`, `NOTIFY`, SQL `PREPARE`,
`DEALLOCATE`, `DISCARD`, or session-state mutation. The operations that require
a direct PostgreSQL connection are therefore:

| Operation | Source owner | Direct-connection reason |
| --- | --- | --- |
| Migration serialization and migration execution | `api/src/db/migrate.ts` | Uses session advisory lock/unlock; deployment migration remains a direct, one-shot operation. |
| Create or reuse an email verification attempt | `createVerificationAttempt` in `api/src/db/authentication-email-repository.ts` | Uses a transaction-scoped advisory lock to serialize email/purpose state. |
| Accept an authentication-email delivery | `acceptAuthenticationEmailDelivery` in `api/src/db/authentication-email-repository.ts` | Uses two transaction-scoped advisory locks for email and source-IP rate serialization. |
| Gallery disable rollback | `GalleryRollbackCoordinator.reconcileDisabled` | Uses the `gallery-rollback` transaction-scoped advisory lock. |
| Gallery reconciliation | `GalleryReconciliation.run` | Uses the `gallery-reconciliation` transaction-scoped advisory lock. |
| Trusted Rust processing and job-state mutation | `worker/src/job_store.rs` and its processing Container | The target architecture assigns trusted Container database access to direct TLS PostgreSQL; Hyperdrive is not a Container database transport. Its ordinary transactions and row locks are protocol-compatible but remain on the direct Adapter by runtime ownership. |

All other currently implemented Worker-eligible authentication, authorization,
Viewer, Gallery request-path, and job-state observation queries may use the
cache-disabled Hyperdrive Adapter when they avoid the direct operations above.
Ordinary transactions, parameter binding, row locks, and `FOR UPDATE SKIP
LOCKED` did not by themselves require a direct fallback in this prototype.

## Advisory-lock observation

The same pinned deployment observed both rejection and apparent success for
`pg_advisory_xact_lock` across separate invocations. The final passing evidence
records the apparent-success observation, but does not classify the feature as
supported. Cloudflare's official contract explicitly excludes advisory locks,
so these repository operations remain direct even when a single invocation
appears to work. This prevents field behavior from overriding the provider's
compatibility guarantee.

Official reference:
<https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/>.

## Cleanup and boundary

The database Worker and verifier Worker, including the recurring Cron trigger,
were deleted after the passing run. The Hyperdrive configuration and disposable
database remain isolated for later prototype tasks.

This evidence completes task 1.4. It does not qualify migrations, the direct
Container database Adapter, R2 streaming, release automation, or production
capacity.
