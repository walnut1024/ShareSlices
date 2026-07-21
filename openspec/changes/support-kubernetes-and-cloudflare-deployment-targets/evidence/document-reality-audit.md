# Deployment document reality audit

<!-- cspell:words Hyperdrive rollouts unarchived workerd WebPKI quiescence -->

Audit date: 2026-07-21. Rechecked against the repository and linked first-party
manuals on 2026-07-22.

## Scope and method

This audit compares the active change's proposal, design, delta specifications,
tasks, existing evidence, and affected durable product text with current
first-party Cloudflare, Resend, Docker Compose, and Kubernetes manuals. It does
not treat a successful prototype, a provider dashboard observation, or a
generated schema as proof of a broader platform guarantee.

The design remains **conditionally feasible**, but the Cloudflare target is not
yet supportable on the currently qualified Free setup. The current documents
already encode most of the necessary fail-closed gates. The corrections below
are intended to prevent later implementation from weakening those gates or
mistaking partial prototypes for production qualification.

Severity meanings:

- **Blocker**: the Cloudflare target cannot be declared supported until the item
  is satisfied.
- **High**: implementation could violate security, delivery, rollback, or data
  consistency if the documents are followed without the correction.
- **Medium**: the architecture remains viable, but the current wording or
  evidence can cause an incorrect implementation or readiness result.
- **Low**: documentation precision or cost-model clarification.

## Findings audited and reconciled

The table below records the pre-correction findings that drove this review. It
is historical evidence, not a list of still-open defects. The authoritative
post-correction state is summarized under **Reconciliation applied** and the
remaining external blockers are listed under **Current implementation gates**.

| Severity | Finding | Impacted artifacts and tasks | Recommended correction | First-party sources |
| --- | --- | --- | --- | --- |
| **High** | `PRODUCT.md` describes both production Deployment targets in unqualified present tense even though the active change is only partially implemented and neither target has passed its acceptance gates. A reader can reasonably interpret “The Kubernetes target runs” and “The Cloudflare target uses” as currently supported behavior rather than the intended product contract. | `PRODUCT.md` Deployment choices; proposal current-state statement; tasks 2.1, 10.1-10.16, 12.1-12.13, and 15.11-15.17. | Before further implementation, make support status explicit without making the durable document depend on the active change: identify these as planned target contracts that are unavailable until their target qualification and release acceptance pass, or defer the unimplemented target text from `PRODUCT.md` until it is delivered. Do not leave the current text implying that either path is already release-qualified. | Repository truth: the proposal says Kubernetes currently has only rendered examples and the target tasks remain incomplete; OpenSpec is the repository's implemented-requirement authority. |
| **High** | Task 2.11 and tasks 13.1-13.3 assign the same Compose migration and ownership transition twice. Task 2.11 says `deploy/compose/` becomes the complete canonical composition, while 13.1 moves the inputs, 13.2 moves lifecycle/test policy, and 13.3 preserves the public lifecycle. The execution dependency instructs running both groups immediately, but gives no single completion owner or ordering inside the overlapping mutation. | `tasks.md` execution dependencies, 2.11, and 13.1-13.3; proposal Compose scope. | Narrow 2.11 to creating the directory skeleton and ownership contract only, with no file/behavior migration, and make 13.1-13.3 the sole migration owner; alternatively remove 2.11 and make 13.1 create the structure. Add an explicit order: archive `consolidate-local-development-stack`, create the structure, then move inputs and automation once. | [Compose project name and precedence](https://docs.docker.com/compose/how-tos/project-name/), [Compose file merge and path rules](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) |
| **High** | Task 1.10 is positioned as a feasibility gate before implementation, but it requires integrated behavior that tasks 5.12 and 12.3-12.9 later define and implement: private Jobs verification, nonce/sub-fence semantics, cross-storage quiescence, first-install bootstrap, failed-candidate removal, trigger isolation, Container convergence, and rollback. Following the plan literally either duplicates production automation as a throwaway prototype or makes a gate depend on work that the gate is supposed to authorize. | `tasks.md` 1.10, 1.11, 5.12, 11.15-11.20, and 12.3-12.9; design migration plan. | Split 1.10 into bounded provider-interface spikes that can actually precede implementation (version selection, bootstrap limitation, `exports`, Secret preservation, Queue/Cron control behavior, Container rollout/rollback). Move the integrated release-state proof to 12.x/15.11 after the shared contracts exist. Let 1.11 record `qualified`, `provisional`, or `blocked` per interface rather than requiring a duplicate end-to-end deployer. | [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Durable Object migration limitations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Container rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/) |
| **High** | The design correctly says core verification is read-only and stateful checks belong to explicitly authorized pre-traffic or deep verification, but the Cloudflare parity requirement says ordinary `Cloudflare verify SHALL` exercise Queue duplication/recovery, Container execution, graceful termination, and authorization/revocation probes. Without a level qualifier, an implementation can mutate provider and product state during the default verifier in contradiction with the shared lifecycle contract. | `design.md` verification levels; `specs/cloudflare-deployment/spec.md` “Verify Cloudflare target parity”; tasks 14.1-14.8. | Amend the requirement and task mapping so default/core `verify` is read-only. Put synthetic Queue duplication, Container execution/termination, Upload, authorization transitions, revocation, and delivery under an explicitly authorized, isolated, cleanup-bounded pre-traffic or deep mode. Require the result to identify its verification level and refuse stateful probes without that authorization. | [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Container lifecycle](https://developers.cloudflare.com/containers/container-class/), [Kubernetes dry-run](https://kubernetes.io/docs/reference/using-api/api-concepts/#dry-run) |
| **High** | The proposed field-level ownership gives Cron triggers to Terraform while the same Worker script is deployed by Wrangler with Cron omitted. Cloudflare's Cron manual says a Worker managed with Wrangler should manage Cron exclusively through Wrangler configuration, and Wrangler configuration is a source of truth for deployed Worker configuration. The current “omit Terraform-owned fields” rule is therefore not proven safe and may cause drift or trigger removal/recreation during deploy. | `design.md` Cloudflare ownership; tasks 11.1, 11.3, 11.4, 11.10, and 12.3-12.9; existing official-platform audit. | Do not declare the Cron ownership split qualified from schema inspection. Choose one supported owner for the Worker and its Cron triggers, or add a disposable-account gate that repeatedly applies Terraform and deploys every Wrangler path, then proves the trigger survives unchanged and drift remains empty. Until that passes, mark this field split unsupported. Apply the same source-of-truth test to Queue consumers, routes, custom domains, and bindings. | [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Wrangler configuration source of truth](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth), [Cloudflare Terraform best practices](https://developers.cloudflare.com/terraform/advanced-topics/best-practices/) |
| **High** | The current execution prerequisite names only the missing Resend sending domain. In reality, the Cloudflare production topology also needs operator-owned Cloudflare zones for trusted ingress and the separate content registrable site. The current `workers.dev` subdomain cannot prove that isolation boundary, and the task list may allow work to proceed toward full Cloudflare acceptance while only task 1.9 appears domain-blocked. | `tasks.md` execution dependencies; design target prerequisites and distinct-site topology; tasks 1.9, 1.10, 11.1, 11.4, 12.3, 12.6, and 15.11. | Add the current domain prerequisite beside the Free-plan prerequisite: `workers.dev` and `resend.dev` are prototype-only; no-domain work may validate provider interfaces but cannot complete production ingress, registrable-site isolation, Resend qualification, or full Cloudflare acceptance. The core topology requires distinct operator-owned registrable sites, not only Gallery. | [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Workers routes and domains](https://developers.cloudflare.com/workers/configuration/routing/), [Resend domain management](https://resend.com/docs/dashboard/domains/introduction) |
| **Medium** | The prerequisite change `consolidate-local-development-stack` is still active with its final validation task incomplete. The current plan states that it must be archived first, but the migration tasks are not themselves marked blocked and task 2.11 combines harmless directory creation with the prohibited ownership move. | Current OpenSpec status; `tasks.md` execution dependencies, 2.4, 2.11, and 13.1-13.3. | Treat the archive as a hard machine-checkable prerequisite for every Compose ownership/file mutation, not merely narrative sequencing. Independent Cloudflare/Kubernetes research may continue. Directory-only preparation may proceed only after 2.11 is narrowed so it cannot accidentally claim or move Compose ownership. | [Compose project directory/name behavior](https://docs.docker.com/compose/how-tos/project-name/) |
| **High** | Task 1.1 records `cloudflare/cloudflare` 5.22.0 in JSON, but the repository currently has no Terraform root module, exact `required_providers` constraint, `.terraform.lock.hcl`, provider package checksums, or exported provider-schema digest. The validator prints the recorded number but does not install or interrogate that provider. This is a declaration, not an executable provider pin or schema qualification. | `deploy/cloudflare/toolchain-baseline.json`; `deploy/automation/check-cloudflare-toolchain.mjs`; task 1.1 and later tasks 11.1-11.4 that depend on provider fields. | Reopen task 1.1 or narrow its completed wording to Wrangler-only qualification. Before Terraform implementation relies on the baseline, add the actual root module, exact provider constraint, committed multi-platform dependency lock checksums, exported schema digest, and focused validation that required resources/fields exist in 5.22.0. A Registry URL in JSON is not sufficient pin evidence. | [Terraform provider requirements](https://developer.hashicorp.com/terraform/language/providers/requirements), [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock), [Cloudflare Terraform provider](https://developers.cloudflare.com/api/terraform/) |
| **High** | Task 1.6 is checked as proving comparison with a disposable account's “live Worker limits,” but its request-body ceiling and Static Assets ceilings come from dated official tables, not a provider-readable account-limit response. The Billing screenshot plus observed 10 ms CPU failure support a Workers Free classification; they do not directly measure the 100 MB body boundary. The abandoned large-body probe explicitly produced no stable limit evidence. | `evidence/cloudflare-live-limits-prototype.md`; task 1.6; later `doctor` tasks 12.1 and 14.13. | Keep the useful classification and validator, but change task/evidence status to “release-static limit comparison plus operator/provider observations,” or reopen 1.6 until a stable account-plan/limit source is qualified. Do not call the 100 MB value live-observed. `doctor` must retain the existing source classes and report the body limit as release-static/operator-evidenced when Cloudflare exposes no read API. | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **Blocker** | Cloudflare Containers are unavailable on Workers Free. The product target is therefore not a Free Workers target even if Workers, Queues, Hyperdrive, R2, and Resend test-mode prototypes pass. Containers also incur Worker and Durable Object usage in addition to Container compute, memory, disk, and egress. | Proposal Cloudflare qualification and low-cost language; design provider baseline; tasks 1.7, 1.8, Container-dependent parts of 1.10, 11.10-11.20, 12.1-12.10, 15.3, and 15.15. | Keep the existing Workers Paid prerequisite and Free-only execution dependency. Do not reinterpret deferred thumbnail generation as permission to mark processing or the Cloudflare target complete. `doctor` must prove Workers Paid and required Container capacity before any Cloudflare activation. Cost output should include Workers/Durable Objects and Container resource usage, not only the $5 minimum. | [Containers pricing](https://developers.cloudflare.com/containers/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| **Blocker** | The first-party Container manuals document VM isolation and platform egress controls, but do not expose Kubernetes-equivalent controls for Linux capability drop, `no-new-privileges`, seccomp, host namespaces, mounts, or per-process egress. `allowedHosts` applies to a whole Container, not separately to Rust and a Chromium child. | Proposal thumbnail qualification; design split-capability Container; `artifact-thumbnail` delta; tasks 1.7, 1.8, 5.10-5.12, 7.9-7.10, 11.12-11.14, and 14.8. | Preserve task 1.8 as an implementation-blocking outcome test. Do not convert missing provider controls into assumed equivalence. The Chromium Container without secrets and external controller/broker split is necessary, but still requires live adversarial evidence. If equivalent isolation cannot be proved, keep the Cloudflare thumbnail capability unavailable rather than relaxing the product contract. | [Container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/), [Container outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/), [Container SSH](https://developers.cloudflare.com/containers/ssh/) |
| **Blocker** | Production ingress and Resend qualification both require operator-owned DNS. A Worker Custom Domain requires an active Cloudflare zone; Resend requires a domain the operator owns and can verify. A `workers.dev` hostname is intended for personal/hobby use and cannot satisfy the change's distinct registrable-site or Resend verified-domain requirements. | Proposal prerequisites; design target prerequisites and distinct-site topology; tasks 1.9, 11.1, 11.4, 11.9, 12.1, 14.4, 14.7, and 15.11. | Keep `resend.dev` and `workers.dev` strictly as non-qualifying prototype paths. Production `doctor` must require owned zones for the trusted and content registrable sites plus a verified Resend sending domain. The domains may be existing operator assets; buying a new domain is not a product responsibility. | [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Workers routes and domains](https://developers.cloudflare.com/workers/configuration/routing/), [Resend domain management](https://resend.com/docs/dashboard/domains/introduction), [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction) |
| **High** | The refreshed Hyperdrive contract says PostgreSQL `require` validates the server certificate against WebPKI but does not perform hostname matching; only `verify-full` adds hostname verification. Existing prototype evidence proves encryption through `pg_stat_ssl` and used `require`, so it does not prove the production origin-identity requirement. A live Wrangler update also confirmed that selecting `verify-full` requires an uploaded CA certificate ID. | Design verified-provider baseline and database seam; `cloudflare-deployment` database requirement; tasks 1.3, 1.4, 5.1-5.4, and 12.1. | Do not use `TLS active`, `ssl=true`, or Hyperdrive `require` as proof of the required authenticated origin identity. Upload the database's region-specific single-certificate CA, configure `verify-full`, and run a negative hostname or certificate test. For a VPC Service origin, qualify TLS on the VPC Service because Hyperdrive TLS settings cannot be applied to that origin type. | [Hyperdrive TLS certificates](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/), [Hyperdrive API](https://developers.cloudflare.com/api/resources/hyperdrive/), [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) |
| **High** | Container egress interception covers HTTP/HTTPS only. Non-HTTP PostgreSQL traffic cannot be intercepted; it is denied when `enableInternet=false`. With Internet enabled, `allowedHosts` is a hostname/IP allowlist, not a documented port-level or per-process firewall. The manuals do not promise a stable Container egress IP for database-side allowlisting. | Design trusted processing Container; `cloudflare-deployment` direct PostgreSQL requirement; tasks 1.7, 1.8, 5.1-5.4, 11.10-11.13, and 12.1. | Retain the requirement for Internet enabled plus an exact host allowlist for public PostgreSQL, but document what it does **not** prove. Add endpoint certificate/hostname verification, least-privilege database credentials, and a live provider-specific reachability test. Do not describe this as an enforceable port-only or per-process policy. Keep private-database processing ineligible until an official Container-compatible private TCP path is exercised; Hyperdrive or Workers VPC success from a Worker does not prove Container reachability. | [Container outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/), [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), [Hyperdrive private databases](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/) |
| **High** | Pausing a Queue stops new delivery but the official contract does not say it cancels or drains already-running push consumers. Messages continue to age and can expire while paused. Retention is 24 hours on Free; on Paid it defaults to four days and is configurable up to fourteen days. Delayed sends/retries can be delayed up to 24 hours. | Design release-verifier cleanup and trigger isolation; `cloudflare-deployment` phased apply; tasks 1.10, 5.12, 11.17-11.20, 12.6-12.9, and 14.8. | Define the verifier tombstone and cleanup horizon from observed configuration: at least the maximum of Queue retention, send/retry delay, retry schedule, active-invocation lease, and cross-storage side-effect interval, plus clock margin. Queue pause is only one gate; PostgreSQL terminal nonce/sub-fence and observed active-invocation quiescence remain required. Never report platform-level draining from pause alone. | [Pause and purge](https://developers.cloudflare.com/queues/configuration/pause-purge/), [Queues pricing and retention](https://developers.cloudflare.com/queues/platform/pricing/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) |
| **High** | Worker rollback is limited to the 100 most recently published versions and cannot cross a Durable Object lifecycle change or use a deleted bound resource. Container images are separately retained; deleting an old image can break a Worker rollback. | Design release retention and rollback; `deployment-orchestration` release inventory; `cloudflare-deployment` rollback; tasks 2.6, 8.1-8.6, 11.15-11.20, 12.7-12.11, and 14.9-14.10. | Make the N-1 readiness check explicit: the exact Worker version must still be provider-addressable, every binding resource must exist, the retained Jobs bundle must remain deployable, and the referenced Container image must exist. Count verifier/bootstrap/version churn against the 100-version provider window. Refuse rollback before mutation if any identity is unavailable; a local release bundle alone does not restore an evicted Worker version or deleted image. | [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Container image management](https://developers.cloudflare.com/containers/platform-details/image-management/) |
| **High** | A Worker version at zero-percent traffic is not private. An external request can select any version in the current deployment with `Cloudflare-Workers-Version-Overrides`; if an override is malformed or not applied, the request silently follows ordinary deployment percentages. Only two versions can be active in one deployment. | Design staged release and compensation; `cloudflare-deployment` first-install/upgrade rules; tasks 1.10, 5.12, 11.16-11.20, and 12.3-12.9. | Keep the existing requirement that candidates satisfy the full production authorization/security contract before staging. Verification must prove the returned version metadata, not merely a successful response. Failed candidates must be removed from current deployment membership and that membership reread. Do not call a zero-percent version inaccessible, isolated, or non-serving. | [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/), [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/) |
| **High** | Durable Object `exports` currently fails `wrangler versions upload`; lifecycle changes can only be reconciled by immediate `wrangler deploy`, cannot be gradual, and block rollback across the lifecycle change. Container Worker code updates immediately while Container instances roll separately, by default 10% and then 100%. | Design Jobs Worker deployment and Container convergence; `cloudflare-deployment` rollout; tasks 1.10, 11.15-11.20, and 12.3-12.11. | The documents' split path is correct and must not be simplified: App/Content may stage versions, while Jobs uses trigger-isolated immediate deploy. Define stable Container classes upfront, forbid ordinary lifecycle changes, retain old images/bundles, and observe every production-capable Container slot independently. A successful Jobs deploy is not Container convergence. | [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Container deployments](https://developers.cloudflare.com/containers/platform-details/rollouts/) |
| **Medium** | The Resend prototype evidence says two current official pages disagree about the default team request rate. Current first-party API Introduction, Usage Limits, and account-limits pages now agree on 5 requests/second/team. The older 2 requests/second statement is historical/stale. The live prototype's response header reported 10, which remains valid account-specific evidence. | `evidence/cloudflare-resend-test-mode-prototype.md`; task 1.9 evidence interpretation; tasks 6.6, 6.9, and 14.13. | Replace the “two current pages disagree” sentence with: the current documented default is 5 requests/second/team, but the provider response headers and current Usage dashboard are authoritative for an individual team and may show an approved higher limit. Keep rate and quota values out of durable product policy. | [Resend API Introduction](https://resend.com/docs/api-reference/introduction), [Resend Usage Limits](https://resend.com/docs/api-reference/rate-limit), [Resend account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits) |
| **Medium** | `resend.dev` test addresses prove API acceptance and event simulation but not a verified custom sender domain, a domain-scoped key, production deliverability, tracking state, or inbox delivery. A successful `POST /emails` is `email.sent`/accepted for delivery attempts; even Resend's later `delivered` event means acceptance by the recipient mail server, not inbox placement. | Resend prototype evidence; `account-entry` and `cloudflare-deployment` email requirements; tasks 1.9, 6.4-6.11, and 14.7. | Keep task 1.9 unchecked. Preserve provider acceptance as distinct from final delivery and inbox placement. A production qualification run needs an owned verified domain, sending-access keys scoped to that domain, current tracking-disabled evidence, and an authorized recipient. Do not derive delivery success from the provider message ID alone. | [Resend test emails](https://resend.com/docs/dashboard/emails/send-test-emails), [Send Email API](https://resend.com/docs/api-reference/emails/send-email), [Resend event types](https://resend.com/docs/webhooks/event-types), [Delivered but not received](https://resend.com/docs/knowledge-base/what-if-an-email-says-delivered-but-the-recipient-has-not-received-it) |
| **Medium** | A sending-access Resend key can send but cannot inspect domain, tracking, account health, or key inventory. Same-team/domain credential rotation therefore cannot be proven from the two runtime keys alone. Tracking is disabled by default, but it is mutable per domain. | Design Resend operator evidence; `cloudflare-deployment` Resend `doctor`; tasks 1.9, 6.4, 6.8-6.9, 12.1, and 14.7. | Keep runtime free of a full-access key. Define exactly what qualifies operator evidence: a dated dashboard export/screenshot or a separately authorized administrative read performed outside runtime. Record only a non-secret team namespace, domain, key revision, evidence timestamp, and result. Expired or missing evidence must be `unknown` and block the email capability when required. | [Resend API-key permissions](https://resend.com/docs/dashboard/api-keys/introduction), [Resend tracking](https://resend.com/docs/dashboard/domains/tracking/) |
| **Medium** | Resend idempotency lasts only 24 hours. The same key with a different payload is a permanent 409, while a concurrent same-key request is a distinct 409. The provider window is a retry aid, not a durable exactly-once guarantee. | Design authentication-email delivery; `account-entry` delta; `cloudflare-deployment` Resend requirement; tasks 1.9 and 6.4-6.8. | The existing frozen safe-replay cutoff is appropriate. Keep it conservative and non-extendable across restarts and key rotation. Require byte-equivalent payload plus the same team/sender/logical key, and enter manual reconciliation at the cutoff. Do not retry an indeterminate request merely because the local job lease expired. | [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [Resend errors](https://resend.com/docs/api-reference/errors) |
| **Medium** | Static Assets are served before Worker code by default. Selective `run_worker_first` is required for dynamic routes that could match an asset or SPA fallback. Static-asset requests are free/unlimited, but Worker-first requests consume Worker usage and can return 429 on Free rather than falling back to an asset. Static Assets' default browser header is revalidating, not long-lived immutable caching, unless `_headers` changes it. | Design Edge/CDN module; `artifact-viewer` cache boundaries; tasks 2.7-2.8, 11.5-11.8, 12.1, 14.3-14.4, and 15.3. | Keep exact source-linked route patterns and negative tests that no asset or SPA fallback shadows API, authentication, management, Upload, Preview, Viewer, or content-only routes. Generate immutable headers only for content-hashed assets. Include Worker-first request volume as a cost/quota input. Do not describe every Static Assets response as immutable or every edge request as free. | [Static Assets Worker routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/) |
| **Medium** | The Workers Cache API is data-center-local and does not participate in tiered caching. `cache.put()` rejects `206`, `Vary: *`, non-GET keys, and responses that forbid caching. `cache.delete()` affects only the current data center. | Design optional Viewer byte cache; `artifact-viewer` delta; tasks 2.8, 11.7-11.8, 14.3-14.4. | Continue describing Viewer byte reuse as optional opportunistic per-location acceleration, not a globally populated CDN guarantee. Keep authorization before every lookup, full-body-only internal entries, Range bypass, bounded size, versioned representation keys, and outward `no-store`. Revocation must depend on authorization, never a global purge claim. | [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) |
| **Medium** | R2 multipart supports objects larger than a single Worker request only when the client sends multiple requests/parts. Each inbound Worker request still obeys the Cloudflare account-plan body limit. R2 permits only one write/second to the same key and rate-limits excess concurrent writes. | Existing R2/limits evidence; object-storage Adapter; tasks 1.5-1.6, 5.5-5.7, 12.1, and 14.3. | Keep the current 50 MiB single-request validation. If the product later raises it above the account body limit, that requires a separately specified client multipart HTTP contract. Add same-key write-rate handling to R2 parity tests and ensure retries use immutable staging keys or conditional writes rather than racing one final key. | [R2 limits](https://developers.cloudflare.com/r2/platform/limits/), [R2 multipart from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/) |
| **Low** | Current Resend Free pricing remains suitable for low-volume prototypes, but it is not a production guarantee: 3,000 emails/month, 100/day, one domain, and 30-day data retention are mutable plan facts. Sent and received messages and each recipient count against quota. Disabling message-content storage is a paid add-on with eligibility requirements. | Proposal low-cost expectation; design Resend privacy/cost text; tasks 6.9-6.11, 12.1, 14.13, and 15.3. | Keep plan values in dated provider/operator evidence, not PRODUCT policy. The runbook must disclose provider retention after local payload deletion and must not imply that Free can disable provider content storage. | [Resend pricing](https://resend.com/pricing), [Resend account limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Sensitive content storage](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend) |

## Confirmed design choices that should not be simplified

The following current choices match first-party contracts and should survive
document cleanup:

1. **Mutually exclusive targets.** Kubernetes may use an external CDN without
   becoming the Cloudflare runtime target.
2. **Workers Paid is an explicit Cloudflare prerequisite.** Free-compatible
   prototypes are evidence for individual interfaces only.
3. **PostgreSQL remains authoritative.** Hyperdrive caching is disabled for
   freshness-sensitive paths, and advisory-lock/session-dependent operations
   stay on one direct connection.
4. **R2 remains private.** Both `r2.dev` and public R2 custom-domain access stay
   disabled; Viewer access goes through authorization-first Worker routes.
5. **Jobs deployment is separate from staged App/Content deployment.** Durable
   Object `exports` and Container rolling replacement make one atomic rollout
   impossible.
6. **Queues and Cron are wake/recovery signals.** Queue delivery is at least
   once, and Cron changes can take up to 15 minutes to propagate. PostgreSQL
   leases, fences, gates, and idempotency remain authoritative.
7. **Worker candidate security is production-grade before staging.** A
   zero-percent version is still externally selectable through a public route.
8. **Resend acceptance is not inbox delivery.** Provider idempotency is bounded,
   and provider-side retention is separate from local payload deletion.
9. **Viewer caching is authorization-first.** Stable Viewer and Preview
   responses remain `no-store`; any internal byte reuse is full-body,
   representation-keyed, and optional.
10. **Compose evidence is not production qualification.** Local Compose remains
    a non-production development/test topology under `deploy/`.

The Compose and Kubernetes primitives used by the plan are also realistic, with
the qualifications already expressed in the design:

- Compose supports long-form `service_healthy` and
  `service_completed_successfully` dependencies, bounded `up --wait`, explicit
  project names, and loopback/dynamic published ports. Shell interpolation
  precedence and project/path resolution still justify the proposed hermetic
  test environment and explicit ordered file lists. See [startup
  order](https://docs.docker.com/compose/how-tos/startup-order/), [`compose up`
  options](https://docs.docker.com/reference/cli/docker/compose/up/), [project
  names](https://docs.docker.com/compose/how-tos/project-name/), and
  [interpolation precedence](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
- Kubernetes server-side dry-run exercises API validation and admission without
  persistence, but cannot prove runtime networking. NetworkPolicy requires a
  network implementation that enforces it, standard policy does not safely
  express an external FQDN allowlist, and Ingress requires an ingress
  controller. The design's separate read-only `doctor` and authorized
  pre-traffic allow/deny probes are therefore necessary. See [server-side
  dry-run](https://kubernetes.io/docs/reference/using-api/api-concepts/#dry-run),
  [NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/),
  and [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/).

The existing `official-platform-audit.md` remains current on Durable Object
`exports`, versioned deployment, Container rollout, Queue delivery, Static
Assets, Cache API, R2, Compose, and Kubernetes limitations. Its
Terraform/Wrangler ownership conclusion is too broad specifically for Cron: the
current official Wrangler guidance requires the source-of-truth conflict above
to be resolved or proven with the pinned toolchain. Its Resend contract remains
sound, while the separate Resend prototype's statement that current official
rate-limit pages disagree is stale.

## Required document edits before more implementation

The minimum reconciliation set is:

1. Correct `PRODUCT.md` support status so planned, partially implemented
   Deployment targets are not presented as already release-qualified.
2. Remove the overlap between task 2.11 and tasks 13.1-13.3, and make the
   still-unarchived `consolidate-local-development-stack` change a hard
   prerequisite for every Compose ownership/file mutation.
3. Split task 1.10 into early provider-interface spikes and later integrated
   release acceptance; do not require throwaway duplication of tasks 5.12 and
   12.3-12.9.
4. Reconcile Cloudflare core verification with the shared read-only contract;
   stateful Queue, Container, authorization, revocation, processing, and email
   probes require explicit pre-traffic or deep authorization.
5. Resolve Cron ownership between Terraform and Wrangler or keep it unqualified
   until a disposable-account two-owner drift/survival test passes. Narrow the
   overly broad ownership conclusion in `official-platform-audit.md`.
6. Reopen or narrow task 1.1 until the Cloudflare Terraform provider is pinned
   through an actual Terraform constraint, dependency lock, checksums, and
   exported schema evidence rather than a JSON declaration.
7. Reclassify task 1.6 and its body-limit statement as release-static plus
   operator/provider observation; do not call the 100 MB value live-observed.
8. Correct the stale Resend rate-limit sentence in
   `cloudflare-resend-test-mode-prototype.md` while retaining the observed
   account-specific value of 10 from response headers.
9. Add an explicit Hyperdrive origin-identity gate: configured TLS verification
   mode, hostname/certificate negative test, and a clear distinction between
   encrypted transport and authenticated origin identity.
10. State that Container `allowedHosts` is whole-Container host filtering, not
   documented port-level or per-process enforcement, and keep private direct
   PostgreSQL ineligible until a Container-compatible path is proven.
11. Define the Queue verifier tombstone/quiescence horizon from observed Queue
   retention, delay, retry, invocation, and side-effect intervals rather than a
   generic “late-delivery window.”
12. Add the 100-version Worker rollback window and retained Container-image
   existence to release retention and pre-rollback checks.
13. Make the current missing-domain state explicit in execution sequencing:
   `workers.dev`/`resend.dev` prototypes may continue, but production ingress,
   distinct-site qualification, Resend task 1.9, and full Cloudflare acceptance
   remain pending.

These edits do not change the product's two-target decision. They make the
existing gates measurable against current provider behavior and prevent the
implementation from treating partial Free-plan evidence as a supported
Cloudflare production deployment.

## Reconciliation applied

The document-only reconciliation on 2026-07-21 applied all items above before
further implementation:

- `PRODUCT.md` and the proposal now distinguish the accepted target contract
  from release-qualified availability, and the Kubernetes optional-CDN cache
  boundary is explicit.
- Task 2.11 is structure-only; 13.1-13.3 solely own the Compose move and require
  recorded archival of `consolidate-local-development-stack` first.
- Task 1.10 now contains bounded provider-interface spikes; integrated release
  behavior remains in 11.20, 12.3-12.9, and final acceptance.
- Core verification is read-only across the shared and Cloudflare specs. Every
  stateful provider/product probe is explicitly pre-traffic or deep.
- Worker-coupled Cron, Queue-consumer, route, domain, and binding ownership is
  provisional until repeated Terraform/Wrangler survival and drift evidence
  selects one owner.
- Task 1.1 was reopened for an executable Terraform constraint, dependency lock,
  checksums, provider-schema digest, and required-field checks. That evidence was
  subsequently added and the task completed. Task 1.6 now accurately
  distinguishes provider-observed, release-static, and operator-evidenced
  limits.
- Resend's current documented default rate and the account-specific live header
  are no longer described as contradictory.
- Hyperdrive/direct PostgreSQL qualification now requires explicit hostname and
  certificate verification with a negative case. Container `allowedHosts` is
  described only as whole-Container host filtering.
- Queue verifier retention now derives from observed retention, delay/retry,
  invocation, recovery, and cross-storage intervals, and Queue pause is not
  treated as in-flight drainage.
- Cloudflare rollback now accounts for the provider's 100-published-version
  window, bootstrap/verifier churn, binding resources, and retained Container
  images.
- The execution dependencies now mark `workers.dev` and `resend.dev` as
  prototype-only while owned production zones, distinct registrable sites, and
  a verified Resend sending domain are absent.

## Second-pass clarification before runtime implementation

A second documentation pass on 2026-07-21 found one remaining ambiguity rather
than a new architecture defect: “the current Free account” collapsed independent
Cloudflare entitlements. The observed account has Workers Free execution and a
separately enabled R2 subscription; R2 enablement neither grants Workers Paid nor
makes Containers available. The execution baseline, design defaults, and task
dependencies now use those separate names.

The same correction makes the current low-cost setup explicitly a disposable
prototype execution profile. It is not a third Deployment target, a production
configuration value, or a partially qualified Cloudflare target. Production
`render`, `plan`, and `apply` must reject that profile. Live prototypes must
remove or disable every public or continuously invocable resource after evidence
capture, re-inventory provider state, and attach an owner and expiry to any
private prerequisite deliberately retained for the next bounded experiment.

This clarification matches the current first-party contracts: Containers have
no Workers Free allocation, R2 has its own usage and subscription model,
`resend.dev` is test-only, and Supabase Free projects may pause after low
activity. It does not change the selected Kubernetes or Cloudflare production
architecture.

## Third-pass correction before database implementation

The 2026-07-21 refresh found that Cloudflare's current Hyperdrive TLS pages no
longer support this audit's earlier claim that first-party default-mode behavior
is contradictory. They now consistently state that PostgreSQL `require`
validates the server certificate against WebPKI, while `verify-full` additionally
matches the database hostname. The design, delta specification, and database
prototype evidence now reflect that contract. Production qualification remains
stricter than the default and requires `verify-full` or a subsequently qualified
equivalent plus a negative hostname or certificate test; `pg_stat_ssl` alone
still proves only encryption.

The same refresh identified a previously unstated availability and cost edge:
Workers Static Assets requests are free when served directly, but a path matched
by `assets.run_worker_first` invokes Worker code. On Workers Free, exhaustion of
the Worker request allowance returns `429` rather than falling back to the
matching Static Asset. The Cloudflare cost contract and tasks now require this
route consumption and failure mode to be planned and tested.

## Current implementation gates

The document set is internally consistent after the reconciliation above, but
the following gates remain deliberately open and MUST NOT be inferred from the
completed Free-compatible prototypes:

- Workers Paid plus live Cloudflare Container qualification for trusted
  processing; thumbnail Container isolation is a separate gate and may be
  deferred only while thumbnail readiness is unavailable.
- Operator-owned Cloudflare zones that prove separate trusted and content
  registrable sites; `workers.dev` is prototype-only.
- A verified operator-owned Resend sending domain, domain-scoped sending key,
  disabled-tracking evidence, and same-namespace key-rotation evidence;
  `resend.dev` proves only the bounded test-mode contract.
- Hyperdrive `verify-full` (or a subsequently qualified equivalent) with an
  uploaded region-specific single CA certificate and a hostname/certificate
  negative case.
- One proven owner for every Worker-coupled field after repeated
  Terraform/Wrangler survival and drift tests, especially Cron, Queue consumers,
  routes, custom domains, and bindings.
- Representative Kubernetes direct, Kubernetes external-CDN, and Cloudflare
  staging acceptance plus the final official-manual refresh before declaring a
  target supported.

These are acceptance blockers, not reasons to weaken product behavior. Local
Compose, provider-neutral automation, Kubernetes work, and bounded
Free-compatible Cloudflare prototypes may continue independently.

## Fourth-pass repository-state correction

The 2026-07-22 pre-implementation review found no new provider-contract defect,
but it found stale repository-state wording left behind by completed tasks
13.1-13.3 and the first Runner migrations. The design context, Deployment Module
status, deployment-contract ownership note, local-stack prerequisite evidence,
and historical low-cost report now distinguish the original proposal snapshot
from current implementation state. Compose inputs and lifecycle policy are
already owned under `deploy/`; only policy-free compatibility wrappers remain
under `tools/`. At that checkpoint Artifact and thumbnail processing used the
shared resident Runner core. No requirement, target boundary, or qualification
gate changed.

## Fifth-pass Runner-state correction

The 2026-07-22 review after the next implementation batch found one stale
statement in the fourth-pass snapshot. The resident Worker now runs Artifact
processing, thumbnail, bundle-alias index rebuilding, Gallery safety, Gallery cover,
and Gallery copy through `BackgroundLane` and the shared `Runner`; those
resident lane migrations are no longer open work.

At that checkpoint this did **not** complete the bounded Cloudflare execution
contract because the production command and explicit in-flight deadline were
still absent. The next implementation batch added explicit lane selection,
maximum claims, idle observations, wall time, a machine-readable remaining-work
outcome, and bounded cancellation for resident shutdown and bounded expiry.
Tasks 7.1, 7.3, and 7.4 now have focused and live local evidence. Task 7.2 remains
open until the Kubernetes workload actually composes and regression-tests the
resident mode. These shared runtime results still do not qualify Cloudflare
Jobs, Queues, or Containers.

## Sixth-pass primary-narrative correction

The 2026-07-22 documentation audit found that the fifth-pass Runner evidence
and `docs/design/modules.md` matched the code and completed tasks, but the
opening context in `design.md` still described only Artifact and thumbnail
lanes as migrated and still called bounded drain future work. The primary
design narrative now records all six resident lanes and the implemented
bounded-drain contract, while keeping Kubernetes workload composition and the
Cloudflare Jobs, Queue, and Container Adapters explicitly unqualified.

The same audit corrected `deploy/contract/README.md`: the checked `fixtures/`
directory contains valid deployment/release fixtures and topology-specific
verification fixtures. Invalid, mixed-target, Compose-as-production, and
Secret-bearing cases are derived and rejected by `deploy/tests/contracts.test.mjs`;
there are no separate invalid fixture files.

A focused first-party refresh reconfirmed the implementation-relevant external
boundaries: Containers have no Workers Free allocation; directly served Static
Assets are free while `run_worker_first` requests consume Worker allowance and
may return `429` on Free exhaustion; Hyperdrive `verify-full` adds hostname
matching beyond `require`; and `resend.dev` remains restricted test mode with a
24-hour idempotency window. No target, task, or acceptance gate was relaxed.

## Seventh-pass database-scope correction

The 2026-07-22 pre-5.3 documentation review found two scope errors in the
Hyperdrive prototype evidence. First, the direct-connection inventory had not
been updated after task 5.2 moved the complete authentication-email dispatch
attempt onto one explicitly checked-out direct client. The inventory now names
that session-continuity requirement alongside the advisory-lock paths.

Second, the pending live-semantics paragraph called its named prepared-statement
probe a repository-driver requirement without saying that no current
ShareSlices query supplies an application-level `node-postgres` statement
`name`. The probe is intentionally conservative compatibility evidence.
Cloudflare's current contract supports protocol-level named prepared statements
from `node-postgres` but still excludes SQL-level `PREPARE`, `EXECUTE`,
`DEALLOCATE`, and `DISCARD`; the corrected evidence keeps those categories
separate. Transaction, timeout, pool-budget, cache-disabled freshness, and
`verify-full` positive/negative evidence remain required by task 5.3 and remain
incomplete until executed and recorded.
