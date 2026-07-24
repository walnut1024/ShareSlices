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

Focused validation:

- `node --test deploy/automation/telemetry.test.mjs`
- `mise run docs-check`
- `git diff --check`

Task 14.13 remains open. The next work is to connect each runtime and target
observer to this record, set reviewed thresholds, and verify the emitted event
set rather than treating this schema as collection evidence.
