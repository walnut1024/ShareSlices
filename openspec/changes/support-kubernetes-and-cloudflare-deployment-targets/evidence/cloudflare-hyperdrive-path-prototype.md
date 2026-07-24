# Cloudflare Hyperdrive path prototype evidence

<!-- cspell:words Supavisor -->

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
| Dispatch one authentication-email delivery | `dispatchOneAuthenticationEmail` in `api/src/application/accounts/authentication-email-dispatcher.ts` | Keeps claim, provider submission, lease heartbeat, and terminal transition on one explicitly checked-out direct client. This is a runtime session-continuity requirement even though its individual statements are ordinary PostgreSQL operations. |
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

The next disposable run also has explicit checks for `node-postgres` named
prepared statements, transaction-local state reset, PostgreSQL statement
timeout propagation, and a one-connection Worker-side pool. The named-statement
probe is a conservative driver-compatibility check, not evidence that current
ShareSlices application queries name their prepared statements: the repository
currently uses parameterized `node-postgres` and Drizzle queries without a
checked application-level `name`. Cloudflare documents protocol-level named
prepared statements from `node-postgres` as supported while separately
excluding SQL-level statement management such as `PREPARE`, `EXECUTE`,
`DEALLOCATE`, and `DISCARD`. These probes are committed but not yet recorded as
passing live evidence. They do not replace the provider configuration's
origin-connection limit or the production TLS negative test.

## Production TLS follow-up

On 2026-07-21, a bounded Wrangler update attempted to change the retained
Hyperdrive configuration from `require` to `verify-full` while preserving its
cache-disabled setting. Cloudflare rejected the update with API error `2007`
because `ca_certificate_id` was absent. No public Worker, route, trigger, Queue,
or Container was created by this attempt, and the retained configuration was
not intentionally downgraded or treated as qualified.

This result matches the current first-party configuration contract:

- Hyperdrive `require` validates a WebPKI certificate chain but does not add the
  hostname match required by this change;
- `verify-full` requires an uploaded CA certificate and its
  `ca_certificate_id`;
- the uploaded CA must be the database's region-specific single certificate,
  not a multi-certificate global bundle; and
- Supabase exposes the project server root certificate in the dashboard's
  Database SSL Configuration section.

Task 5.3 therefore remains pending. Its live qualification must first obtain the
correct Supabase CA through an operator-authorized path, upload it as a
Cloudflare certificate-authority resource, configure Hyperdrive with
`verify-full`, prove the expected hostname succeeds, and prove a wrong-host or
untrusted-certificate case fails. The CA resource identifier may be recorded as
non-secret inventory; database credentials and certificate contents must not be
written to release evidence.

Official references:

- <https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/>
- <https://developers.cloudflare.com/api/resources/hyperdrive/>
- <https://supabase.com/docs/guides/platform/ssl-enforcement>

## 2026-07-22 qualification attempt

A new route-free verifier run first passed the existing representative path,
transaction rollback, named `node-postgres` statement, transaction-local state
reset, `100ms` statement timeout, and one-connection Worker pool assertions
through the retained cache-disabled Hyperdrive configuration. Both disposable
Workers and the one-minute Cron were deleted immediately after that evidence.

The prototype was then extended to require two stronger behaviors before task
5.3 can pass:

- a committed value read through one logical Pool, updated, and immediately
  reread through a new Pool with the same query key must expose the new value;
- while the first client is checked out from a Pool configured with `max: 1`, a
  second `connect()` must remain queued until the first client is released.

Those assertions and phase-scoped redacted diagnostics are implemented in the
working prototype, but the enhanced live run did not complete. The retained Hyperdrive
began returning PostgreSQL `58000` / network-connection failures, eventually on
the minimal `/prototype/pg` query, after previously succeeding. Repeating the
same invocation was stopped rather than treating an intermittent provider path
as qualification evidence.

The TLS attempt extracted the single self-signed `Supabase Root 2021 CA` from
the public `ap-southeast-1` Supavisor certificate chain and uploaded it as a
disposable Cloudflare CA. Cloudflare accepted an atomic update of the retained
Hyperdrive to cache-disabled `verify-full` with origin connection limit `5`.
An update that replaced the DNS origin with its IPv6 literal then failed with
provider code `2015`, `CERTIFICATE_VERIFY_FAILED`, and `IP address mismatch`;
the original DNS-host configuration remained unchanged. This is valid
wrong-host negative evidence.

The subsequent Worker runtime could not complete even its minimal PostgreSQL
query through that configuration, so control-plane acceptance is **not**
recorded as the required positive runtime proof. The Hyperdrive was restored to
its prior cache-disabled `require` mode, the uploaded CA was deleted, and both
Workers and the Cron were deleted. The final live inventory contains only the
pre-existing private Hyperdrive configuration and disposable Supabase project;
there is no public route, Worker, Cron, Queue, or retained CA from this attempt.
The operator owns both retained private prerequisites. They exist only for the
next bounded database prototype and must be reviewed for removal before final
change handoff if no further live database qualification needs them.

Task 5.3 remains incomplete until the operator-provided CA downloaded from the
Supabase project's Dashboard succeeds through the Worker runtime, the enhanced
freshness and connection-budget assertions pass in the same bounded run, and
the cleanup inventory is repeated. Encryption, control-plane update success,
and the passing wrong-host negative do not substitute for that positive proof.

## 2026-07-25 local verifier hardening

The manual verifier now invokes the same representative Hyperdrive path,
transaction, freshness, named-statement, timeout, and connection-budget probe
as the route-free edge verifier. Both paths use one shared assertion module, and
focused tests reject weakened freshness, timeout, pool-budget, or unsupported
advisory-lock classifications. The minimal connectivity endpoint's failure path
also no longer references a nonexistent database client, so a live TLS or
network failure retains its real redacted phase and PostgreSQL code.

This is local harness evidence only. It starts no Worker, changes no Hyperdrive
or database resource, and does not satisfy the pending `verify-full` live
qualification or cleanup requirement.
