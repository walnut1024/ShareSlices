# Deployment Module operations

This runbook describes the repository-owned Deployment Module under `deploy/`.
It documents the implemented command and contract boundary. It does not declare
either production target release-qualified: target readiness remains
evidence-driven, and an unavailable or unqualified capability must fail closed.

## Topology boundary

An installation selects exactly one production target in its deployment
configuration:

- `kubernetes` deploys into an existing conforming cluster and uses
  operator-provided PostgreSQL, private S3-compatible storage, and enterprise
  SMTP. An optional external CDN does not change the target.
- `cloudflare` is the separate Workers, Static Assets, R2, Hyperdrive, Queues,
  Containers, and Resend composition. It is not a Kubernetes add-on.

Docker Compose is only the canonical non-production development and integration
test topology. Its supported interactive lifecycle remains:

```sh
mise run dev
mise run dev-status
mise run dev-logs
mise run dev-down
```

These commands do not produce production qualification evidence. Production
configuration rejects `target: compose`.

Before its first mutation, the local controller verifies the checked Compose
model and the capabilities named by
[`deploy/compose/feature-baseline.json`](../../deploy/compose/feature-baseline.json):
bounded `up --wait` with `--wait-timeout`, long-form healthy and completed
dependency conditions, and machine-readable JSON `ps`. The file records the
currently exercised Compose version; another version is accepted only when
those capability probes and quiet model validation pass. Container state,
health, and host HTTP and SMTP reachability are then verified separately.

## Production command interface

All production commands use one machine-oriented entrypoint:

```sh
mise run deploy -- <command> --config <deployment.json> [options]
```

The accepted commands are `doctor`, `render`, `plan`, `apply`, `status`,
`verify`, and `rollback`. Options are strict `--name value` pairs:

| Command | Required inputs | Purpose |
| --- | --- | --- |
| `doctor` | `--config`; optional `--release` | Read-only prerequisite and capability checks |
| `render` | `--config --release` | Produce the complete Secret-free target bundle and digest |
| `plan` | `--config --release`; optional `--operation apply\|rollback` | Compare desired and observed state without mutation |
| `apply` | `--config --release --plan` | Execute only the exact authorized apply plan |
| `status` | `--config` | Project current control and provider observations |
| `verify` | `--config`; optional `--release` | Run the read-only core verifier |
| `rollback` | `--config --release --plan` | Execute only an exact compatible rollback plan |

`apply` and `rollback` consume a plan whose canonical digest, target, release,
operation, bundle digest, and observed-state revision still match. Generate the
plan first, retain the complete JSON result, review its actions and refusal
reasons, and pass that unchanged result or its contained plan to the mutating
command. A plan is authorization for only its listed actions; it is not a
standing approval for later drift or deletion.

Cloudflare mutating lifecycle support remains unavailable until its
implementation-blocking qualification gates pass. A successful Cloudflare
`render`, read-only `plan`, or `status` is not evidence that `apply`, rollback,
Containers, thumbnail processing, or production email is qualified.

## JSON result and exit categories

Every invocation writes exactly one
`shareslices.deployment-result/v1` JSON object to standard output. Its stable
top-level fields are:

- `command`
- `target`
- `requestedRelease`
- `outcome`
- `reason`
- `data`

Secret values and value-derived fingerprints are forbidden from results,
plans, renders, records, errors, and logs. Automation must use the process exit
category as well as the JSON outcome:

| Exit | Category |
| ---: | --- |
| `0` | Succeeded |
| `2` | Invalid input |
| `3` | Required prerequisite unavailable |
| `4` | Refused by policy or plan |
| `5` | Failed |
| `6` | Indeterminate; reconcile before retry |
| `20` | External reconciler action is required |

An `indeterminate` result is not permission to repeat an external mutation.
Read the durable phase and step checkpoints and use the applicable recovery
procedure. An `external_reconciler_required` result means immutable GitOps
artifacts were handed off; it does not mean the external owner promoted them.

## Gallery readiness verification

Gallery readiness is evaluated independently from core release health. A
release-bound pre-traffic or deep verification observes five live dimensions:
the distinct registrable-site topology, Gallery credentials, governance,
isolated content runtime, and network policy. Every observation must carry a
fresh evidence timestamp and digest; stale, malformed, or unavailable evidence
is indeterminate.

Gallery remains disabled unless all five dimensions pass for the exact target
and release. Core health cannot substitute for a Gallery observation, and one
failed Gallery dimension does not make an otherwise healthy core release
unhealthy when Gallery is optional. Target Adapters collect the real
Kubernetes or Cloudflare observations; the shared projection never infers them
from configuration alone.

## Explicit email deep verification

Ordinary `doctor` and `verify` never send email. To prove one enterprise SMTP
submission or one Resend provider acceptance, an operator must create a
short-lived authorization and a new one-shot receipt path:

```sh
mise run ops-email-deep-authorize -- \
  --config deployment.json \
  --recipient operator-owned@example.com \
  --output /secure/email-probe-authorization.json

SHARESLICES_EMAIL_DEEP_SECRET='<ephemeral SMTP URL or Resend sending key>' \
mise run ops-email-deep-verify -- \
  --config deployment.json \
  --authorization /secure/email-probe-authorization.json \
  --receipt /secure/email-probe-receipt.json
```

The authorization binds the installation, target, Adapter, recipient,
configuration digest, nonce, and a maximum 15-minute window. For Resend, the
configured operator evidence must still prove the exact team/domain/key
revision, verified domain, disabled tracking, healthy team-shared rate and
bounce/spam posture, unsuspended account, and same-team/domain rotation scope.
The runtime sending key is not permitted to substitute for those administrative
facts.

The receipt path must not exist before the command. It is claimed with
owner-only permissions before the provider call; an existing, interrupted, or
indeterminate receipt forbids another automatic attempt. The receipt contains a
recipient digest and optional provider message ID, never the recipient, message
body, or Secret. Store the authorization as sensitive operational evidence,
because it contains the test recipient, and remove it after the receipt and
provider/dashboard evidence have been retained under the deployment evidence
policy. Provider acceptance proves submission only, not inbox delivery.

For Resend, `provider_accepted` additionally requires a non-empty provider
message ID and a future provider-safe replay cutoff derived from the frozen
logical-delivery idempotency window. A missing, expired, or malformed cutoff is
recorded as indeterminate. SMTP uses the same exclusive receipt as its durable
one-shot boundary because SMTP has no equivalent provider idempotency key.
Neither probe depends on API readiness; the short-lived executor invokes the
configured transport directly.

## Product deep smoke

The stateful product smoke is forbidden in core and pre-traffic verification.
An Adapter may run it only with isolated deep authorization bound to one target,
release, operation, positive fencing token, nonce, Gallery expectation, and an
exact set of positively owned test resources.

The smoke runs Upload, processing, Preview, Publish, Viewer, Unpublish, and
Gallery eligibility or fail-closed verification in that order. Every step must
return a redacted evidence digest before the next begins. Gallery's expected
result is authorized explicitly; a disabled installation must prove
fail-closed behavior rather than silently skipping the step.

Cleanup runs after success or failure and must account for exactly every
authorized resource. Missing, duplicate, incomplete, or indeterminate cleanup
blocks the result. Evidence records step digests and resource counts, never
Artifact identifiers, Publication identifiers, content, credentials, or raw
provider diagnostics.

## Viewer cache deep verification

Viewer cache and current-state transitions are forbidden in core verification.
An Adapter may run them only with isolated deep authorization bound to one
delivery mode, release, operation, positive fencing token, nonce, and exact
positively owned Viewer fixtures.

The same contract applies to Kubernetes direct ingress, Kubernetes external
CDN, Cloudflare `web-assets-only`, and Cloudflare
`web-and-public-viewer-bytes`. It verifies full-body internal-cache behavior,
Range/`206` bypass, and a prior cache hit followed by Unpublish, expiry,
replacement, or restriction. Only the last Cloudflare mode expects an internal
Viewer-byte cache; every mode must preserve current authorization and outward
`no-store` behavior.

Cleanup runs after success or failure and must account for every authorized
fixture exactly. Evidence records the delivery mode, stable check names, and
digests without retaining Artifact, Publication, object, or provider
identifiers.

## Processing failure drills

Duplicate-wake, lost-wake, Container-termination, stale-fence, and follow-on-work
probes are forbidden in core verification. A target Adapter may invoke the
shared processing failure-drill contract only from an isolated pre-traffic or
deep release drill with an exact release, operation, positive fencing token,
nonce, and list of positively owned probe resources.

Every probe must return durable evidence before the next begins. Cleanup runs
after both success and failure and must account for every authorized probe
resource. Missing or indeterminate cleanup overrides a passing probe result and
blocks activation. Drill output records evidence digests and resource counts,
not job payloads, object keys, credentials, or raw provider diagnostics.

## Deployment drift drills

Deployment drift injection is forbidden in core verification and against a
serving production release. A target Adapter may invoke the shared drift-drill
contract only with isolated deep authorization bound to one release, operation,
positive fencing token, nonce, and a positively owned fixture set for every
target dimension.

Kubernetes acceptance injects and detects resource, configuration-digest, and
deployment-record drift. Cloudflare acceptance injects and detects Worker
version, route, binding, configuration-digest, and deployment-record drift.
Every dimension starts from a clean observed baseline, is restored immediately
after its observation, and is observed clean again before the next dimension.
An indeterminate injection, missing detection, incomplete restoration, or
unverified clean state blocks the drill. Restoration ambiguity overrides an
otherwise useful detection result.

The shared runner records stable dimensions and reason codes without resource
identifiers or provider diagnostics. Concrete target Adapters own the live
provider mutations and must retain their redacted evidence during representative
pre-traffic acceptance; the shared contract alone is not evidence that either
provider drill ran.

## Deployment telemetry contract

Deployment telemetry uses one redacted record shape across Compose, Kubernetes,
and Cloudflare. Stable events cover operation lease/fence and phase, migration
head, job backlog and leases, Queue/DLQ, trigger delay, Container startup and
runtime, database connections, R2 usage, SMTP, Kubernetes readiness,
provider-limit headroom, cost risk, and Resend health.

Each event accepts only its exact scalar attribute set and numeric alert
thresholds that name a numeric attribute. Nested provider diagnostics and
undeclared attributes are rejected. A Resend quota or account-health
classification may be non-unknown only when its source is a provider response
or fresh operator evidence; without either, emit `unknown` rather than
replaying historical plan or dashboard facts.

The production `status` command collects these observations into a separate
telemetry bundle alongside deployment status. Target and runtime Adapters
register every event applicable to their target; collection refuses before
observation when one is missing and fails indeterminate if an observer throws.
Compose requires operation, migration, jobs, database, SMTP, and cost risk.
Kubernetes additionally requires Kubernetes readiness and provider-limit
headroom. Cloudflare requires Queue/DLQ, trigger, Container, R2, Resend,
provider-limit, and cost-risk observations in addition to shared state.

Current status projection supplies deployment operation/fence, latest phase,
migration head, job and database aggregates, Kubernetes Pod readiness,
Cloudflare Queue/DLQ backlog and trigger delay, R2 and Container Analytics, and
SMTP/Resend evidence from their authoritative sources. Missing or unavailable
data is represented by a present attribute with a `null` value and `unknown`
state; it is never converted to an observed zero. Provider-limit headroom is
known only when current provider or operator limit evidence exists. Cost risk
remains `unknown` until pricing and allowance evidence can qualify an estimate;
raw resource usage is not mislabeled as a bill.

The direct PostgreSQL observer now aggregates queued work and active leases
across every current processing, thumbnail, Gallery, authentication-email, and
Cloudflare dispatch job table. It reports job telemetry only when the complete
expected table set exists. It also reads current-database connection usage and
the server connection limit; the shared projection emits warning at 80 percent
and critical at 90 percent of that observed limit.

For Kubernetes and Compose SMTP, the PostgreSQL observer reads only the latest
transport Adapter and stable delivery-result classification. It emits accepted,
pending, unresolved, no-delivery, or unavailable state without recipient,
message, endpoint, or provider diagnostic data. When an older schema lacks the
transport column, SMTP telemetry is `unknown` and status observation continues.

Cloudflare scheduled-invocation delay is measured from the durable
`started_at - scheduled_time` record. No default warning threshold is inferred:
Cloudflare documents trigger-configuration propagation, but does not publish a
single-invocation delay SLA. Operators must supply any product alert threshold
separately.

Cloudflare R2 telemetry queries the official GraphQL Analytics operations and
storage datasets for the configured private Artifact and deployment-state
buckets over a bounded window. It records aggregate requests and current
payload-plus-metadata bytes. Missing Analytics permission, dataset
unavailability, GraphQL errors, or malformed aggregates produce `unknown`
without exposing provider diagnostics.

Cloudflare Container telemetry first resolves the two exact configured
ShareSlices Container application IDs through Wrangler. It then queries
`containersMetricsAdaptiveGroups` and `containersUsageAdaptiveGroups` for only
those IDs. Runtime uses documented Container uptime, while CPU seconds, memory
byte-seconds, disk byte-seconds, and transmitted bytes retain their documented
units. The official datasets do not expose startup duration, so
`container.startup_ms` remains `null` and the event remains `unknown` even when
runtime usage was observed. Failure to establish exact application identity
skips the Container query rather than aggregating unrelated account workloads;
the independent R2 query still runs.

Cloudflare status projects only the Resend classification, evidence source,
age, maximum age, and stable reason. Fresh operator evidence may report healthy
or unhealthy. Missing, future-dated, or stale evidence is normalized to
explicit `unknown`; team, domain, key, sender, and dashboard details are not
copied into telemetry.

## Configuration and release inputs

The versioned deployment schema is
[`deploy/contract/deployment.schema.json`](../../deploy/contract/deployment.schema.json).
It accepts exactly one production target, public origins, logical Secret
references, non-secret Secret revisions, target prerequisites, bounded cost and
runtime controls, and target-specific email configuration. It rejects embedded
Secrets, mixed target fields, Compose, and the wrong email Adapter.

The immutable release schema is
[`deploy/contract/release.schema.json`](../../deploy/contract/release.schema.json).
A release records:

- immutable artifact content digests and qualified provider identities;
- the migration list, checksums, head, and N/N-1 compatibility evidence;
- configuration and shared contract revisions;
- non-secret Secret revisions;
- inventory and ownership markers;
- the pinned provider toolchain and verification-contract evidence.

Mutable image tags or reused release tags are not acceptable provider identity.
When a provider exposes only a release tag, qualification must bind that
never-reused tag to the recorded content digest.

## Secret resolution

Configuration and releases contain logical references and non-secret revisions,
never values. Production execution currently resolves supported file-backed
references below the absolute directory named by
`SHARESLICES_SECRET_ROOT`. Resolution occurs only at the last responsible
consumer boundary.

The reference path must remain within that root. Do not print resolved values,
place them in a rendered bundle, commit them under `deploy/`, or store them in
deployment records. A revision change must roll only the consumers that use the
Secret. Shared signing-key rotation follows old-plus-new verification, then new
signing, then old-key retirement after the maximum mixed-runtime and grant
lifetime.

## Operation authority, fencing, and recovery

Mutating production commands require an authenticated operator principal in
`SHARESLICES_DEPLOYMENT_PRINCIPAL`. The principal is recorded with the durable
operation and must represent the real automation or operator identity.

PostgreSQL owns deployment authority. Before provider mutation, the Module:

1. bootstraps only the checksum-authorized control schema transition on first
   installation;
2. acquires an expiring operation lease;
3. advances a monotonically increasing fencing token;
4. re-observes the plan revision;
5. heartbeats and revalidates the lease before later mutations;
6. records phase and bounded, Secret-free step checkpoints.

A stale owner or fence cannot write a checkpoint, release record, probe, or
completion. Completed idempotent steps may be resumed from their evidence.
Interrupted external mutations remain indeterminate until an authoritative
provider observation proves their outcome. Never delete the control journal to
force a retry.

PostgreSQL is also authoritative for the active and previous release records.
The Cloudflare R2 release-state object is a Secret-free conditional mirror; it
cannot grant or extend a lease. ETag/precondition failure, lease loss, or an
ambiguous mirror write requires reconciliation from PostgreSQL and current R2
state, not retry by the old fence.

## Inventory, retirement, and rollback

Every managed resource has one declared owner and positive installation,
release, and provider identity. Active and rollback releases are retained.
Ordinary retirement:

1. removes traffic and scheduled entry first;
2. verifies inactivity;
3. excludes active and rollback inventory;
4. deletes only positively owned eligible resources.

Unowned, ambiguously owned, durable prerequisite, or destructive infrastructure
changes are refused and require a separately reviewed procedure. Rollback
restores only recorded compatible application artifacts. It never runs a down
migration, rewinds PostgreSQL or object data, or promises recovery of a provider
version or image that no longer exists.

## Separate maintenance authorization

One-shot maintenance is not hidden inside ordinary apply. The currently exposed
authentication-email reconciliation command is:

```sh
mise run ops-authentication-email-reconcile
```

It requires a signed, short-lived, single-use operator authorization envelope
and the documented maintenance verification material. It serializes against the
delivery lease and relevant authentication state; it is not a general resend
command. Local failed-thumbnail requeue is a non-production Compose operation
and does not authorize production mutation.

Future destructive recovery, Jobs Secret-binding retirement, or other
maintenance operations must receive their own explicit command, authenticated
principal, signed authorization where specified, audit evidence, and
positive-resource scope. They must not be implemented as an undocumented
`apply` option.

## Ownership boundaries

- `deploy/contract/` owns versioned machine contracts and non-secret fixtures.
- `deploy/automation/` owns target-neutral command, plan, fencing, lifecycle,
  verification, and result policy.
- `deploy/kubernetes/` and `deploy/cloudflare/` own target composition and
  provider Adapters.
- `deploy/compose/` and `deploy/automation/local-compose/` own the
  non-production topology and its lifecycle policy.
- PostgreSQL owns operation authority, journals, and release records.
- The configured immutable release store owns release bundles.
- The operator owns credentials, external services, recoverability evidence,
  and approval of security-sensitive or destructive actions.
- CI and GitOps workflows are thin callers. They do not own deployment policy
  and must not reimplement phase ordering.

For the complete contract inventory, see
[`deploy/contract/README.md`](../../deploy/contract/README.md). Current and
target module status is recorded in
[`docs/design/modules.md`](../design/modules.md).
