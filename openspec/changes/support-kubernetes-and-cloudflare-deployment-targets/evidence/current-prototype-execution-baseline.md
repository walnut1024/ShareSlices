# Current prototype execution baseline

## Purpose

This evidence records which deployment experiments the current operator accounts can support without implying that the Cloudflare production target is qualified. It contains no credential values, provider tokens, database passwords, billing identifiers, or reusable resource addresses.

The table below is the 2026-07-21 non-mutating account and CLI snapshot. It is
historical execution evidence, not a cache of current provider state. Mutable
provider state must be checked again before each live prototype and before
release qualification; a failed refresh makes the affected dependency
`unknown` and forbids automatic resource selection.

## 2026-07-21 account evidence

| Dependency | Current observation | Work allowed now | Work that remains blocked |
| --- | --- | --- | --- |
| Cloudflare authentication | Wrangler 4.112.0 is authenticated to the intended account | Read-only discovery and disposable Free-compatible Worker interface prototypes | Authentication alone does not prove plan entitlement, quota headroom, production routing, or target qualification |
| Cloudflare entitlements | Billing evidence shows an active R2 subscription but no Workers Paid subscription; Worker execution therefore remains on Workers Free | Workers Free-compatible Static Assets, Worker, R2, Queue, Hyperdrive, and control-plane prototypes within observed limits and the separately metered R2 subscription | Cloudflare Containers, trusted processing, thumbnail isolation, Container rollout and rollback, and full Cloudflare acceptance; R2 enablement does not upgrade Workers |
| Cloudflare hostname | The account has a `workers.dev` subdomain | Disposable route prototypes that are removed after evidence collection | Production ingress, the separate trusted/content registrable-site boundary, Gallery eligibility, and custom-domain qualification |
| R2 | R2 is enabled and prior disposable bucket operations succeeded | Private R2 binding, streaming, multipart, range, and object-contract prototypes | R2 availability does not qualify the complete target or permit public bucket exposure |
| PostgreSQL | Supabase CLI can see one active Free project; this repository is not linked to it. The retained private Hyperdrive is cache-disabled with origin connection limit `5` and was restored to TLS `require` after an incomplete `verify-full` runtime attempt. Both private prerequisites are operator-owned, retained only for the next bounded database prototype, and due for removal review before final change handoff. | Explicitly configured, disposable database and Hyperdrive compatibility probes that use operator-supplied references | Automatic project selection, production durability, backup and recovery claims, uninterrupted availability, or production TLS identity; Free projects may pause after low activity, and task 5.3 still requires the Dashboard-provided project CA plus a passing Worker-runtime `verify-full` positive case |
| Resend | A key is available to the opt-in verifier, and the recorded `resend.dev` run proved accepted HTTPS submission and idempotent replay to an allowed test recipient | API-shape, error classification, quota-header, idempotency, replay-cutoff, redaction, and Resend-documented simulation-address tests; an actual `resend.dev` send is restricted to the Resend account's own email address | Task 1.9, arbitrary recipients, verified-domain sending, disabled-tracking proof, same-domain key rotation, deliverability, and inbox-delivery claims |
| Owned domains | No operator-owned Cloudflare zones or verified Resend sending domain are recorded for this change | `workers.dev` and `resend.dev` prototype work only | Production custom domains, distinct-site acceptance, Resend production qualification, and full Cloudflare staging acceptance |

## Latest read-only refresh

On 2026-07-22, Wrangler 4.112.0 still authenticated successfully to the intended
Cloudflare account, and the R2 bucket-list operation completed without listing a
bucket. That proves CLI access at that instant; it does not prove Workers Paid,
quota headroom, retained-resource absence outside the returned inventory, or
permission to create a public route.

The same refresh could not list Supabase projects because the Supabase CLI
returned a transport error for the management API. The 2026-07-21 PostgreSQL row
therefore remains historical evidence only. Until a later read-only refresh
succeeds and the operator supplies the exact project reference, automation must
report the project inventory as `unknown`; it must not infer that the previously
observed project still exists, select a replacement project, or create one.

The current shell did not expose `RESEND_API_KEY_FILE`. This does not contradict
the operator's statement that a key has been stored elsewhere, but it means a
live verifier is not ready from this process until an explicit readable key-file
path is supplied. Automation must not search the repository, shell history, or
ambient environment for an alternative key, and it must never treat key presence
as verified-domain, tracking, team-namespace, or quota evidence.

The operator subsequently confirmed that a key was written, but the 2026-07-22
documentation audit again observed both `RESEND_API_KEY_FILE` and
`RESEND_API_KEY` unset in the verifier process. The correct conclusion remains
that the credential is operator-stored but not injected into this process; the
audit did not search for it. This does not invalidate the recorded 2026-07-21
test-mode result and does not authorize another live send.

## Second read-only refresh

Later on 2026-07-22, a fresh Supabase CLI request succeeded and returned one
unlinked `ACTIVE_HEALTHY` Free project intended for Cloudflare feasibility work.
This supersedes only the earlier `unknown` inventory observation. It does not
authorize automatic selection: the repository remains unlinked, and every live
database prototype must still receive the exact project reference and required
connection or certificate inputs explicitly. The project remains prototype
infrastructure, not evidence of production availability, backups, recovery, or
non-pausing behavior.

The same refresh reconfirmed Wrangler authentication and an empty R2 bucket-list
result. It did not prove Workers Paid, Container entitlement, quota headroom, or
the absence of resources outside that inventory operation. The current process
still did not expose `RESEND_API_KEY_FILE`; therefore the stored Resend key is
operator-known but unavailable to this verifier until its explicit readable
key-file reference is injected.

## Third read-only refresh

On 2026-07-22 after the operator completed Supabase CLI authentication,
Supabase CLI 2.109.1 successfully listed one unlinked `ACTIVE_HEALTHY` Free
project intended for Cloudflare feasibility work. The project reports
PostgreSQL 17.6.1 in `ap-southeast-1`. This confirms current management-plane
visibility and avoids the PostgreSQL 14 retirement issue identified in the
current Supabase changelog; it does not prove database-password access,
Hyperdrive connectivity, `verify-full` certificate identity, backup/recovery,
non-pausing availability, or production suitability.

The repository remains intentionally unlinked. A later live database prototype
must receive the exact project reference, database connection input, and
Dashboard-provided CA through explicit operator-controlled inputs. This refresh
created no project, changed no database, applied no migration, and started no
service.

## Execution rule

Implementation may continue on local Compose, Kubernetes, provider-neutral
contracts, and Cloudflare interfaces supported by the current combination of
Workers Free and the separately enabled R2 subscription. This is a prototype
execution profile, not a third Deployment target and not a reduced Cloudflare
production target. It MUST NOT be accepted by production `render`, `plan`, or
`apply`, and its evidence cannot qualify Kubernetes or Cloudflare.

Each live Cloudflare prototype must use positively owned disposable resources,
avoid production traffic, retain redacted evidence, and remove or disable every
public route, trigger, consumer, Worker, and other continuously invocable or
billable resource immediately after evidence collection. A retained private R2
object, Hyperdrive configuration, or external database is permitted only when a
named later prototype requires it, its owner and expiry are recorded, and it has
no public ingress or active trigger. Final prototype cleanup must re-inventory
the account rather than infer cleanup from successful delete commands.

No live provider prototype is a prerequisite for ordinary local implementation
or documentation validation. When one is explicitly run, its final acceptance
step includes disabling or removing public and continuously invocable resources
and rereading inventory; a passing assertion without that shutdown evidence is
an incomplete prototype result.

The following tasks remain incomplete until their real prerequisites exist:

- Task 1.7's required trusted-processing Container, task 1.8's independently
  deferrable thumbnail Container, and every Container-dependent part of task
  1.10
- Task 1.9's verified-domain and credential-rotation acceptance
- Production-domain and distinct-site work in sections 11, 12, and 15
- Thumbnail-capability and full Cloudflare-target acceptance

Deferring thumbnail generation does not make the full Cloudflare target
Free-compatible. The Cloudflare target still requires trusted background
processing, and the selected design implements that processing with Containers
available only through Workers Paid. Trusted processing and thumbnail generation
therefore have separate gates: task 1.7 cannot be satisfied by omitting
thumbnails, and task 1.8 can remain deferred only while thumbnail readiness is
reported unavailable. A Free-compatible prototype may report processing and
thumbnail capabilities unavailable, but it must not report the Cloudflare target
qualified or production-ready.

## Sources

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Containers pricing and plan requirement](https://developers.cloudflare.com/containers/pricing/)
- [Static Assets billing and Free-plan Worker-first behavior](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Queues pricing and Free-plan retention](https://developers.cloudflare.com/queues/platform/pricing/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [R2 public-bucket controls](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Resend `resend.dev` restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend test addresses](https://resend.com/docs/dashboard/emails/send-test-emails)
