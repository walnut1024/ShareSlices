# Cloudflare doctor contract audit

## Conclusion

Task 12.1's read-only doctor contract is implemented. The current operator
account is not thereby qualified: missing Workers Paid, owned production sites,
provider limits, Containers, direct PostgreSQL, verified Resend domain, or other
fresh evidence still returns an unavailable prerequisite and blocks activation.

## Read-only inputs

`deploy/cloudflare/adapter.mjs` uses only:

- the pinned local toolchain/schema check;
- `terraform version -json`;
- `wrangler whoami --json`;
- DNS and TLS probes;
- the injected provider observer using the read-only provider token;
- an injected read-only immutable release-store access probe;
- non-secret configuration, release identities, and operator evidence.

The common lifecycle returns prerequisite-unavailable when any required check is
unavailable. It does not resolve runtime Secret values, send Resend mail, create
resources, mutate provider state, or infer a missing fact from historical
evidence.

## Covered checks

The doctor checks:

- exact Wrangler, Terraform provider/schema, compatibility date, and Terraform
  CLI baseline;
- the selected authenticated account;
- logical Secret references and non-secret revisions;
- application and content DNS/TLS;
- required immutable Worker, Static Assets, and Container artifacts;
- selected field ownership;
- provider-observed Workers Paid, private R2, zones, distinct registrable sites,
  Queues, Worker existence, disabled `workers.dev`/preview URLs, bindings,
  schedules, Queue consumer settings, and per-role Worker CPU;
- operator-bounded Worker CPU, Queue/schedule settings, and Container settings;
- current provider/operator Upload-limit evidence and pinned release-static
  Static Assets limits with explicit evidence classification;
- cache-disabled Hyperdrive and required migration/trusted-Container direct
  PostgreSQL reachability with `verify-full` or qualified equivalent, positive
  runtime evidence, and a wrong-host/untrusted-certificate negative probe;
- immutable release-store read access;
- exact Resend endpoint/team/domain/key revision, verified domain,
  disabled-tracking and account-operational evidence with maximum age.

The optional Viewer-byte cache remains a warning until representative cache
measurement passes.

## Unknown and stale behavior

The production provider observer does not invent quota headroom that its APIs do
not return. An absent/stale Upload limit therefore fails closed. Static Asset
limits are labeled `release-static`, not provider-observed. Container and
Queue/configuration bounds are labeled `operator-evidenced`, while live account
resources are `provider-observed`.

Resend sending-access credentials are not broadened to inspect account
administration. Facts the sending key cannot observe must come from fresh
operator/dashboard evidence or remain unavailable.

## Verification

`deploy/cloudflare/adapter.test.mjs`,
`deploy/cloudflare/provider-observation.test.mjs`,
`deploy/cloudflare/database-doctor.test.mjs`, and lifecycle tests cover the
qualified, missing, stale, mismatched, read-only, and redacted paths. Provider
and staging acceptance tasks remain open.
