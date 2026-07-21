# Current prototype execution baseline

## Purpose

This evidence records which deployment experiments the current operator accounts can support without implying that the Cloudflare production target is qualified. It contains no credential values, provider tokens, database passwords, billing identifiers, or reusable resource addresses.

Observed on 2026-07-21 with non-mutating account and CLI commands. Mutable provider state must be checked again before each live prototype and before release qualification.

## Current account evidence

| Dependency | Current observation | Work allowed now | Work that remains blocked |
| --- | --- | --- | --- |
| Cloudflare authentication | Wrangler 4.112.0 is authenticated to the intended account | Read-only discovery and disposable Free-compatible Worker interface prototypes | Authentication alone does not prove plan entitlement, quota headroom, production routing, or target qualification |
| Cloudflare plan | Billing evidence shows R2 Paid but no Workers Paid subscription | Workers Free-compatible Static Assets, Worker, R2, Queue, Hyperdrive, and control-plane prototypes within observed limits | Cloudflare Containers, trusted processing, thumbnail isolation, Container rollout and rollback, and full Cloudflare acceptance |
| Cloudflare hostname | The account has a `workers.dev` subdomain | Disposable route prototypes that are removed after evidence collection | Production ingress, the separate trusted/content registrable-site boundary, Gallery eligibility, and custom-domain qualification |
| R2 | R2 is enabled and prior disposable bucket operations succeeded | Private R2 binding, streaming, multipart, range, and object-contract prototypes | R2 availability does not qualify the complete target or permit public bucket exposure |
| PostgreSQL | Supabase CLI can see one active Free project; this repository is not linked to it | Explicitly configured, disposable database and Hyperdrive compatibility probes that use operator-supplied references | Automatic project selection, production durability, backup and recovery claims, and uninterrupted availability; Free projects may pause after low activity |
| Resend | A key is available to the opt-in verifier, and the recorded `resend.dev` run proved accepted HTTPS submission and idempotent replay | API-shape, error classification, quota-header, idempotency, replay-cutoff, redaction, and safe simulation-address tests | Task 1.9, arbitrary recipients, verified-domain sending, disabled-tracking proof, same-domain key rotation, deliverability, and inbox-delivery claims |
| Owned domains | No operator-owned Cloudflare zones or verified Resend sending domain are recorded for this change | `workers.dev` and `resend.dev` prototype work only | Production custom domains, distinct-site acceptance, Resend production qualification, and full Cloudflare staging acceptance |

## Execution rule

Implementation may continue on local Compose, Kubernetes, provider-neutral contracts, and Cloudflare interfaces supported by the current Free account. Each live Cloudflare prototype must use positively owned disposable resources, avoid production traffic, retain redacted evidence, and remove or disable public and billable resources after the check.

The following tasks remain incomplete until their real prerequisites exist:

- Tasks 1.7 and 1.8 and every Container-dependent part of task 1.10
- Task 1.9's verified-domain and credential-rotation acceptance
- Production-domain and distinct-site work in sections 11, 12, and 15
- Thumbnail-capability and full Cloudflare-target acceptance

Deferring thumbnail generation does not make the full Cloudflare target Free-compatible. The Cloudflare target still requires trusted background processing, and the selected design implements that processing with Containers available only through Workers Paid. A prototype release may report thumbnail and processing capabilities unavailable, but it must not report the Cloudflare target qualified or production-ready.

## Sources

- [Workers pricing and Container entitlement](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [R2 public-bucket controls](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Resend `resend.dev` restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend test addresses](https://resend.com/docs/dashboard/emails/send-test-emails)
