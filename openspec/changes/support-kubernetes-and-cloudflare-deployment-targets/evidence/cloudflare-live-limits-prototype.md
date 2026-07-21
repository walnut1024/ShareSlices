# Cloudflare live limits prototype evidence

## Evidence sources

On 2026-07-20, task 1.6 classified limits from three explicit sources rather
than presenting every value as provider-readable:

1. **Operator evidence:** the current Cloudflare Billing > Subscriptions page
   showed `R2 Paid` as the only active subscription. It showed no Workers Paid,
   Pro, Business, or Enterprise subscription. The supplied screenshot is not
   retained because it also contains billing details.
2. **Provider observations:** a disposable Cron Worker was terminated at the
   documented Workers Free 10 ms CPU boundary during task 1.5. Wrangler
   successfully uploaded the generated Web build as Workers Static Assets and
   reported 44 asset entries. No public target was attached.
3. **Pinned official contract:** the Workers limits reference dated for this
   release assigns Workers Free 20,000 Static Asset files per version, 25 MiB
   per individual asset, and a 100 MB request body limit for the Free
   Cloudflare plan.

`R2 Paid` enables metered R2 use; it is not evidence of Workers Paid or a paid
Cloudflare zone plan and does not raise the Worker or Static Assets limits.

Official reference:
<https://developers.cloudflare.com/workers/platform/limits/>.

## Generated release comparison

The production Web build contained 43 filesystem files. Wrangler's live Static
Assets upload reported 44 asset entries, so deployment validation conservatively
uses the provider-observed count when it is available. The largest generated
JavaScript asset was 423,773 bytes.

| Input | Actual | Qualified limit | Result |
| --- | ---: | ---: | --- |
| Configured ZIP Upload | 52,428,800 bytes | 100,000,000 bytes | pass |
| Static Assets entries | 44 provider-observed | 20,000 | pass |
| Largest Static Asset | 423,773 bytes | 26,214,400 bytes | pass |

The build upload was accepted by the live account and its route-free Worker
version was deleted immediately after observation.

## Executable rejection behavior

`deploy/cloudflare/prototypes/limits/validate-limits.mjs` compares the
configured Upload value, generated asset count, and every generated asset size
against a qualified limit record. Its focused tests prove that the current
50 MiB Upload and generated Web build pass, while an Upload of 100,000,001
bytes fails with stable code `upload_exceeds_worker_request_body`.

The validator uses decimal MB for Cloudflare's request-body limit and binary MiB
for the product Upload and Static Assets file limits. It does not silently
equate the units.

R2 multipart remains an object-storage operation behind the Worker request.
The task 1.5 prototype required separate HTTP requests for separate multipart
parts. Server-side R2 multipart cannot make one inbound Worker request larger
than the account request-body limit, so the validator always compares the
complete configured single-request Upload maximum with that limit.

## Abandoned public probe and cleanup

A disposable attempt to send the full boundary through a Cron Worker to a
`workers.dev` Worker produced upstream connection loss and then an unauthenticated
404 instead of stable client-facing limit evidence. It was not used as proof.
All three temporary Workers, their Cron, and the Static Assets version were
deleted. Final inventory checks found all three script names absent and no R2
buckets remaining.

This evidence completes task 1.6. Production `doctor` must still classify each
limit as provider-observed, release-static, or fresh operator evidence, and
must block when required account-plan evidence is missing or stale.
