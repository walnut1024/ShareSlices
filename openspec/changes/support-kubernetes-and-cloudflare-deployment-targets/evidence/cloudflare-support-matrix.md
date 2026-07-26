# Cloudflare prototype and ownership support matrix

Evidence refreshed: 2026-07-26

This matrix separates disposable prototype evidence from production target
qualification. `provisional` means the named provider interface was exercised
within its bounded prototype scope. It does not make the complete Cloudflare
target available.

## Plan and external-prerequisite boundary

| Capability or interface | Workers Free | R2 subscription | Workers Paid | Owned domain or site | Current classification |
| --- | --- | --- | --- | --- | --- |
| Trusted and content Hono HTTP semantics | sufficient for disposable request-contract probes | not required | required only as part of complete production target | required for production ingress and distinct-site acceptance | provisional |
| Web Static Assets precedence and headers | sufficient for disposable `workers.dev` staging | not required | required by the complete production target | required for production ingress | provisional |
| App and Content versions, zero-percent selection, overrides, and version-scoped Secrets | sufficient for the exercised disposable scripts | not required | required by the complete production target | required for production ingress | provisional |
| Route-free Service Bindings | sufficient for the exercised App, Content, and verifier scripts | not required | required by the complete production target | not required for the private binding itself | provisional |
| Worker retained-version rollback | sufficient for the exercised two-version Worker | not required | required by the complete production target | not required for the private version operation | provisional |
| Queue consumer and Cron attach/detach writes | sufficient for the disposable control-plane probe | not required | required with Containers for product processing | not required for route-free control | provisional; pause-state and propagation acceptance blocked |
| Private R2 streaming, range, and multipart operations | Worker execution remains bounded by Free limits | required and separately metered | required by the complete production target | not required while the bucket stays private | provisional |
| Cache-disabled Hyperdrive | sufficient for bounded HTTP/runtime probes | not required | required by the complete production target | not required | partial; TLS identity and connection-budget qualification blocked |
| Trusted Rust processing Container | unavailable | not sufficient | required | not required for the route-free Container itself | blocked |
| Secretless Chromium thumbnail Container | unavailable | required for private input/output storage | required | not required for the route-free Container itself | blocked |
| Resend authentication email | independent of Workers entitlement | not required | required by the complete production target | verified sending domain required | test-mode only; production acceptance blocked |
| Production App and content ingress | `workers.dev` is prototype-only | not sufficient | required | operator-owned zones on distinct registrable sites required | blocked |
| Full Jobs `exports`, Container image, Secret retirement, activation, and rollback | cannot exercise Container-dependent graph | not sufficient | required | production ingress remains separate | blocked |
| Complete Cloudflare lifecycle and target qualification | insufficient | insufficient by itself | required | owned sites and verified Resend domain required | blocked |

The executable field owner selection remains
`deploy/cloudflare/ownership.json`. Queue consumer ownership, delivery pause
state, and Cron trigger ownership remain activation-blocking there. This matrix
does not override those machine-readable gates.

## Final prototype inventory refresh

The refresh used authenticated Wrangler `4.112.0` against the intended account
and performed only read operations:

- `wrangler queues list` returned no Queues.
- `wrangler r2 bucket list` returned no R2 buckets.
- deployment reads for every checked feasibility and `shareslices-opsx-*`
  prototype name returned the provider's absent-script result.
- `wrangler hyperdrive list` returned one retained private
  `shareslices-feasibility-postgres` configuration. It has caching disabled,
  origin connection limit `5`, TLS mode `require`, no public route, and no
  trigger.

No Worker, public route, Preview URL, Queue, consumer, Cron trigger, R2 bucket,
custom domain, or Container from the bounded prototypes remains active.

The retained Hyperdrive is owned by the Cloudflare account operator solely for
task 5.3's next explicitly authorized TLS-origin and connection-budget run. Its
retention expires at `2026-07-31T00:00:00Z`; at or before that time the
operator must either record a new bounded owner and expiry or delete it and
repeat the read-only inventory. Its presence does not authorize automatic
Supabase project selection and does not qualify PostgreSQL recoverability,
Workers Paid, or the Cloudflare target.

## Decision

Workers Free plus the separately enabled R2 subscription remains a disposable
prototype profile only. Workers Paid, two operator-owned production browser
sites, a verified Resend sending domain, full Container qualification, and the
remaining lifecycle evidence are mandatory before Cloudflare activation.
Failure or deferral of those gates does not block Kubernetes delivery and does
not permit a Cloudflare-specific product-policy workaround.
