# Current prototype execution baseline

<!-- cspell:words mhhjzebawhdkosyfzvvl pooler -->

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

## Current read-only refresh

On 2026-07-22, Wrangler 4.112.0 authenticated successfully to the intended
Cloudflare account. The R2 and Queue list operations returned no resources. One
private Hyperdrive configuration remains present with caching disabled, origin
connection limit `5`, and TLS mode `require`. These observations prove access to
those specific inventories at that instant; they do not prove Workers Paid,
Container entitlement, quota headroom, the absence of resources outside those
inventory operations, or permission to create a public route.

Supabase CLI 2.109.1 returned one unlinked `ACTIVE_HEALTHY` project using
PostgreSQL 17.6.1 in `ap-southeast-1`. The command also reports that the current
working copy has no project reference, so account authentication and repository
linkage must remain separate checks. This proves current management-plane
visibility only. It does not authorize automatic project selection or prove
database-password access, Hyperdrive runtime connectivity, `verify-full`
certificate identity, backups, recovery, non-pausing availability, or production
suitability. Every live database prototype must still receive the exact project
reference, connection input, and Dashboard-provided CA through explicit
operator-controlled inputs.

The current verifier process exposes neither `RESEND_API_KEY_FILE` nor
`RESEND_API_KEY`. This does not contradict the operator's statement that a key
was stored elsewhere, but the verifier is not ready for another live send until
an explicit readable key-file reference is injected. Automation must not search
the repository, shell history, or ambient environment for an alternative key,
and key presence never proves a verified domain, disabled tracking, provider
namespace, quota headroom, or production readiness. The recorded 2026-07-21
test-mode result remains historical evidence only.

Earlier same-day failures and partial refreshes are superseded by this section.
They remain useful as a design warning: one failed provider call makes only that
inventory `unknown`; it must not cause automation to reuse a historical resource,
select a replacement, or create one. This refresh created no project, changed no
database or Cloudflare resource, applied no migration, sent no email, and started
no service.

## 2026-07-26 authorized TLS hardening refresh

The operator explicitly authorized uploading the Supabase project CA, updating
the retained Hyperdrive configuration to `verify-full`, and enabling Supabase
database SSL enforcement. Before mutation, the supplied single-certificate CA
was checked for its subject, validity interval, SHA-256 fingerprint, and a
successful hostname-verifying TLS handshake to the project's documented pooler
hostname.

Wrangler reported no pre-existing account certificate. It then uploaded the
Supabase Root 2021 CA as
`69a08396-eadb-4aa6-b0ac-8448d848095f` and updated retained Hyperdrive
`f2bed5e2a79f41f6b68df5e6fc096c07` to bind that CA with
`sslmode = verify-full`. A management-plane reread reported caching disabled,
origin connection limit `5`, the expected database DNS hostname, the uploaded
CA identifier, and `verify-full`.

The Supabase CLI then enabled database SSL enforcement for project
`mhhjzebawhdkosyfzvvl`. Its post-change read returned `database: true`, and the
project inventory returned `ACTIVE_HEALTHY` after the change. The repository
remains intentionally unlinked; the checks used the explicit project reference,
so the CLI's linkage warning is not evidence of a failed provider operation.

These observations replace the mutable `require` and enforcement-disabled state
recorded above. They prove the selected management-plane configuration and
post-change project health, but they do not prove a successful Worker-runtime
query through Hyperdrive. Task 5.3 therefore remains open until the cache
freshness, transaction, prepared-statement, timeout, connection-budget, positive
runtime identity, and retained wrong-host or untrusted-certificate negative
evidence all pass in one bounded qualification run. No Worker, route, trigger,
consumer, or public service was created by this hardening operation.

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
