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

Task 14.13 remains open. The next work is to connect each runtime and target
observer to actual status and metrics sources, set reviewed thresholds, and
verify the emitted event set rather than treating this collector as provider
evidence.

The first real source integration now projects:

- operation ID, fencing token, and latest phase from deployment control;
- the observed migration head;
- desired and ready Pod counts from Kubernetes workload probe evidence; and
- ready-Queue and dead-letter backlog from Cloudflare Queue metrics and the
  configured queue-role mapping.

These projections preserve `null` plus `unknown` when evidence is absent instead
of inventing a zero. Task 14.13 remains open for the other owning readers and
reviewed thresholds.
