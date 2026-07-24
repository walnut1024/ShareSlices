# Cloudflare target

This runbook describes the intended Cloudflare production composition and its
implemented read-only deployment boundary. The target is not currently
release-qualified: mutating Cloudflare `apply` and `rollback` remain unavailable
until every implementation-blocking provider gate passes, including Workers
Paid Containers, thumbnail isolation, provider ownership, PostgreSQL transport,
Resend, and representative staging verification.

Workers Free with a separately enabled R2 subscription is useful only for
disposable prototypes. It does not become a reduced production target, and a
successful render, Worker request, `workers.dev` test, or R2 operation does not
qualify the Cloudflare target.

## Production composition

One Cloudflare installation contains:

```text
Edge / CDN
├── Web Static Assets
├── optional authorized immutable Viewer-byte cache
└── dynamic route bypass
Workers
├── App: trusted HTTP, authentication, management, and Preview
├── Content: public Viewer and Gallery content only
└── Jobs: Queue, scheduled, and private release-verification handlers
Data and work
├── external PostgreSQL through cache-disabled Hyperdrive
├── direct TLS PostgreSQL for migration and trusted processing
├── private R2 artifact and deployment-state buckets
├── trusted processing Containers
└── separately isolated secretless thumbnail Containers
Email
└── Resend HTTPS Adapter
```

The App and content origins must use separate registrable sites. A sibling
subdomain does not provide the required browser credential boundary.
`workers.dev` and `r2.dev` are test endpoints, not production origins. Production
uses reviewed Worker custom domains or routes and keeps both R2 buckets private.

## Prerequisites and evidence

Before production planning, record current account observations for:

- Workers Paid entitlement and the qualified Worker, Static Assets, Queues,
  Hyperdrive, Durable Objects, and Containers limits;
- the exact account, owned zones, custom domains, routes, and disabled
  unintended `workers.dev` endpoints;
- an active R2 subscription and two private buckets;
- external PostgreSQL reachability and certificate/hostname verification for
  both Hyperdrive and direct Container connections;
- Queue, dead-letter Queue, consumer, schedule, and pause/resume behavior;
- both Container images, instance types, rollout/rollback behavior, retention,
  and the required isolation and outbound controls;
- a Resend team, verified sending domain, sending-access key, disabled tracking,
  and current retention/operational evidence;
- an encrypted, versioned Terraform backend, immutable release store, recovery
  evidence, and deployment-control PostgreSQL schema;
- provider credentials separated by read observation, infrastructure mutation,
  Worker release, Secret delivery, and Resend sending responsibility.

Run:

```sh
mise run deploy -- doctor --config deployment.json --release release.json
```

`doctor` is read-only. It must report a missing, stale, mismatched, or unproven
capability as unavailable rather than silently substituting a Free-plan
prototype or weaker transport/security behavior.

## Cost-driving controls

The deployment configuration bounds accepted upload and Static Asset sizes,
per-role Worker CPU, Queue batch/retry/concurrency, schedule frequency, and each
Container's instance type, slots, maximum instances, claims per drain, wall
time, concurrency, and sleep delay. The operator safety cap may be lower than a
provider entitlement and may never exceed the qualified release baseline.

Use on-demand Containers and verify that idle instances sleep. Retain enough
image history for the recorded rollback candidate; deleting a Container image
can make an otherwise selectable Worker rollback unusable.

Cloudflare budget alerts and product usage notifications are monitoring, not a
hard spending ceiling. Record them as present only after reading them back from
the selected account. If the account does not expose or has not configured the
intended alert, report that fact; do not claim a spend control from repository
configuration alone. Operational monitoring must cover request, CPU, Queue,
Container runtime/egress, R2, Hyperdrive, and Resend consumption.

## Edge and CDN boundary

`edgeCdn.mode` has two supported policy shapes:

- `web-assets-only` uses Workers Static Assets for the Web build and bypasses
  caching for dynamic application and content responses;
- the optional authorized Viewer-byte mode may reuse only a complete immutable
  representation after current authorization, within the configured size
  limit.

Content-hashed JavaScript, CSS, fonts, and other Web build assets may receive
long-lived immutable caching. API, authentication, management, Upload,
Preview, temporary grants, Cookies, Range/206 responses, errors, and all outward
Viewer responses remain `no-store`. Internal Viewer-byte reuse must never turn
R2 into a public origin or skip current authorization. Its cache key includes
every representation input, and publication/version changes use a new immutable
identity.

Static Assets are already served through Cloudflare's edge; there is no
separate CDN appliance to provision. R2 remains private and is accessed through
bindings or authorized Worker routes. Do not attach a public R2 custom domain:
doing so makes the bucket publicly reachable and changes the cache/consistency
boundary.

## PostgreSQL and Container outbound policy

App, Content, and Jobs use a cache-disabled Hyperdrive configuration for the
qualified request paths. Authentication, authorization, Viewer, Gallery, and
job-state correctness must not depend on query-cache freshness. Migration and
trusted non-browser processing use a direct PostgreSQL connection with explicit
hostname and certificate verification.

Hyperdrive encryption alone, `sslmode=require`, or an observed encrypted socket
does not prove origin identity. The qualified configuration requires
`verify-full` or a subsequently proven equivalent, including a wrong-host or
untrusted-certificate negative test.

Cloudflare Containers allow public internet access by default. Both ShareSlices
Container classes must set deny-by-default outbound policy and allow only their
qualified destinations. Export and verify the required `ContainerProxy`
interception path. HTTP/HTTPS host policy does not cover arbitrary non-HTTP
ports; direct PostgreSQL therefore needs a separately proven permitted path and
must fail closed if the selected policy cannot express it.

The thumbnail Container has no database, R2, Resend, Worker administration, or
general network credential. It receives only a read-only capture capability and
a distinct controller/output capability through the private broker. The trusted
processing Container never runs Artifact-controlled Chromium.

## R2 and deployment state

Use separate private buckets for Artifact objects and the Secret-free
deployment-state mirror. Block public development URLs and custom-domain bucket
exposure. Authorize object access in the Worker, validate paths against the
committed manifest, and use bounded streaming and multipart operations without
buffering a complete accepted upload in isolate memory.

PostgreSQL remains authoritative for leases, fencing, journals, and active and
previous release records. The R2 deployment object is only a conditional mirror.
An ETag/precondition failure, lease loss, or ambiguous write requires
reconciliation from PostgreSQL and current R2 state; the stale fence must not
retry.

## Secrets

Configuration and release bundles contain only logical references and
operator-controlled non-secret revisions. Terraform state must not own Worker
Secret values.

For App and Content:

1. resolve Secrets only inside the authorized credential scope;
2. upload them into a candidate Worker version with the code and bindings;
3. verify the candidate version while it receives no public traffic;
4. deploy the exact verified version;
5. retain the compatible previous version and required key overlap.

For Jobs, version upload is not treated as an equivalent release path. Rotate
Secrets only during a trigger-isolated immediate deployment: pause Queue
delivery, detach schedules, prove no invocation can begin, deploy while
preserving or explicitly supplying every required Secret, verify the exact
deployment, and then reattach triggers. Removing a Jobs Secret binding is a
separately qualified, rollback-aware retirement operation, not an ordinary
rotation step.

Shared signing keys rotate through old-plus-new verification, then new signing,
then old-key removal after the maximum grant and mixed-runtime lifetime.

## Resend

Cloudflare uses the Resend HTTPS API, not SMTP. Production requires a verified
sending domain and a sending-access key scoped to that domain/team. The
configured team namespace, domain, sender, key revision, transport revision,
tracking-disabled state, and account status are pinned into delivery evidence.

Every request uses HTTPS, a required `User-Agent`, and a logical-delivery
`Idempotency-Key`. Resend currently retains idempotency behavior for a bounded
24-hour window; ShareSlices must not infer acceptance after that window or
replay onto another team/domain. Record the accepted provider message ID and
classify validation, authorization, conflict, rate-limit, and provider failures
without logging the key, recipient payload, or message content.

The `resend.dev` sender can validate a disposable prototype only to the Resend
account's own email address. It is not production domain evidence and cannot
send the product's general authentication mail. Provider acceptance is not
inbox delivery.

Before qualification, the operator must record the selected plan's current
message-content storage and retention behavior, applicable quota, and whether
the account supports disabling message-content storage. Resend exposes sent
message metadata and rendered content in its account interface, so local
terminal payload deletion must not be presented as deletion of the provider
copy. If the required provider-side setting or retention fact cannot be
observed, record it as unknown and fail the corresponding privacy/qualification
gate rather than inventing a default.

## Terraform, render, and release

Pinned Terraform owns the declared long-lived R2, Queue, Hyperdrive, and ingress
fields. Pinned Wrangler owns Worker versions, bindings, Durable Object
migrations, Containers, deployments, and the qualified trigger lifecycle.
Neither tool may write a field owned by the other.

Initialize Terraform only with an operator-controlled encrypted, versioned
backend:

```sh
terraform -chdir=deploy/cloudflare/terraform init \
  -backend-config=/operator/private/shareslices-backend.hcl
```

Terraform state is sensitive because provider write-only values may remain in
it. Do not commit or publish state, plans, backend credentials, or temporary
Secret files as ordinary CI artifacts.

Read-only preparation is available:

```sh
mise run deploy -- render --config deployment.json --release release.json
mise run deploy -- plan \
  --config deployment.json \
  --release release.json \
  --operation apply
mise run deploy -- status --config deployment.json
mise run deploy -- verify --config deployment.json --release release.json
```

First installation keeps ingress inactive while private prerequisites and
candidate versions are prepared. Migration completes before jobs/runtimes
advance; App and Content candidates are verified at zero public traffic; Jobs
are changed only while triggers are isolated; public ingress activates last.
Until the Cloudflare mutating Adapter and all gates pass, these commands must not
be interpreted as authorization to assemble that sequence manually.

Status distinguishes desired, handed-off, observed, phase-blocked, partial,
failed, indeterminate, verified, drifted, orphaned, and optional capability
states. Route-free evidence must inspect script settings, schedules, custom
domains, every configured zone's routes, and the script subdomain; disabling
only `workers.dev` is insufficient.

Rollback selects exact retained App and Content versions, the recorded Jobs
deployment identity, bindings, Container images, trigger state, and compatible
configuration. It never runs a down migration or restores a deleted provider
resource. Cloudflare's generic Worker rollback does not roll back external
resources or guarantee ShareSlices cross-component compatibility.

## Emergency trigger and route shutdown

This is a break-glass containment procedure, not normal rollback:

1. record the incident principal, time, active release, current routes, custom
   domains, schedules, Queue consumers, Queue depth, and provider inventory;
2. pause product Queue delivery with the currently qualified Wrangler command
   (`wrangler queues pause-delivery <queue>`); do not purge the Queue;
3. detach Jobs schedules and consumers through their declared owner and verify
   no new invocation starts;
4. remove public Worker routes and custom-domain activation through an
   emergency-reviewed Terraform/owner plan while preserving private Workers,
   R2, PostgreSQL, state, journal, and release evidence;
5. disable unintended `workers.dev` endpoints and verify route-free state across
   every configured zone;
6. wait for or terminate only positively identified in-flight Container work,
   then verify no new instances start;
7. keep delivery paused until the cause, backlog safety, compatible release, and
   reactivation plan are reviewed.

Queue pause does not stop message retention expiry, and a message already in
flight may finish. Purging Queues, deleting buckets/images/Workers, rotating
credentials, or destroying Terraform resources is not authorized by this
procedure.

## Disposable prototype teardown

After a Free-plan or other disposable prototype:

1. detach every prototype route, custom domain, schedule, and Queue consumer;
2. pause delivery, reconcile owned test messages, and delete only positively
   owned disposable Queues when no retention is required;
3. disable prototype `workers.dev` and `r2.dev` exposure;
4. delete only positively owned prototype Worker versions, Container images,
   Hyperdrive configurations, and empty R2 buckets that are not release or
   recovery prerequisites;
5. revoke prototype Cloudflare and Resend credentials and remove local
   temporary Secret files;
6. reread provider inventory, billing/usage, routes, domains, triggers, Queues,
   Workers, Containers, Hyperdrive, and R2;
7. record deletion evidence plus the owner, purpose, encrypted location, and
   expiry for every intentionally retained private prerequisite.

R2 bucket deletion requires the bucket to be empty. Never empty a bucket merely
to make teardown convenient; unresolved ownership or retained recovery evidence
is a stop condition.

## Current official references

Refresh these contracts before implementation acceptance:

- [Workers pricing and Containers entitlement](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers routes and domains](https://developers.cloudflare.com/workers/configuration/routing/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Worker Secrets and version behavior](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Worker rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Container limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Container outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)
- [Queue pause and purge](https://developers.cloudflare.com/queues/configuration/pause-purge/)
- [Hyperdrive API and TLS fields](https://developers.cloudflare.com/api/resources/hyperdrive/)
- [R2 cache and public-domain boundary](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- [Resend API contract](https://resend.com/docs/api-reference/introduction)
- [Resend domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend sent-message data surface](https://resend.com/docs/dashboard/emails/introduction)
- [Resend data-processing retention terms](https://resend.com/legal/dpa)
