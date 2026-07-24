# Cloudflare emulation coverage

Evidence date: 2026-07-25

Task 11.16 separates locally testable contracts from behavior that requires a
deployed Cloudflare staging resource. The executable classification is
[`deploy/cloudflare/emulation-coverage.json`](../../../../deploy/cloudflare/emulation-coverage.json).
Its test verifies that every local row names existing evidence and that
provider-only rows cannot silently become local qualification.

Local contract coverage currently includes:

- App Worker dynamic-route precedence and Web-only Static Assets fallback;
- content-only route and dependency least authority;
- route-free App and Content Service Binding version-evidence handlers;
- Jobs Queue, scheduled-gate, and private-binding configuration; and
- R2 Adapter and private-bucket control contracts.

These rows use direct entrypoint tests, generated Wrangler configuration tests,
dependency-authority checks, and binding-level tests. They do not claim that a
Node test is a deployed Worker or that a simulated binding is a provider
resource.

The following are staging-only behaviors; this classification says where they
must be verified, not whether current provider evidence exists:

- actual deployed Worker runtime and compatibility behavior;
- edge Static Assets precedence and response headers;
- deployments, version selection, and external version overrides;
- Hyperdrive origin TLS, freshness, and connection budget;
- Queue and Cron control-plane state and propagation;
- private R2 streaming and range transport;
- Container isolation and rollout; and
- custom-domain and separate registrable-site routing.

The machine-readable rows separately record current provider evidence as
`verified`, `provisional`, or absent. Deployed Worker runtime compatibility,
Static Assets edge behavior, version overrides, and private R2
streaming/range transport have current verified evidence. Queue/Cron is
provisional because Wrangler cannot reread Queue pause state and Cron
propagation completion is not provider-observable. Hyperdrive, Containers, and
custom-domain topology retain their independent missing or blocked gates.

An attempted raw Miniflare run was deliberately not retained as evidence. The
exact dry-run bundles require Worker-specific Node compatibility and dynamic
module handling that raw Miniflare does not reproduce from `scriptPath`; making
the harness pass with undocumented fallback behavior would weaken rather than
strengthen staging qualification. Existing provider prototype evidence remains
the runtime proof until the complete staging rows run.

Current first-party documentation confirms that local development simulates
bindings while version metadata is not an accurate deployed-version identity,
Static Assets are served from local disk, and provider-specific behavior may
require remote or deployed verification:

- [Workers local development](https://developers.cloudflare.com/workers/local-development/)
- [Supported bindings per development mode](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)
- [Static Assets Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)

Task 11.16 remains open until the staging-required rows have current redacted
evidence and all disposable routes, triggers, consumers, and Workers are
removed or disabled afterward.

## Route-free Service Binding staging run

On 2026-07-25, a bounded Workers Free staging run deployed two target Workers
with `workers_dev = false`, Preview URLs disabled, and no routes, domains,
Queues, or triggers. A third short-lived verifier Worker was the only
`workers.dev` target and held exactly two Service Bindings to those Workers.

One POST verification returned the expected App and Content role/version
identities through the real Cloudflare Service Bindings. Direct requests to
both target Workers' possible `workers.dev` hostnames returned 404, confirming
that the targets were not publicly served there.

Cleanup deleted the verifier first and then both targets. A fresh deployments
read returned provider code `10007` for all three exact names, and the prior
verifier URL returned 404. No route, Preview URL, Cron, Queue consumer,
Container, custom domain, or retained Worker was created by this run. The
checked prototype inputs remain under
`deploy/cloudflare/prototypes/route-bindings/` so the same bounded test can be
reviewed and repeated.

This proves the staging Service Binding and private-target subset only. It does
not satisfy the remaining edge Static Assets, version override, Hyperdrive,
Queue/Cron control-plane, R2 transport, Container, or custom-domain rows.

## Static Assets edge staging run

On 2026-07-25, a second bounded Workers Free staging run deployed one
Static-Assets Worker with no custom route, Preview URL, Cron, Queue, R2,
Hyperdrive, Container, or Secret binding. Its asset tree deliberately contained
an `/api/shadow.txt` file while `run_worker_first` selected `/api/*` and
`/runtime-config.json`.

Observed edge responses proved:

- `/api/shadow.txt` returned the Worker body rather than the colliding asset and
  carried `Cache-Control: no-store`;
- `/runtime-config.json` returned the dynamic Worker response with `no-store`;
- `/assets/app.abc123.js` returned the checked static body with
  `Cache-Control: public, max-age=31536000, immutable`; and
- an unknown nested path used the SPA fallback and retained Static Assets'
  revalidating `Cache-Control: public, max-age=0, must-revalidate`.

`CF-Cache-Status` was observed only as corroborating provider metadata and was
not used as the correctness assertion. Cleanup deleted the exact Worker, after
which a deployments read returned provider code `10007` and the prior URL
returned 404. The repeatable prototype is checked under
`deploy/cloudflare/prototypes/static-assets/`.

This completes the Static Assets precedence/header staging row of 11.16. It
does not prove version overrides, Hyperdrive, Queue/Cron control-plane
propagation, R2 transport, Containers, custom domains, or representative cache
economics.

## Version deployment and override staging run

On 2026-07-25, a bounded Workers Free run used Wrangler 4.112.0 to deploy a
baseline version, upload a candidate without activating it, and create a
provider-observed deployment with the baseline at 100% and candidate at 0%.
Both versions returned their exact official Version Metadata binding ID.

After the deployment propagated, an external override request and a fetch-based
Service Binding override both selected the 0% candidate and returned its exact
ID. An ordinary request continued to return the 100% baseline and its exact ID.
This proves that 0% controls ordinary traffic only; it does not make a candidate
private or unreachable.

The first requests also exposed a material control-plane boundary. Immediately
after adding the candidate, an external override initially followed the
baseline percentage and one Service Binding attempt returned provider error
1042. Both selected the candidate after propagation. After replacing the
deployment with baseline-only membership, the public override fell back to the
baseline before the Service Binding did; the Service Binding also fell back
after propagation. Automation must therefore reread membership and verify the
returned Version Metadata ID. A successful control-plane write alone does not
prove global selection or removal.

The prototype compatibility date is `2026-07-24` because Cloudflare's control
plane still considered `2026-07-25` a future date during the Asia/Shanghai
midnight window. Release automation must use a reviewed date rather than derive
one from the operator's local calendar date.

Cleanup removed candidate membership, then deleted the verifier and target.
Fresh deployment reads returned provider code `10007` for both exact names and
both former `workers.dev` URLs returned 404. No custom route, Preview URL,
Secret, Queue, Cron, R2, Hyperdrive, Container, or custom domain was created.
The repeatable inputs remain under
`deploy/cloudflare/prototypes/version-overrides/`.

This completes the version-deployment, external-override, and fetch-Service-
Binding subset of tasks 1.10 and 11.16. It does not prove version-scoped
Secrets, Jobs `exports`, rollback retention, trigger ownership, or integrated
release compensation.

Current first-party references:

- [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
- [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
- [Worker errors](https://developers.cloudflare.com/workers/observability/errors/)

## Queue and Cron control-plane staging run

On 2026-07-25, a bounded Workers Free run created one route-free Worker and one
empty Queue. The Worker had `workers_dev = false`, Preview URLs disabled, an
explicit empty Cron list, and no data, network, Secret, or service binding.

The run attached one Worker consumer with batch size 1, batch timeout 1,
zero retries, and maximum concurrency 1. `queues info` reread exactly one
consumer. Pause and resume commands both succeeded and changed the Queue's
provider `Last Modified` timestamp. However, Wrangler 4.112.0's `queues info`
output does not expose whether delivery is paused. The CLI therefore cannot
satisfy a release gate that requires a read-after-write pause-state proof by
itself; automation needs a qualified provider API reader or a bounded
behavioral probe.

The experimental `wrangler triggers deploy` command attached the exact
`17 4 1 1 *` UTC schedule and reported it, then an explicit empty Cron list
reported `No targets deployed`. This proves the pinned command's attach/detach
write path only. It does not prove global propagation completion. Current
first-party documentation states that Cron additions, changes, and removals may
take up to 15 minutes to propagate.

No Queue message was sent. Cleanup removed the consumer, reread zero producers
and zero consumers, deleted the Queue, and deleted the Worker. A fresh Queue
read reported that the exact Queue does not exist and a fresh deployments read
returned provider code `10007` for the Worker. The repeatable inputs remain
under `deploy/cloudflare/prototypes/queue-cron-control/`.

This records the Queue pause/resume and Cron attach/detach interface subset of
task 1.10 as provisional. Task 11.16 remains open until read-after-write Queue
state and the required Cron safety-window behavior are exercised through the
qualified release path.

Current first-party references:

- [Pause and purge Queues](https://developers.cloudflare.com/queues/configuration/pause-purge/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
