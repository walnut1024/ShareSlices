# Deployment recovery

This runbook recovers the Deployment Module after interrupted or failed
operations. It does not turn an uncertain side effect into permission to retry,
and it does not authorize destructive provider or data operations.

Keep these boundaries distinct:

- **deployment recovery** reconciles a journaled operation with observed target
  state and resumes only proven idempotent work;
- **compatible rollback** restores recorded application artifacts without a
  down migration or data rewind;
- **disaster recovery** restores PostgreSQL, objects, state, bundles, and
  journals from one verified consistency cut under separate authorization.

Begin every incident by preserving the exact configuration, release, authorized
plan, result JSON, operator principal, operation ID, lease/fence, phase journal,
provider inventory, logs, and target observations. Redact Secret values and
sensitive payloads. Do not delete the journal, acquire a new operation merely to
hide the old one, or allow two reconcilers to write the same target.

## Safe first response

1. Stop new release automation and identify the declared reconciliation owner.
2. If new background work could worsen the incident, isolate its trigger using
   the target runbook. On Cloudflare, pause Queue delivery and detach schedules;
   on Kubernetes, suspend only the positively identified controller or workload
   through an authorized operational action.
3. Run read-only observation:

   ```sh
   mise run deploy -- status --config deployment.json
   mise run deploy -- verify --config deployment.json --release release.json
   ```

4. Compare PostgreSQL's authoritative operation and release records with the
   target, immutable release bundle, and any target-specific mirror.
5. Classify each step as confirmed complete, confirmed not started, in flight,
   indeterminate, or externally handed off. Never infer completion from desired
   configuration alone.

## Lease loss or stale fence

A process that loses its lease or sees a newer fencing token must stop before
its next mutation. Lease expiry alone does not prove that its last external call
failed or became quiescent.

1. Preserve the stale process's last heartbeat, fence, phase, step, request
   identity, and response evidence.
2. Terminate or isolate that writer and verify it cannot issue later calls.
3. Observe the provider using stable resource identities and idempotency tokens.
4. Reconcile any indeterminate step into a durable confirmed outcome. If the
   provider cannot establish the result, keep the operation indeterminate and
   escalate; do not repeat the call.
5. Only after quiescence and authoritative reconciliation may a successor
   acquire a newer fence and resume confirmed pending work.

The Cloudflare R2 release-state object cannot grant or extend a lease. Rebuild
that conditional mirror only from PostgreSQL after comparing its ETag and
content; the stale fence never retries a failed precondition or ambiguous write.

## Interrupted release

Resume from confirmed phase and step checkpoints, not from the beginning:

1. verify the authorized plan digest, bundle digest, observed-state revision,
   target, release, and operation still match;
2. re-observe drift and every external handoff;
3. preserve confirmed migrations and provider mutations;
4. rerun only locally idempotent checks or a step whose provider result is
   proven absent;
5. keep public traffic and background triggers disabled until pre-traffic and
   release verification pass.

For GitOps, `external_reconciler_required` means the declared owner must apply
the exact handed-off phase. It is not a failure to bypass with direct apply.
Observe the expected digest and resources before advancing.

If App, Content, Jobs, Containers, ingress, or configuration are split across
releases, report a partial or indeterminate state. Do not activate traffic and
do not describe the newest component as the active release.

## Failed or partially applied migration

One-shot migration is serialized and journaled separately from runtime rollout.
Application Pods never own migration authority.

1. stop runtime promotion and preserve the migration Job/execution, checksum,
   expected and observed schema head, database transaction evidence, logs, and
   journal checkpoint;
2. determine whether each migration file committed using database state and its
   checked checksum, not process exit alone;
3. if no transaction began or the transaction is proven rolled back, a newer
   fenced owner may resume the same immutable migration prefix;
4. if a migration committed, mark that file complete and never rerun it;
5. if commit status is ambiguous, block both resume and rollback until database
   evidence resolves it;
6. if the resulting schema is incompatible with both candidate and previous
   runtimes, keep public traffic stopped and escalate to a separately reviewed
   forward repair or disaster recovery.

Never run a down migration during ordinary recovery or rollback. Do not restore
an old database snapshot beneath newer object or journal state.

## Drift

Drift is a difference between recorded desired/owned state and current
observation.

1. identify the exact resource, field owner, previous observation, and current
   value;
2. determine whether the change is an authorized external reconciliation,
   emergency containment, provider normalization, or unknown mutation;
3. import or accept a pre-existing resource only through a separately reviewed
   ownership decision;
4. generate a new plan only after resolving the current operation and updating
   its observed-state basis;
5. refuse security-sensitive replacement, ambiguous adoption, unowned deletion,
   or force-conflict behavior.

Do not make the renderer match accidental drift. Correct desired configuration
only when the drift represents an approved durable change.

## Orphan retirement

An orphan is reported for review; it is not automatic deletion authority.

1. prove installation, target, owner, release, provider identity, and content
   digest from both inventory and live metadata;
2. exclude active and previous rollback releases, durable prerequisites,
   recovery evidence, and in-flight verification resources;
3. detach route, ingress, consumer, and schedule entry first;
4. observe inactivity and wait the applicable in-flight and retention window;
5. delete only the positively owned eligible resource;
6. reread provider inventory and record the final outcome.

Unknown, ambiguously owned, or still reachable resources remain visible as
orphans. Never empty a bucket, purge a Queue, delete a Container image, or remove
a Worker version merely to clear status.

## Secret rotation failure

First decide whether the new value was staged, activated, partially observed, or
revoked externally. Never print either value while diagnosing.

For Kubernetes:

- keep the stable external Secret name and compare only declared revisions;
- roll only consuming workloads;
- retain old-plus-new verification for shared signing keys, switch signing to
  new, then remove old only after the maximum mixed-runtime and grant lifetime;
- if rollout fails, keep or restore the prior compatible reference/revision
  without restoring a revoked credential.

For Cloudflare App and Content:

- do not route traffic to an unverified candidate version;
- if staging fails, discard only the positively owned candidate;
- if activation partially succeeds, restore the exact compatible recorded
  version only after observing bindings and external credential validity.

For Cloudflare Jobs:

- keep Queue delivery paused and schedules detached;
- observe the immediate deployment identity and every required binding;
- do not delete a binding through ordinary rotation;
- retire a binding only through the separately qualified rollback-aware
  procedure after retained releases no longer require it.

A revoked external credential is outside rollback guarantees. Replace it under a
new reviewed rotation; do not pretend the release can resurrect it.

## Queue backlog or Container failure

Pause Cloudflare Queue delivery when consumers are unhealthy or work would
amplify damage. Pausing does not cancel in-flight messages, stop expiry, or prove
quiescence. Do not purge production messages.

Record backlog count/bytes, oldest age, retention deadline, delayed and
dead-letter work, active invocations, attempt/fence identities, and downstream
capacity. Restore a verified consumer at bounded batch size, retry count, and
concurrency. Resume gradually while watching database, R2, Resend, and Container
load. Reconcile terminal/dead-letter items through their product-owned workflow.

For a failed trusted processing or thumbnail Container:

1. prevent new claims and fence the affected operation;
2. identify each stable instance/slot and whether its claim committed a database
   or object side effect;
3. preserve logs and private broker evidence without exposing Artifact content;
4. terminate only the positively identified failed instance after its state is
   reconciled;
5. verify the retained image and isolation policy before replacement;
6. requeue only work whose prior claim is proven terminal or absent.

Do not reuse a finalized release-verification instance. An unconfirmed
quiescence or cleanup result remains an isolated, non-public orphan and blocks
activation.

## SMTP or Resend degradation

Email degradation is separate from API readiness. Keep durable encrypted
deliveries in their existing provider namespace and retain the configured
circuit breaker, bounded attempts, and retry limits.

For SMTP:

- a failure proven before submission may follow bounded retry;
- after complete `DATA` submission, loss of the final response is
  acceptance-indeterminate and must not be resent automatically.

For Resend:

- retry only the same byte-equivalent payload, team/domain/sender, and
  idempotency key before the delivery's frozen safe-replay cutoff;
- provider rate-limit, quota, authorization, domain, and policy errors remain
  distinct;
- at or after the cutoff, an unresolved attempt must not be sent with either a
  reused or new key.

Never rotate an attempted delivery to a different SMTP relay authority, Resend
team, sender, domain, or Adapter. Provider acceptance still does not mean inbox
delivery.

### Manual delivery reconciliation

Use the separately authorized command:

```sh
mise run ops-authentication-email-reconcile
```

The operator must supply the signed, short-lived, single-use authorization and
the documented evidence proving accepted, rejected, or unresolved outcome. The
command serializes against the delivery lease and authentication state. It is
not a general resend tool and does not extend or recreate an authentication
code/reset grant.

Record `provider_accepted` plus the provider identifier only when acceptance is
proven. Record `provider_rejected` only when rejection is proven. Otherwise
record `acceptance_unresolved`. Terminal local payload deletion does not assert
that SMTP recipients or Resend deleted provider-side copies.

## Incompatible rollback

Rollback must refuse when the current schema, job contract, object layout,
configuration, Secret references, ingress, durable resources, or retained
artifacts are incompatible with the previous release.

Do not bypass the refusal by manually selecting old images, a generic Worker
rollback, or an old Kubernetes ReplicaSet. Choose one of:

- a forward fix compatible with the current durable state;
- containment with traffic/triggers disabled while evidence is gathered;
- separately authorized disaster recovery to a verified consistency cut.

Rollback never runs a down migration, restores deleted provider prerequisites,
or promises that revoked credentials and expired provider versions still exist.

## Lost deployment state

PostgreSQL is authoritative for the operation journal and active/previous
release records. Target ConfigMaps or R2 objects are Secret-free mirrors.

If only a mirror is lost, reconstruct it from PostgreSQL after verifying the
target inventory and current fence. If Terraform/IaC state is lost, restore the
latest encrypted state version, run a refresh-only comparison, and import
pre-existing resources only after exact identity and ownership review.

If PostgreSQL's deployment-control state is lost or cannot be tied to the live
target, stop all mutation. Restore the deployment journal, immutable release
bundle, and IaC state from the same accepted recovery set, then compare every
resource and release identity. A live target alone is insufficient to recreate
lease history or authorize adoption.

## Database/object restore mismatch

A disaster-recovery set must contain the same
`shareslices.recovery-marker/v1` identity in:

- PostgreSQL;
- private S3/R2 object storage;
- the encrypted recovery manifest.

The marker binds installation ID, database revision, object inventory revision,
creation time, and deterministic cut ID. Missing, malformed, digest-invalid, or
different copies fail closed.

Restore in an isolated environment:

1. restore PostgreSQL to the recorded database revision;
2. restore objects to the recorded inventory revision;
3. restore the recovery manifest, deployment journal, IaC state, and immutable
   release bundles retained for that cut;
4. compare all three marker copies and their cut ID;
5. verify schema head, object manifest/layout, release identities, ownership,
   private storage, authentication, and representative product workflows;
6. only then prepare a separately authorized traffic cutover.

Do not mix a newer database with older objects, a newer object inventory with an
older database, or a release/journal from another cut. A marker mismatch is not
repairable by editing one copy to match another.

## Closeout

Before resuming normal operation, ensure:

- one writer and one current fence remain;
- every interrupted step has a durable observed outcome;
- migration and release heads match the verified runtime;
- Queue/schedule/ingress state is intentional;
- no unknown public route or private orphan is hidden;
- Secret revisions and external credential validity are recorded;
- recovery evidence remains current;
- core and authorized deep verification pass;
- temporary incident access and test resources are removed;
- all services intentionally started for recovery testing are stopped.
