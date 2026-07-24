# Deployment telemetry contract progress

Evidence date: 2026-07-25

`deploy/automation/telemetry.mjs` establishes the shared record and validation
foundation for task 14.13. It defines stable events for deployment operations,
migrations, jobs, Queues, triggers, Containers, database connections, R2,
SMTP, Kubernetes, provider limits, cost risk, and Resend.

Records accept only the exact declared scalar attributes. Alert thresholds must
reference numeric attributes. Unknown events, missing dimensions, nested
provider diagnostics, undeclared attributes, invalid thresholds, and
future-dated evidence fail closed.

Resend classifications require an explicit evidence source. Provider responses
and fresh operator evidence may support a known classification; absent either,
the only accepted source and classification are `unknown`.

The collector defines an exact event set for Compose, Kubernetes, and
Cloudflare. It validates the complete observer set before starting, executes
each applicable observer once, validates every record, and returns one frozen
target bundle. A missing observer or thrown observation fails closed rather
than returning a partially successful telemetry bundle. Resend operator
evidence also carries an age and maximum age; stale evidence is rejected.

Focused validation:

- `node --test deploy/automation/telemetry.test.mjs`
- `mise run docs-check`
- `git diff --check`

The production `status` path now collects the target's complete event set into
one validated telemetry bundle alongside the deployment-status projection.
Unavailable facts remain present as stable `unknown` events rather than
silently omitting an observer.

The first real source integration now projects:

- operation ID, fencing token, and latest phase from deployment control;
- the observed migration head;
- desired and ready Pod counts from Kubernetes workload probe evidence; and
- ready-Queue and dead-letter backlog from Cloudflare Queue metrics and the
  configured queue-role mapping.

These projections preserve `null` plus `unknown` when evidence is absent instead
of inventing a zero. Task 14.13 remains open for the other owning readers and
reviewed thresholds.

The direct PostgreSQL control observer also now reads:

- queued work and active leases across all eight current job tables, refusing a
  partial table set rather than undercounting;
- active connections to the current database; and
- the server's observed connection limit.

Database projection derives warning and critical thresholds at 80 and 90
percent of the observed limit. The query path is read-only and exposes only
aggregate counts.

SMTP projection reads only the newest SMTP delivery's stable state and
result-classification fields. It never selects recipient, payload, endpoint, or
provider diagnostics. An older migration prefix without transport columns
produces `unknown` rather than breaking status observation.

Cloudflare scheduled delay now comes from the durable difference between
`cloudflare_scheduled_invocation.started_at` and `scheduled_time`. The
projection deliberately has no guessed default threshold: the current Cron
manual documents up to 15 minutes for configuration changes to propagate, not
an invocation-delay SLA.

R2 telemetry uses the documented GraphQL Analytics
`r2OperationsAdaptiveGroups` and `r2StorageAdaptiveGroups` datasets for the two
configured private buckets. It aggregates request count and
payload-plus-metadata bytes over a bounded 15-minute window. Missing
permissions, dataset errors, transport failures, and malformed results become
stable `unknown` evidence without provider error text.

Official sources refreshed on 2026-07-25:

- [R2 metrics and analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [GraphQL Analytics limits](https://developers.cloudflare.com/analytics/graphql-api/limits/)

Resend status now derives a redacted health classification only from current
operator evidence already validated by deployment configuration. It emits the
source, age, and maximum age. Missing, future, or stale evidence is normalized
to `unknown`; it never reuses a historical healthy classification or exports
the team, domain, key, or sender.

Cloudflare Container Analytics is scoped only after Wrangler resolves exactly
one application ID for each configured `<installation>-processing` and
`<installation>-thumbnail` name. The GraphQL query filters both
`containersMetricsAdaptiveGroups` and `containersUsageAdaptiveGroups` by those
IDs and reports documented uptime, CPU seconds, memory byte-seconds, disk
byte-seconds, and transmitted bytes. It never aggregates all Containers in the
account.

The official datasets do not expose startup duration. Consequently startup is
explicitly `null`, and Container telemetry remains `unknown` even when runtime
and usage are observed. Cost risk likewise remains `unknown` without current
pricing and allowance evidence; resource usage is not presented as an exact
bill. If Container identity is unavailable, only the Container query is
skipped and the independent R2 query continues.

Additional official source refreshed on 2026-07-25:

- [Querying Containers metrics with GraphQL](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-container-metrics/)
