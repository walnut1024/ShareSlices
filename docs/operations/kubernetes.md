# Kubernetes target

This runbook operates ShareSlices in an existing conforming Kubernetes cluster.
The Deployment Module does not create the cluster, nodes, network, ingress
controller, PostgreSQL, object storage, enterprise SMTP relay, registry, or
optional external CDN.

The Kubernetes implementation is present, but release support remains gated on
representative real-cluster qualification and deep verification. A successful
render, server-side dry-run, or local test does not by itself qualify a cluster.

## Prerequisites

Prepare and record:

- a configured `kubectl` context and namespace;
- a cluster version at or above the configured minimum;
- the required core APIs, Ingress class, and controller;
- an enforced NetworkPolicy implementation with current cluster-specific
  allow-and-deny evidence;
- external PostgreSQL with hostname and certificate verification;
- private S3-compatible object storage over verified HTTPS;
- an enterprise SMTP relay with the declared TLS policy;
- an immutable OCI registry and digest-pull credentials;
- application and content TLS Secrets;
- an immutable release store and current recovery evidence;
- sufficient database connection and workload resource budgets.

The deployment principal needs the exact read and mutation permissions reported
by `doctor`. Do not grant cluster-admin merely to bypass a failed permission
check.

Configuration identifies the cluster by context, namespace, minimum version,
field manager, and NetworkPolicy evidence. The recorded CNI cluster identity
must match the live cluster and the evidence must remain within its declared
maximum age.

## Secrets

Create the role-specific Kubernetes Secrets before planning. The Module checks
their names and required keys without returning values. Required identities
include:

- API, maintenance, content, resident Worker, and migration role Secrets;
- registry `.dockerconfigjson`;
- application and content TLS `tls.crt` and `tls.key`;
- maintenance `AUTH_EMAIL_SMTP_URL`.

Deployment configuration contains only logical Secret references and non-secret
revisions. Revision changes are projected onto only the consuming Pod
templates. Never place Secret values in the release, rendered target bundle,
plan, GitOps artifact, deployment record, or command output.

## Enforce external egress

Standard NetworkPolicy does not safely express arbitrary changing external
hostnames. Select one configured mechanism:

- `stable-cidrs` declares exact PostgreSQL, object-storage, and SMTP CIDRs;
- `egress-gateway` routes external traffic through the configured, separately
  controlled gateway;
- `cni-fqdn-policy` uses the checked CNI API, kind, qualification revision, and
  exact PostgreSQL, object-storage, and SMTP hostnames.

The renderer creates default-deny policy and role-specific allows. API,
maintenance, migration, content, and resident processing receive only their
required dependency paths. DNS and ingress-controller paths are selected by
their configured namespace and labels.

`doctor` confirms that the declared APIs and evidence exist; it does not prove
packet enforcement. Before traffic activation, the isolated network probe phase
server-side applies positively owned probes and proves both required allows and
forbidden flows on the actual cluster. Failed, stale, or unavailable enforcement
blocks activation. Do not weaken policy or substitute a DNS lookup for this
test.

## Enterprise SMTP

The Kubernetes target uses the shared durable authentication-email dispatcher
with the SMTP Adapter in the maintenance workload. Configuration freezes a
non-secret:

- relay namespace;
- endpoint identity;
- sender identity;
- transport configuration revision;
- TLS policy;
- credential reference and revision.

Email is never sent inline by the API. `doctor` validates the Secret key,
endpoint DNS, declared TLS policy, and non-secret transport contract without
issuing `MAIL FROM` or sending a message. SMTP readiness remains separate from
API readiness.

Actual envelope and complete `DATA` acceptance requires explicitly authorized
deep verification with a test recipient. SMTP has no general idempotency
contract: a failure proven before submission may follow bounded retry, but loss
of the final response after complete submission is acceptance-indeterminate and
must enter signed manual reconciliation without automatic resend.

An attempted delivery remains pinned to its original relay namespace, endpoint,
sender, local Message-ID, serializer, and payload. Do not rotate it onto a
different or unproven relay authority.

## Build, inspect, and plan

Build and publish immutable Kubernetes role images through the checked task:

```sh
mise run kubernetes-build-images
```

The release must record each image content digest and the registry must support
pull by that digest. Then run:

```sh
mise run deploy -- doctor --config deployment.json --release release.json
mise run deploy -- render --config deployment.json --release release.json
mise run deploy -- plan \
  --config deployment.json \
  --release release.json \
  --operation apply
```

`render` produces ordered Secret-free phases. `plan` performs server-side apply
dry-run for every non-empty phase using the configured field manager. Admission,
validation, or field-ownership conflicts are blockers; do not use
`--force-conflicts` or client-side dry-run as a substitute.

Review the plan's observed-state revision, first-install control-schema action,
security-sensitive changes, replacements, refusals, retirement actions, and
bundle digest. Preserve the exact JSON plan used for authorization.

## Direct reconciliation

Direct mode declares:

```json
{
  "reconciliation": {
    "mode": "direct",
    "owner": "deployment-module"
  }
}
```

Set:

```sh
export SHARESLICES_SECRET_ROOT=/absolute/operator/secret-root
export SHARESLICES_DEPLOYMENT_PRINCIPAL=deployment-operator@example.test
```

Apply only the reviewed plan:

```sh
mise run deploy -- apply \
  --config deployment.json \
  --release release.json \
  --plan authorized-plan.json
```

The Module verifies the plan and bundle digests, bootstraps only the authorized
first-install control schema, acquires the PostgreSQL lease and fence,
re-observes state, and then applies ordered phases with server-side apply. The
one-shot migration Job completes before runtime rollout. Application Pods never
run migration as an init container.

Each phase is journaled. A completed migration is not repeated on resume.
Lease loss stops later writes. An ambiguous external mutation remains
indeterminate until observation reconciles it; do not generate a new plan merely
to overwrite the journal.

Public ingress is activated only after migration, admitted runtime security,
network probes, workload readiness, and pre-traffic verification pass.

## GitOps handoff

GitOps mode declares the configured external reconciliation owner. The
Deployment Module still renders and validates the immutable ordered phase
bundles, but it does not compete with the external writer.

An apply returns exit code `20` and
`outcome: external_reconciler_required` when a phase requires promotion. Supply
the exact phase artifact and digest to the declared reconciler. After that owner
applies it, rerun status or the approved continuation so the Module can observe
the expected resources and continue.

Do not collapse migration, runtime, and public-ingress phases into one
unobserved sync wave. The migration must be observed complete before compatible
runtime promotion, and public ingress remains last. GitOps rollback likewise
hands off the compatible previous runtime and ingress resources; it never emits
or reruns a prior migration Job.

## Status and verification

Inspect current state:

```sh
mise run deploy -- status --config deployment.json
mise run deploy -- verify --config deployment.json --release release.json
```

Status derives from live Kubernetes resources plus the PostgreSQL control
journal and release records. Distinguish desired, handed-off, observed,
phase-blocked, partial, failed, indeterminate, verified, drifted, and orphaned
states. A desired or handed-off resource is not observed completion.

Core verification is credential-free and read-only. It checks the configured
Web, API, Viewer, content, origin, and edge addresses for route ownership,
statuses, redirects, request IDs, Cookies, CORS, security and cache headers, and
private-storage non-exposure. External-CDN mode additionally requires exact
edge-versus-origin evidence parity; see
[Kubernetes external CDN](external-cdn.md).

Release qualification additionally requires explicitly authorized isolated
deep verification for stateful Upload, processing, Preview, Publish, Viewer,
Unpublish, email, Gallery eligibility, failure recovery, and cleanup. It also
requires the real-cluster network and admitted Pod-security probes. Retain only
redacted evidence, and clean only positively owned test state.

## Recoverability evidence

Before release qualification, record current operator-owned evidence for:

- PostgreSQL backup and restore;
- private object-storage inventory and restore;
- deployment-control journal backup;
- immutable release bundle and registry availability;
- the shared database/object/recovery-manifest consistency marker;
- owners, encrypted locations, retention, evidence age, RPO, and RTO.

Run restore drills in an isolated environment and in dependency order. A
database/object marker mismatch must fail closed. Application rollback is not
disaster recovery and cannot restore deleted data, objects, registry content, or
deployment state.

## Compatible rollback

Generate a rollback plan for the recorded previous release:

```sh
mise run deploy -- plan \
  --config deployment.json \
  --release previous-release.json \
  --operation rollback

mise run deploy -- rollback \
  --config deployment.json \
  --release previous-release.json \
  --plan authorized-rollback-plan.json
```

Rollback is permitted only when the active database schema and shared job,
object-layout, configuration, Secret-reference, ingress, and durable-resource
contracts remain compatible with the previous release. It restores recorded
application artifacts and verifies them; it never runs a down migration.

The target refuses a missing or mismatched previous release record, changed
configuration digest, unavailable image, unsafe schema prefix, field-ownership
conflict, or destructive prerequisite action. In external-CDN mode, coordinate
edge traffic through the separately authorized provider procedure without
changing the target.

## Retirement and emergency response

Retirement excludes active and rollback release markers, detaches ingress and
scheduled entry first, proves inactivity, and removes only exactly observed
resources whose installation, owner, release, and digest markers match.
Unknown, durable, or ambiguously owned resources are reported rather than
deleted.

For an emergency:

1. preserve the current plan, journal, fence, and provider observations;
2. stop new public traffic or scheduled entry through the narrowest authorized
   target action;
3. keep PostgreSQL and object state intact;
4. reconcile in-flight migration and processing state;
5. choose compatible rollback, forward fix, or disaster recovery from evidence.

Never run global Kubernetes deletion, remove the namespace to clear drift, edit
the control tables by hand, or deploy mutable image tags.
