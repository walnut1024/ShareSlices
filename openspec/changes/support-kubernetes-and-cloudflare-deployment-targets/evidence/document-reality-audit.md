# Deployment document reality audit

<!-- cspell:words Hyperdrive pooler rollouts unarchived workerd worktree WebPKI quiescence -->

Audit date: 2026-07-21. Rechecked against the repository and linked first-party
manuals on 2026-07-22.

This file is a chronological audit log. Later dated acceptance entries supersede
earlier implementation-status statements; the current executable boundary lives
in `docs/design/modules.md`, and current mutable account observations live in
`evidence/current-prototype-execution-baseline.md`.

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
| **Resolved assumption / remaining High gate** | The earlier claim that Durable Object `exports` always fails `wrangler versions upload` is false for Wrangler 4.112.0: a live minimal, already bootstrapped exports-only Worker uploaded a new version successfully. First-script version upload still fails, `migrations` and `exports` are mutually exclusive, lifecycle changes cannot be gradual, and the full Container-bearing Jobs path remains unqualified. Container Worker code and Container instances also roll on separate timelines. | Design Jobs Worker deployment and Container convergence; `cloudflare-deployment` rollout; tasks 1.10, 11.15-11.20, and 12.3-12.11. | Remove the absolute incompatibility claim while retaining the trigger-isolated immediate default until the exact Jobs configuration proves staged image, Secret, activation, rollback, and Container convergence semantics. Define stable Container classes upfront, forbid ordinary lifecycle changes, retain old images/bundles, and observe every production-capable Container slot independently. | [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Container deployments](https://developers.cloudflare.com/containers/platform-details/rollouts/) |
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
- A passing Worker-runtime Hyperdrive `verify-full` positive case (or a
  subsequently qualified equivalent) with the database's operator-provided,
  region-specific single CA certificate. The 2026-07-22 wrong-host negative
  case passed, but control-plane acceptance and encryption alone do not replace
  the still-missing positive runtime proof.
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

## Eighth-pass live Hyperdrive evidence correction

The 2026-07-22 live qualification first passed the existing representative
database paths, transaction rollback, protocol-level named statement,
transaction-local state reset, statement timeout, and one-connection Worker
pool checks through cache-disabled Hyperdrive. The enhanced prototype then
added explicit cross-Pool freshness and queued-second-connection assertions,
but a later provider/network failure prevented that stronger run from
completing. Those assertions are therefore implemented but not yet qualified.

A disposable region CA upload allowed the Hyperdrive control plane to accept
`verify-full`. Replacing the configured DNS origin with its IPv6 literal failed
with a certificate hostname mismatch while preserving the original
configuration, which is valid wrong-host negative evidence. The corresponding
Worker-runtime positive query did not succeed, so task 5.3 remains open. The
configuration was restored to cache-disabled `require`, and every disposable
Worker, Cron trigger, and uploaded CA was removed. Only the private Hyperdrive
and Supabase prototype project remain, operator-owned for the next bounded
database run and subject to removal review before final change handoff.

This pass does not relax task 5.3, qualify `require` as hostname verification,
or make Supabase a mandatory production database provider. The following local
implementation added the task 5.4 fail-closed doctor gate: missing observations,
an omitted required direct role, enabled or unknown Hyperdrive caching,
`require`, a missing CA or qualified-equivalent identity, and absent positive or
negative runtime evidence all produce stable unavailable checks. Provider
observation and the complete CLI doctor remain owned by tasks 3.6 and 12.1.

## Ninth-pass Compose role and operator-guide correction

The 2026-07-22 pre-continuation review compared the checked Compose models,
resolved developer topology, process entrypoints, live container environments,
README, Gallery runbook, and current first-party platform manuals. It found no
change to the two-target architecture or to the remaining Cloudflare acceptance
gates, but it found two stale operator-facing descriptions and one real local
authority leak.

The canonical Compose graph already represents PostgreSQL, private MinIO,
one-shot object-store initialization, Mailpit, one-shot migration, API HTTP,
maintenance/authentication-email, content-only HTTP, resident processing, and
Web/Caddy as separate roles. The previous environment anchors nevertheless gave
migration, maintenance, and content roles configuration owned by other roles;
the Gallery overlay also passed the Turnstile secret to content-only serving.
The role-specific environment declarations now remove that recombination, and
the content entrypoint consumes declared challenge readiness without receiving
the challenge secret. Focused contract tests and a live canonical start prove
the distinct entrypoints, one-shot completion gates, absence of Compose
profiles, and the resulting least-authority environment inventory.

The README now names the complete local role graph instead of collapsing it to
Web, API, Worker, PostgreSQL, MinIO, and Mailpit, and its project map identifies
`deploy/` as the owner of deployment composition and automation. The Gallery
runbook no longer describes an opt-in or default Compose profile: the developer
controller always loads the checked Gallery-local overlay, while Gallery
availability remains independently fail-closed on policy, bootstrap, topology,
and live-readiness evidence. This corrects operator language without promoting
Compose to a production target or treating local isolation as Kubernetes or
Cloudflare qualification.

The official-contract refresh reconfirmed the remaining provider boundaries:
Cloudflare Containers have no Workers Free allocation and are billed only under
Workers Paid; Hyperdrive `verify-full` requires the database hostname to match
the certificate and uses an uploaded region-specific single CA certificate;
and `resend.dev` remains a testing sender restricted to the Resend account's own
address or Resend's simulation recipients. Those paths exercise provider
outcomes without qualifying an operator-owned sending domain. None of those
facts is inferred from local Compose evidence.

The same local run qualified Docker Compose `5.1.2` against the checked
capability baseline. The controller now refuses its first mutation unless the
selected client exposes `up --wait`, `--wait-timeout`, and machine-readable JSON
`ps`, and accepts the topology's long-form `service_healthy` and
`service_completed_successfully` conditions through quiet model validation.
Every startup uses a 120-second wait bound, verifies all eight resident roles
as running and healthy from parsed `ps` evidence, and then independently probes
Web, API, content, Mailpit, and SMTP from the host. The recorded version is
evidence, not an exact-version lock: another version must pass the same feature
checks before mutation.

## Tenth-pass plan and implementation checkpoint

The 2026-07-22 pre-continuation review re-read the proposal, design, all delta
specifications, tasks, durable product and module documents, current prototype
baseline, and first-party Cloudflare, Resend, and Docker Compose manuals before
allowing more implementation work.

One provider-term ambiguity was corrected. Cloudflare's inbound Worker request
body limit is selected by the Cloudflare account plan (for example Free or Pro),
not by the independent Workers Free/Paid entitlement. The current 50 MiB Upload
still fits the documented 100 MB minimum account-plan tier, but the value remains
release-static evidence rather than a live measurement. The design, platform
audit, and superseded cost-research snapshot now name both plan dimensions
explicitly so `doctor` cannot infer a body limit from Container or Workers Paid
availability.

The review initially refused to advance Compose task 13.6 from partial
implementation evidence. A live isolated `mise run api-test` proved the
404-test API suite and the account-entry SMTP contract against dynamically
discovered loopback endpoints, then exposed that the new test ingress returned
the Web SPA document with `200` for `/assets/app.js` where the checked direct-API
contract requires `404`. The implementation retained that contract and added a
test-only `api.localhost` Host route on the already frozen ingress port rather
than weakening the route expectation.

The corrected live run passed all 404 API tests, the account-entry SMTP contract,
and the complete Artifact-flow contract. Machine-readable before/after evidence
proved that phase two neither recreated the four endpoint-layer containers nor
renumbered any of their five loopback bindings. Cleanup removed the complete
`shareslices-test` project and its two volumes. The simultaneously healthy
developer control retained the same eight container IDs, the same PostgreSQL and
object-storage named-volume IDs, and passing Web, API, content, Mailpit, and SMTP
probes. This completes the dynamic-endpoint and non-recreation scope of task
13.6; the stronger crash-recovery, E2E, provider-neutral evidence, and full cold
lifecycle requirements remain in tasks 13.7-13.10.

No new production target, hybrid topology, reduced Cloudflare target, or relaxed
thumbnail/email/domain gate was introduced. Compose remains local/test-only;
Kubernetes and Cloudflare remain mutually exclusive production choices; and the
current Workers Free plus R2 plus `workers.dev`/`resend.dev` setup remains a
non-qualifying prototype profile.

## Eleventh-pass mutable-evidence correction

The 2026-07-22 documentation-only review re-read the active proposal, design,
all delta specifications, task dependencies, durable deployment policy and
terminology, module ownership, the superseded cost research, and the existing
prototype evidence before more implementation work. It also refreshed the
implementation-relevant first-party manuals and ran the real repository gates:
`mise run docs-check`, `mise run spellcheck`, `pnpm run docs:refs`,
`pnpm run docs:links`, and strict OpenSpec change validation. The repository
does not expose separate `mise run docs-lint`, `docs-refs`, or `docs-links`
tasks; durable instructions must use the checked entry points above.

No product or architecture contradiction was found. The two production targets
remain mutually exclusive; Compose remains local/test-only; Kubernetes may use
an optional external CDN without becoming the Cloudflare target; and the
Cloudflare target still requires paid trusted processing even when thumbnail
qualification is deferred. Direct Static Assets requests remain free and
unlimited, while Worker-first routes consume Worker allowance and may return
`429` on Workers Free exhaustion. Containers still have no Workers Free
allocation. `resend.dev` remains a restricted prototype sender whose real sends
can target only the Resend account's own email address; documented simulation
addresses test event paths without proving external delivery. It is not a
substitute for the production verified-domain gate. Supabase Free projects may
still pause after low activity, and transaction-pooler connections still require
prepared statements to be disabled.

One documentation defect was corrected: the file named “current prototype
execution baseline” presented a dated provider snapshot prominently enough that
a later implementation could mistake it for live inventory. The baseline now
separates its 2026-07-21 historical snapshot from a 2026-07-22 read-only refresh,
makes a failed refresh explicitly `unknown`, and forbids automatic fallback to a
previously observed project or ambient credential. The refresh confirmed
Wrangler authentication and an empty returned R2 bucket list at that instant,
but the Supabase management request failed with a transport error and the current
shell did not expose the Resend verifier's explicit key-file variable. Those
facts block only the corresponding live prototype invocation; they do not block
local Compose, provider-neutral, or Kubernetes work and do not weaken any
production gate.

At the time of this documentation-only pass, the repository-wide spell check
still reported one word in the already-uncommitted Compose test code. The
subsequent implementation batch corrected that spelling without weakening the
gate, and the current repository-wide spell check passes. The checked Markdown,
documentation-reference, documentation-link, and OpenSpec validation commands
listed above also pass.

## Twelfth-pass fixed-project crash-recovery acceptance

The 2026-07-22 task 13.7 acceptance run started the canonical isolated API test
controller while the developer project remained a live control, then terminated
the controller with `SIGKILL` after the complete `shareslices-test` role graph
had been created. The crash left eleven test containers, the project network,
and both test volumes. Every inspected resource carried the exact repository,
topology, endpoint, Engine, and project ownership markers; no developer resource
was part of that inventory.

A second `mise run api-test` reclaimed the dead process locks, acquired the
endpoint/project and Engine/project locks, positively matched the stale resource
inventory, removed only that project and its volumes, and provisioned a fresh
run. The recovered run passed all 404 API tests, the account-entry SMTP contract,
and the Artifact-flow contract before removing every test container, network,
and volume. Focused tests separately prove that a missing or mismatched marker
fails before cleanup and that an incomplete cleanup reports the exact remaining
resource without hiding the primary test failure.

The developer control retained the same ten Compose container IDs, the same two
named-volume IDs, and passing Web, API, content, Mailpit, and SMTP probes across
the crash and recovery run. This completes task 13.7 without claiming the wider
controller race matrix, read-only/write verification split, Web E2E acceptance,
or cold lifecycle work owned by tasks 13.8-13.10.

## Thirteenth-pass local verification routing acceptance

Task 13.8 removed the remaining supported path that could execute stateful Web
E2E against the developer project. `mise run web-e2e` now enters the same
endpoint/project and Engine/project locked `shareslices-test` controller used by
API integration, provisions Engine-assigned loopback endpoints, migrates a fresh
test database, injects the frozen Web, API, and Mailpit addresses into
Playwright, and removes only the positively owned test project and volumes.
Playwright configuration and the stateful CLI-authorization and Signup flows now
refuse to start without those injected addresses; no checked E2E path retains a
developer-port fallback.

The live acceptance run passed all 27 desktop Chromium E2E cases, including
registration and authentication-email verification, CLI authorization approval
and denial, Upload, Preview, Publish, stable Viewer access, Unpublish,
replacement, account sign-out, and occupied-email behavior. Before and after
the run, the developer control retained the same eight running container IDs,
the same two named volumes, and passing Web, API, content, Mailpit, and SMTP
readiness. The isolated test project, network, and volumes were absent after
cleanup.

Developer `dev-status` remains read-only and now emits contract-derived stable
`not_applicable` evidence for Kubernetes network policy/CNI, Kubernetes external
CDN, Workers Static Assets, Workers Cache API, R2, Hyperdrive, Queues,
Containers, Resend, and the generic Cloudflare provider-control-plane row. The
shared fixture and scenario projection are tested together, so a missing,
renamed, or reason-code-divergent row fails the deployment-contract gate. This
completes the read/write routing and local provider-applicability boundary; the
larger controller matrix and cold lifecycle acceptance remain tasks 13.9 and
13.10.

## Fourteenth-pass Compose controller matrix acceptance

Task 13.9 exercised the checked developer topology with the actual selected
Docker Compose parser using only `config --quiet`; the command returned zero
stdout bytes, so no resolved developer model or interpolated value entered the
evidence. Full JSON model inspection remains confined to the hermetic test
fixture and is validated in memory without a persisted model, environment dump,
hash, or after-the-fact redaction path.

The focused matrix now contains 50 passing controller tests. It covers exact
ordered developer and test file lists, project directory and project names,
relative client/TLS path freezing, mutable context exclusion, explicit Engine
identity bracketing, reset before/during/after mutation, lock release followed by
replacement-Engine recovery, and same-Engine alias coalescing. It also proves
that automated tests discover only a local Unix socket, exclude caller Docker,
Compose, application, provider, CI, agent, shell-injection, package-manager, and
unrelated Secret-like variables, while retaining the exact checked fixture
values.

The same matrix covers the pinned Compose feature baseline, quiet validation
before mutation, readiness failure, canonical developer-volume preservation,
two-phase dynamic loopback allocation, duplicate-port rejection, endpoint-layer
non-recreation, external/shared-resource rejection, fixed-project ownership,
positive-only crash recovery, exact leftover diagnostics, cleanup-error
preservation, distinct browser sites, developer-default endpoint rejection, and
production-target rejection. Together with the task 13.7 live `SIGKILL` recovery
and task 13.8 live E2E isolation runs, this completes task 13.9 without claiming
the cold lifecycle sequence required by task 13.10.

## Fifteenth-pass provider-state and document-alignment review

Before further implementation on 2026-07-22, the durable product contract,
deployment vocabulary, module status, proposal, design, delta specifications,
task dependencies, provider evidence, and current local-Compose implementation
were compared again. Current first-party Cloudflare, Resend, and Supabase manuals
were refreshed rather than treating prior account observations or price tables as
live facts.

No architecture or policy correction is required. Kubernetes and Cloudflare
remain mutually exclusive production targets; optional external CDN delivery
does not turn Kubernetes into the Cloudflare target; Compose remains local and
test-only. Cloudflare Edge/CDN remains explicit, with directly served hashed Web
assets cacheable and every dynamic or authorization-sensitive outward response
preserving its `no-store` contract. `_headers` applies only to Static Assets;
Worker-generated responses must attach their own authoritative headers.

The Free prototype boundary also remains unchanged. Workers Free can exercise
Static Assets, Worker, Hyperdrive, Queue, R2, and Resend test-mode interfaces
within their separate limits, but Cloudflare Containers have no Free allocation
and the complete target still requires trusted processing even if thumbnail work
is deferred. `resend.dev` can prove bounded API acceptance and documented test
outcomes but cannot replace an operator-owned verified sending domain. Supabase
Free is suitable only for feasibility work because low activity can pause a
project and the plan does not establish production backup or availability
evidence.

One mutable-evidence defect was corrected. A later read-only Supabase refresh
successfully returned one unlinked healthy Free feasibility project, superseding
the earlier management-transport `unknown` observation. The repository is still
unlinked, so automation must receive an exact project reference and may not
select or create a project implicitly. Wrangler authentication and an empty R2
bucket-list response were also reconfirmed, but neither proves Workers Paid,
Container entitlement, quota headroom, or complete provider inventory. The
current process still lacks an explicit `RESEND_API_KEY_FILE`; the operator's
stored key must be injected by readable file reference rather than discovered
from ambient state.

These corrections change only execution readiness, not scope or acceptance.
Tasks 1.7, 1.8, 1.9, the positive Hyperdrive `verify-full` portion of 5.3, owned
production domains, and full Cloudflare staging qualification remain open. Local
Compose and provider-neutral implementation may continue without weakening
those gates.

## Sixteenth-pass canonical Compose lifecycle acceptance

Task 13.10 exercised the complete canonical lifecycle against the real local
Engine. A data-preserving `mise run dev-down` removed the developer containers
and network while retaining both named volumes. A cold `mise run dev`,
`mise run dev-status`, and a repeated `mise run dev` all passed the checked
Compose capability gate plus the Web, API, content, Mailpit, and SMTP host
probes. PostgreSQL retained its 77 public tables across the stop/start sequence,
and both volume creation timestamps remained
`2026-07-15T14:25:55+08:00`.

While the developer project remained the healthy control, `mise run api-test`
passed the API 404 suite, authentication-email SMTP contract, and complete
Artifact-flow contract through Engine-assigned `shareslices-test` endpoints.
The separate `mise run web-e2e` acceptance passed all 27 desktop Chromium cases
through the same isolated controller. The latter covered account email, CLI
authorization, Upload, Preview, Publish, Viewer, Unpublish, replacement, and
Gallery isolation behavior without using canonical developer endpoints.

Immediately before and after the final E2E run, the developer control retained
the same eight container IDs:

- `3c2e39454654` maintenance
- `3e696224b44c` object storage
- `3eecfaa58e53` Gallery content
- `4f9a28efb258` Mailpit
- `8cbd5b6861f3` PostgreSQL
- `cd4ee5b3fd45` worker
- `dd9ead743e02` API
- `e204193e073c` Web

The controller then removed every `shareslices-test` container, network, and
volume. Its cleanup completed before acceptance was evaluated; no global or
pre-emptive cleanup was used. The developer project was finally stopped through
`mise run dev-down`, leaving no ShareSlices container running while preserving
the two canonical named volumes and their creation timestamps. This live
diagnostic evidence is separate from the ordinary `mise run check` gate, which
also passed while the required local database dependency was temporarily up.

## Seventeenth-pass shared Secret lifecycle acceptance

Task 3.4 now keeps deployment configuration and artifacts at the logical
reference plus operator-controlled revision boundary. Resolution occurs only
inside the consuming callback, changed revisions select only declared consuming
roles, and the callback boundary recursively removes both the resolved value and
its supported SHA-256 representations from render-, plan-, record-, and log-like
results. A provider failure is converted to a stable Secret-operation error whose
message is redacted and whose original Secret-bearing cause is not retained.

Shared signing-key rotation now models the overlap explicitly. Verifiers first
accept old and new revisions, producers then sign only with the new revision,
and old verification remains until the mixed-runtime window plus the longest
declared token, grant, or Session lifetime has elapsed. Missing overlap support,
missing lifetime evidence, invalid values, and overflow refuse online rotation
instead of guessing a retirement time. Focused tests cover parsing, deferred
resolution, all outward evidence shapes, error redaction, targeted rollout, the
three rotation phases, and fail-closed lifetime handling.

## Eighteenth-pass shared plan and status acceptance

Tasks 3.8 and 3.10 now satisfy the target-neutral lifecycle contract. The plan
binds its digest to the desired release and exact observed revision, orders
control, prerequisite, migration, private-runtime, public-runtime, verification,
and retirement actions, and records drift, replacement, security-sensitive, and
destructive classifications deterministically. First installation authorizes
only the checksum-bound deployment-control bootstrap transition.

The review found and corrected one prerequisite-ownership defect: an absent or
drifted external PostgreSQL, object-storage, email, cluster, or provider
prerequisite can no longer become a `create`, `update`, or `replace` action.
Plans now report `prerequisite_missing` or `prerequisite_drift` and refuse with a
stable reason, while deployment-owned durable replacements remain separately
destructive and refused. Focused tests prove all three boundaries.

Status projects desired, external-handoff, observed, phase-blocked, partial,
failed, indeterminate, verified, drifted, and orphaned states with stable reason
codes. Optional CDN, thumbnail, email, processing, or Gallery capabilities remain
separate from core release state, so an unavailable optional capability cannot
silently become verified and cannot erase an otherwise accurate core status.

## Nineteenth-pass deployment-control store acceptance

Task 3.11 now provides the checksum-verified external-PostgreSQL control schema,
advisory-locked first-install bootstrap, lease heartbeat, monotonic fencing,
phase journal, stale-writer rejection, and active/previous release mirrors. A
retry after an ambiguous bootstrap response reconciles against the exact
installed checksum and complete table set; a partial or mismatched installation
rolls back and fails closed without provider mutation.

The review corrected two persistence hazards. Historical phase rows no longer
foreign-key the single current-operation row, so advancing that row to a new
operation cannot either fail or rewrite prior journal identity. An unexpired
lease can now be resumed only by the exact same owner and operation ID without
advancing its fence; a different operation ID is refused even when it presents
the same owner string. After expiry, acquisition advances the fence
monotonically.

Release mirrors are written only in a transaction that first locks and proves
the live installation, operation, owner, target, and fencing token. They contain
only target, immutable release/bundle/configuration digests, and sorted logical
Secret revision identities. Embedded Secret values, malformed digests, equal
active/previous releases, or a stale fence fail before the mirror is changed.

## Twentieth-pass recoverability-evidence acceptance

Task 3.15 now validates complete recoverability evidence for PostgreSQL, object
storage, IaC state, release bundles, and the deployment journal. Missing owner,
encrypted location, retention, observation time, maximum age, RPO, or RTO is
invalid rather than accidentally current; missing, future-dated, and stale
observations remain distinct fail-closed results.

The consistency cut is represented by one canonical marker binding installation,
database revision, object revision, creation time, and content-derived cut ID.
The Deployment Module writes that exact marker through write-once database,
object-storage, and recovery-manifest stores, then reads all three back and
requires byte-equivalent identities and a valid recreated digest. A repeated run
is idempotent when every store already contains the same marker. An unknown write
outcome, missing copy, changed revision, mismatched cut, or invalid store
interface fails without claiming recoverability or repairing evidence by
overwriting an existing marker.

## Twenty-first-pass release inventory and retirement acceptance

Task 3.13 classifies expected release resources, digest drift, ownership-marker
mismatch, and resources absent from inventory without treating an untrusted
resource as deployment-owned. Only a superseded resource declared as
Deployment-Module-owned, active-retention, and outside every retained rollback
release becomes a retirement candidate; external prerequisites, durable data,
rollback artifacts, unknown resources, and marker mismatches remain report-only.

Retirement authorization now additionally requires the replacement release to
be verified. Traffic is detached first, then scheduling is detached and its
qualified provider safety window elapses, then inactivity is proven before the
owned resource is removed. A missing schedule safety interval or an unverified
replacement refuses authorization with a stable reason rather than delegating
that safety decision to a target caller.

## Twenty-second-pass pre-implementation documentation alignment

The 2026-07-22 documentation-only review paused implementation and compared the
current product contract, module design, active change, task state, and provider
evidence with the current first-party Cloudflare, Supabase, and Resend manuals.
No target-boundary change is required: Kubernetes and Cloudflare remain
alternative production compositions, Compose remains local/test-only, and an
optional external CDN does not turn Kubernetes into the Cloudflare target.

The provider boundary also remains unchanged. Cloudflare Static Assets requests
served directly are free and unlimited, but Worker-first routes still consume
Workers allowance and can return `429` after Workers Free exhaustion. Containers
still have no Free allocation and require Workers Paid; their requests also incur
the backing Workers and Durable Objects usage. Supabase Free still provides a
feasibility database but may pause after insufficient activity and provides no
automatic-backup production guarantee. Resend's `resend.dev` sender remains
test-only and can send a real test message only to the email address associated
with the Resend account; production delivery to other recipients still requires
an operator-owned verified domain. These are current external facts rather than
durable ShareSlices policy and must be refreshed again at target qualification.

Two repository-state ambiguities were corrected. The Deployment Module status no
longer describes the completed Kubernetes Kustomize composition, deterministic
renderer, security baseline, and read-only Adapter surface as mere examples; it
also continues to distinguish those implemented pieces from the still-missing
mutating lifecycle and target qualification. The general Viewer policy now says
that outward Viewer and Preview responses remain non-cacheable while preserving
the separately accepted authorization-first internal immutable-byte reuse. This
prevents an implementation from either caching an authorization-sensitive
response or unnecessarily deleting the explicitly approved internal cache seam.

No task checkbox advances from this document review. In particular, Kubernetes
tasks 10.1 and 10.2 still need their complete live prerequisites and real-cluster
evidence, Cloudflare tasks 1.7-1.11 and 11-12 retain their Paid/domain/provider
gates, and a stored Resend key alone does not prove a verified sending domain,
tracking posture, key scope, or production acceptance. Implementation may resume
only against these unchanged fail-closed boundaries.

## Twenty-third-pass production plan-application acceptance

Task 3.9 now connects the previously tested phase engine to the production
deployment entrypoint. `apply` reads a canonical plan artifact, verifies its
content digest, target, release, and rendered bundle digest before target
mutation, then resolves the direct PostgreSQL credential only within the
operation boundary. The production controller performs the one authorized
control-schema bootstrap when required, acquires or resumes the deterministic
operation lease, re-observes the target revision, heartbeats the fence before
mutations, and records running, completed, failed, indeterminate, or external
handoff checkpoints in PostgreSQL.

Kubernetes resources now carry an installation/owner marker and a digest of the
desired resource before that digest annotation is attached. Planning compares
only those checked annotations from resources whose ownership markers match;
same-named unowned resources fail closed. The production observer reads the
database Secret through an explicit `SHARESLICES_SECRET_ROOT`, requires its host
to match the declared `verify-full` PostgreSQL endpoint, and combines the
deployment-control revision with Kubernetes resource versions into the observed
revision. Missing Secret roots or deployment principals fail without falling
back to ambient credentials.

The Kubernetes Adapter can now execute authorized direct phases with
server-side apply, wait for the one-shot migration Job, and wait for each
Deployment rollout. GitOps mode returns an immutable phase handoff without a
cluster write. This does not complete Kubernetes task 10.3 or 10.6: isolated
network probes, verification, release recording, safe retirement, observed
status, rollback, predecessor evidence, and real-cluster acceptance remain open.

The durable module map and this change design now use the same status model:
the Deployment Module is mixed because several parts are current, while
both production targets remain unavailable until their own complete acceptance
gates pass. In particular, the presence of a direct mutation path is not release
qualification, and the presence of a GitOps handoff is not evidence that an
external reconciler promoted or converged it.

## Twenty-fourth-pass Kubernetes status observation acceptance

The production Kubernetes status path now reads active and previous release
records, the current fenced operation, and its phase journal from PostgreSQL,
then lists only installation-labelled Deployments, Pods, Jobs, Ingresses, and
ConfigMaps in the configured cluster context and namespace. It reports workload
generation and readiness, runtime image IDs observed from owned Pods, the
release-scoped migration checksum and schema head, configuration and route
digests, release-marker drift, ownership mismatches, and external-CDN readiness
as machine-readable status evidence. An unavailable cluster observation is
`indeterminate`; an unrecorded release marker, missing resource digest, or
configuration mismatch is drift rather than inferred success.

The renderer now propagates installation, release, and owner labels into
Deployment Pod templates so image observations retain the same release and
ownership identity. ConfigMaps carry the immutable release configuration and
route-contract digests before their desired-resource digest is calculated.
These additions make status evidence addressable without placing Secret values
in Kubernetes metadata.

Task 10.4 remains open. The current projection does not yet contain live
black-box probe evidence, authoritative database schema-head comparison outside
the completed migration Job, verified release finalization, or a qualified
external-CDN observation. A recorded release plus ready Deployments is reported
as observed, not verified or release-qualified.

## Twenty-fifth-pass shared core-verifier acceptance

The shared deployment lifecycle now wires `verify` to a credential-free `core`
verifier. It loads and digests the checked verification-scenario contract, uses
only `GET` requests with omitted credentials and manual redirect handling, and
records status, cache policy, request-ID presence, referrer policy, Cookie
presence, and redirect presence without response bodies or transport exception
text. It checks trusted liveness and readiness, unknown Viewer and unauthorized
Preview `no-store` behavior, content-only liveness and readiness, invalid public
and review credential refusal, and the absence of internal and management routes
from public ingress. Redirects, response Cookies, missing required headers,
unexpected statuses, and transport failures fail closed with the checked stable
`required_check_failed` reason.

Kubernetes delegates its current `verify` command to this shared core contract
using the configured trusted and content origins. A failed required check returns
a failed deployment result; no verification request creates product data, sends
mail, changes authorization, or writes provider state.

Tasks 10.3, 10.4, and 14.1 remain open. Core HTTP success is not yet bound to a
specific release bundle or complete cluster-resource convergence, does not write
the active/previous release record, and does not cover origin-versus-edge,
network-policy, email, processing, thumbnail, CDN, Gallery, or authorized deep
verification. Those facts must remain separately unavailable or pending.

## Twenty-sixth-pass release-bound verification and finalization acceptance

Kubernetes `verify --release` now renders the immutable target bundle again,
observes every expected resource through the configured context and namespace,
and requires each owned resource digest to match exactly. It also requires the
core verifier's checked contract digest to equal the release's verification
contract digest. Missing control state, missing resources, digest drift,
contract drift, or any failed core check prevents finalization and is returned
as failed convergence evidence.

After all checks pass, production finalization resolves the database Secret only
inside the operation, acquires a deterministic verification lease with a fresh
fencing token, checkpoints the passed verification, mirrors the newly verified
release as active and the prior active release as previous, completes the exact
operation under its live fence, and increments the deployment-control revision.
The release record contains only target, release and bundle digests,
configuration digest, and logical Secret revisions. A stale fence cannot mirror
or complete the operation. A release-less `verify` remains read-only and cannot
write release records.

This completes the release-recording slice of task 10.3 but not the task as a
whole. Isolated allowed/denied network probes, pre-traffic verification,
retirement execution, optional-CDN qualification, safe failure compensation,
and real-cluster acceptance remain open. Task 10.4 also remains open until its
database-head and optional-capability evidence is complete, and task 14.1 still
requires its complete address/applicability projection.

## Twenty-seventh-pass rollback-authority prerequisite acceptance

The deployment-control release record now stores the Secret-free compatibility
and contract-revision snapshots needed for rollback: schema head, N/N-1 runtime
identity, and the deployment, database, jobs, and verification contract
revisions. Finalization preserves the prior active record with the same fields,
and observation returns them from PostgreSQL. The control-schema checksum changes
accordingly; no qualified production installation exists whose accepted schema
would be migrated implicitly.

The shared lifecycle now requires `rollback --release` to name one checked
immutable candidate. It preserves target `refused` reasons and non-mutating
`external_reconciler_required` handoffs as distinct outcomes, and rejects a
missing candidate instead of guessing the previous release.

Tasks 3.12 and 10.5 remain open. Kubernetes does not yet prove retained image
availability or current candidate Secret revisions under a rollback lease, does
not apply candidate private/public bundles, does not run post-rollback core
verification, and does not swap release records. Until those gates exist, its
target Adapter continues to refuse rollback execution rather than treating the
shared decision model as a completed rollback.

## Twenty-eighth-pass implementation-status reconciliation

The documentation-only review on 2026-07-22 stopped implementation and compared
the durable product and vocabulary owners, module map, proposal and design
context, task checkboxes, accumulated evidence, and the currently implemented
Deployment Module. It found no product-boundary conflict: Kubernetes and
Cloudflare remain alternative production targets, Compose remains local/test
only, and neither production target is release-qualified.

Four stale status descriptions were corrected. The module summary now records
that Kubernetes has direct phased apply, read-only observation, release-bound
core verification, and fenced active/previous release recording; it continues
to leave deep verification, safe retirement execution, rollback, completed
GitOps predecessor observation, optional-CDN acceptance, real-cluster acceptance,
and target qualification open. The Worker section now distinguishes implemented
Kubernetes resident-workload rendering from unqualified live execution. The
authentication-email section distinguishes rendered Kubernetes SMTP composition
from still-unproven enterprise-relay qualification. Finally, the proposal and
design now label their superseded Kubernetes-example descriptions explicitly as
proposal-time context instead of current repository state.

No task checkbox advances from this reconciliation. In particular, tasks 3.6,
3.7, 3.12, 3.14, 8.1-8.4, 8.8-8.9, 10.1-10.10, 11.*, 12.*, 14.*, and 15.* retain
their remaining acceptance criteria and external gates. Production deployment
runbooks are also intentionally absent until task 15.2 can describe a complete,
tested lifecycle; adding optimistic procedures now would turn target design into
unsafe operator guidance. The next implementation work must therefore continue
from the unchecked rollback and qualification boundaries, not from the stale
summary language corrected here.

## Twenty-ninth-pass compatibility-aware Kubernetes rollback acceptance

Tasks 3.12 and 10.5 now have an end-to-end repository implementation. A rollback
is no longer authorized by a release path alone: `plan --operation rollback`
produces a digest-bound plan for the exact candidate bundle and observed target
revision, excludes the candidate migration Job from dry-run and desired actions,
and records compatibility or predecessor refusals. `rollback` requires that
exact ready plan and release, verifies their canonical digests and identities,
and refuses stale observation before any lease or target mutation.

Direct reconciliation acquires the authoritative PostgreSQL operation lease,
rereads active/previous records, re-observes the plan revision, and fails closed
if either changed. Under the live fence it confirms every required role Secret
still exists, compares the operator-controlled candidate Secret revisions,
creates least-privilege default-denied image-pull probe Pods for each retained
OCI digest, and removes only positively owned probes. The fence is renewed before
every probe mutation and each rollback phase. Only configuration/prerequisites,
private runtimes, and public ingress are applied; no prior migration Job or down
migration is rendered into the rollback plan or applied. Runtime rollout and the
shared credential-free verification contract must pass before active/previous
release records are swapped and the operation completes. A repeated already
converged rollback returns success without a provider mutation.

The status observer now accepts the still-current completed migration Job when
its observed schema head equals the restored runtime's recorded compatible
schema head; it does not require that Job to carry the restored release ID. This
preserves truthful status after an application-only rollback. GitOps rollback
uses the same authorized-plan and compatibility checks, emits ordered prior
configuration/runtime and ingress bundles plus current-schema evidence, omits
migration, and returns `external_reconciler_required` without writing either the
cluster or a Git repository or claiming completion.

Deployment tests cover unauthorized and stale plans, unrecorded candidates,
schema/runtime/job/Secret/provider refusal, lease heartbeats and stable failed
checkpoints, idempotent repetition, image-probe cleanup and ownership, migration
omission, post-rollback verification, record swapping, compatible status, and
the migration-free GitOps handoff. Task 3.14 remains open because its complete
cross-target integration and Cloudflare conditional-mirror matrix is broader
than this Kubernetes rollback slice. Tasks 10.3, 10.4, 10.6, and the real-cluster
acceptance gates also remain open; this implementation does not qualify the
Kubernetes target by itself.

## Thirtieth-pass pre-implementation documentation audit

The documentation-only audit on 2026-07-22 paused implementation and compared
the durable product and vocabulary owners, module map, active proposal/design,
task acceptance criteria, current provider baseline, current working-tree
implementation, and refreshed primary manuals for Cloudflare Containers,
Workers Static Assets and caching, Resend test sending, and Supabase Free project
pausing.

No product-contract contradiction was found: one production installation still
selects Kubernetes or Cloudflare, never both; Compose remains local/test only;
Kubernetes may independently use an optional external CDN; and Cloudflare Edge
delivery remains part of the Cloudflare target even when optional Viewer byte
caching is disabled. Dynamic Viewer and authorization responses remain outwardly
`no-store`.

The audit found a presentation risk rather than a policy error. The intended
Cloudflare architecture, current Free-compatible prototype envelope, and
implemented Kubernetes slice were accurate but distributed across several
files. A current-implementation checkpoint now states the executable boundary
in one place: Workers Free plus R2 is prototype-only, Containers still gate
trusted processing, thumbnail deferral does not remove that gate, Supabase Free
is an optional pausable prototype PostgreSQL service rather than the target
contract, and `resend.dev` cannot qualify production mail. It also makes the
mandatory post-prototype shutdown and inventory step explicit.

The module map now calls out the remaining GitOps gap beside the implemented
handoff: external reconciliation ownership, predecessor-completion observation,
and real-reconciler qualification are not complete. Therefore task 10.6 remains
unchecked even though the current working tree can emit ordered handoff data.
No other task checkbox advances from this documentation review.

The refreshed primary manuals still support the blocking conclusions. Cloudflare
Containers have no Free-plan allocation and are included with Workers Paid;
Static Assets are automatically edge cached while Worker-first routing remains
configurable; `resend.dev` real test sending is restricted to the account's own
address; and inactive Supabase Free projects may be paused. These mutable facts
remain dated evidence and must be refreshed before live provider work and final
qualification.

## Thirty-first-pass GitOps handoff acceptance

Task 10.6 is now complete in the repository. Kubernetes deployment configuration
explicitly selects exactly one reconciliation owner: direct mode requires the
Deployment Module owner and GitOps mode requires an external owner. Invalid
crossed combinations fail schema validation before target access, and planned
resource ownership plus every apply or rollback handoff records that selected
owner.

GitOps apply journals all changed immutable phases and returns their release,
target-bundle, phase-bundle, predecessor, and exact owned-resource completion
evidence without stopping after the first handoff. It appends an observation
handoff for whole-release convergence. Status distinguishes the desired release
from the active release and reports a phase-order violation when candidate
runtime resources appear before the candidate migration checksum and schema-head
evidence.

GitOps rollback checks the authorized rollback plan and current compatibility,
emits prior configuration/private-runtime, public-runtime/ingress, and
observation bundles with the same explicit external owner, and emits no prior
migration Job. Tests prove both apply and rollback make zero Kubernetes calls in
GitOps mode; neither path writes or assumes a Git repository. The Deployment
Module still does not claim that the external operator promoted or converged a
handoff.

## Thirty-second-pass Kubernetes external-CDN contract acceptance

Tasks 10.7 and 10.8 are complete. The production schema accepts one Kubernetes
delivery mode, `direct` or `external-cdn`, and cross-validates it with the CDN
declaration. Direct mode rejects provider, origin-access, and trusted-proxy CDN
configuration. External-CDN mode requires all of them and still renders the
ordinary Kubernetes application workloads and ingress rather than any
Cloudflare-target Worker or Container.

The external-CDN declaration now records a provider-neutral origin-access mode
and evidence revision plus trusted-proxy source CIDRs, client-address header,
and evidence revision. The shared CIDR contract rejects unrestricted
`0.0.0.0/0`. Rendering produces a Secret-free ConfigMap containing those
requirements and the immutable route and cache contract digests. The generated
contract requires dynamic `no-store`, origin access, and trusted-proxy evidence;
it does not create or mutate a provider account.

Schema, Kustomize, and renderer tests prove inconsistent or incomplete modes
fail, the direct composition omits the CDN contract, the external composition
contains it, both retain the same Kubernetes runtimes, and no Cloudflare runtime
appears. Task 10.9 remains open because these deterministic contracts do not
prove a real edge obeys them or matches direct-origin behavior.

## Thirty-third-pass Kubernetes render and planning acceptance

Task 10.2 is complete. Kubernetes rendering deterministically emits Secret-free
prerequisite/configuration, migration, private workload, and public
ingress/delivery phases from one immutable release and validated configuration.
Direct and external-CDN delivery select only their matching composition.

Planning submits every non-empty phase to the explicitly configured Kubernetes
context and namespace with server-side apply dry-run, the declared field
manager, stdin input, and no persistence. A server field-ownership conflict is
reported with a stable redacted reason instead of exposing provider stderr.
Planning then binds the authoritative control/cluster observation revision and
canonical target-bundle digest into the reviewed plan; absence of authoritative
observation fails closed rather than being inferred as a first installation.

Renderer, Kustomize, Adapter, and contract tests cover deterministic output,
phase order, immutable image identities, role-specific Secrets, one migration
Job, direct versus optional-edge selection, dry-run arguments, zero persistence,
field conflicts, and missing observation. This completes render/planning for the
Kubernetes target only; shared task 3.7 and production-target qualification stay
open because the Cloudflare renderer does not yet exist and no real cluster has
passed acceptance.

## Thirty-fourth-pass Kubernetes status acceptance

Task 10.4 is complete. Kubernetes status combines the PostgreSQL deployment
record and phase journal with read-only, installation-labelled Kubernetes
Deployments, Pods, Jobs, Ingresses, and ConfigMaps. It projects desired and
observed release IDs, release-marker drift, workload and observed generations,
ready replica convergence, immutable runtime image IDs, configuration and route
digests, migration Job checksum/completion, ownership mismatches, and optional
CDN readiness.

Status now also reads the actual latest row in `shareslices_migration` through
the same read-only PostgreSQL observer. A completed Job annotation is compatible
only when its schema head and the authoritative database schema head both equal
the active runtime's recorded compatible head. Missing or mismatched database
evidence is drift, not success.

Pod evidence records Pod count, Ready count, container count, ready-container
count, restart count, and observed image IDs for each workload. This preserves
the distinction between Deployment availability and observed probe/container
health. Unreadable provider observations remain indeterminate; unrecorded
release markers, invalid resource digests, mismatched configuration or schema,
and unowned resources remain explicit drift or orphan evidence. Optional CDN is
reported disabled in direct mode and unavailable pending edge verification in
external-CDN mode rather than inferred from rendered configuration.

## Thirty-fifth-pass Kubernetes pre-traffic network-probe acceptance

The network-probe portion of task 10.3 is implemented. After direct apply has
installed prerequisite configuration and NetworkPolicies, but before migration
or application runtime activation, the Adapter creates a bounded probe set from
the release's immutable API image. API, maintenance, content, Worker, and
migration role labels exercise their declared PostgreSQL, object-storage, and
SMTP TCP paths. Each role must also fail to reach a temporary in-cluster listener
whose ingress permits the probe namespace, so an unreachable public test address
cannot be mistaken for proof of egress-policy enforcement.

Probe Pods are non-root, drop all capabilities, use a read-only root filesystem,
disable service-account-token mounting, carry bounded resources, use the
configured pull Secret reference, and receive no business Secret. Temporary
Service, listener Pod, ingress policy, and client Pods carry exact installation,
release, Deployment Module owner, and deterministic nonce labels.

The phase engine now supplies a live lease assertion to target phase operations.
The probe runner asserts it before creation and before every deletion, waits for
the listener and every client result, returns redacted per-role pass evidence,
and includes that evidence in the prerequisite checkpoint digest. Cleanup reads
each resource and deletes it only when all ownership labels still match. A failed
allowed/denied check still runs cleanup; an ownership mismatch leaves the
resource untouched and fails explicitly.

Focused tests prove allowed/denied composition, lack of Secret resources,
hardening, lease assertions, complete success cleanup, cleanup after probe
failure, and refusal to delete changed ownership. Task 10.3 remains open until
verified release retirement and the complete direct-apply acceptance chain are
implemented and exercised on a real conforming cluster.

## Thirty-sixth-pass pre-coding document alignment

The 2026-07-22 documentation-only review stopped implementation and compared the
durable deployment contract, current module map, active design and tasks, current
prototype baseline, and current first-party Cloudflare, Resend, and Supabase
manuals. It found no reason to change the two-target architecture: Kubernetes
and Cloudflare remain mutually exclusive production compositions, Compose
remains local/test-only, and optional Kubernetes CDN delivery does not select
the Cloudflare target.

One current-status defect was corrected. The design checkpoint still listed
Kubernetes network probes as missing after the Adapter and module map recorded
their local implementation. It now states that the probes exist but remain
unqualified until they pass on a real conforming cluster. Safe retirement, deep
verification, optional-CDN acceptance, real-cluster acceptance, and release
qualification remain open; no task checkbox advances from this correction.

The Cloudflare cost and shutdown contract was also made executable in the plan.
The current Containers pricing page still shows no Free allocation and bounded
included usage under Workers Paid, while Workers documentation recommends
per-invocation CPU limits against runaway usage. The Cloudflare specification
and tasks now require per-role Worker CPU limits, an emergency route/trigger
shutdown procedure, and a prototype teardown checklist with post-cleanup
inventory. Provider alerts or spend controls may be documented only when
actually observed and are never described as a universal hard billing cap.

The other external conclusions remain current: Static Assets requests that do
not invoke Worker code are not billed as Worker requests, Worker-first requests
remain subject to the Workers allowance and may return `429`, Queues Free has a
smaller fixed retention envelope than Paid, `resend.dev` can send real test mail
only to the Resend account address, and Supabase Free may pause after low
activity and does not include the production backup contract. These are dated
provider facts to refresh before live work, not durable ShareSlices guarantees.

## Thirty-seventh-pass Kubernetes retirement acceptance

The Kubernetes observer now inventories all installation-labelled managed
resource kinds in addition to the desired bundle. Only resources with exact
installation, Deployment Module owner, release, and desired-state digest markers
are treated as owned. Active and previous release resources receive rollback
retention and produce a non-executable, non-destructive `retain` plan action;
unknown or incomplete markers remain reported orphans and keep ordinary apply
fail-closed.

After the replacement release is recorded active, direct retirement rereads the
candidate and binds its API version, kind, namespace, name, digest, installation,
release, and owner to the authorized plan. It automatically handles only old
ConfigMaps, Deployments, Ingresses, and completed Jobs. Deployments scale to zero
before removal, active Jobs and other kinds require review, the operation lease
is asserted before each mutation, and deletion must be confirmed by absence.
Rollback-retained or changed resources are never mutated.

Focused tests and the complete deployment configuration gate cover retained
resource planning, phase exclusion, incomplete ownership markers, successful
old-Job cleanup, and rollback-resource refusal. Task 10.3 remains open because
its acceptance is the complete direct chain through verification, release
recording, retirement, and real-cluster evidence, not retirement alone.

## Thirty-eighth-pass pre-Cloudflare-composition documentation alignment

The 2026-07-22 documentation-only checkpoint compared the durable product
contract, active design and task list, module map, current application seams,
and current first-party Cloudflare and Resend manuals before further code work.
It found no target-boundary change: Kubernetes and Cloudflare remain alternative
production targets, Compose remains local/test-only, and Workers Free plus the
separately enabled R2 subscription remains a disposable prototype profile.

Two module-status statements had fallen behind the code and are corrected
without advancing a task checkbox. First, cache-disabled Hyperdrive now exposes
the same checked-out-client shape needed for a bounded transaction or fenced
email attempt. This does not make advisory locks, migrations, arbitrary session
state, or trusted processing eligible for Hyperdrive; those operations retain
their explicit direct-mode requirement, and task 5.3 still requires live
transaction, freshness, connection-budget, prepared-statement, timeout, and TLS
identity evidence. Second, the shared Resend HTTPS transport, durable
provider-attempt fence, strict non-sensitive Queue wake envelope, bounded
Queue/scheduled drains, and binding-based authentication-email composition now
exist. They do not constitute a production Jobs Worker or complete tasks 4.4,
6.1, 6.5-6.7, 7.5, or the Cloudflare deployment sections: production exports,
retry classification, reconciliation, outbox publication, provider bindings,
IaC ownership, and live qualification remain open.

The first-party refresh also confirms that Queues and Hyperdrive are available
on Workers Free with limited allowances: Queues currently includes 10,000
operations per day with fixed 24-hour retention, and Hyperdrive includes 100,000
database statements per day. These mutable limits explain which bounded
prototypes are possible; they are not production compatibility constants and do
not offset the 10 ms Free Worker CPU ceiling or the absence of a Free Container
allocation. Directly served Static Assets remain free, while Worker-first paths
consume Worker allowance. Resend idempotency remains a 24-hour retry aid, and
`resend.dev` remains restricted to test sending to the account email or
documented simulation recipients. No domain, arbitrary-recipient, inbox, quota
headroom, or production-readiness claim follows from the stored API key.

No provider service was started during this documentation audit. Therefore no
shutdown action or new account-state observation is claimed; the historical
prototype baseline remains subject to a fresh read-only inventory before the
next opt-in live experiment.

## Thirty-ninth-pass transactional wake-outbox acceptance

Task 7.5 is complete. Migration `0030` creates one non-sensitive PostgreSQL
dispatch record in the same transaction as each authentication-email, Artifact
processing, bundle-thumbnail, Gallery-safety, Gallery-cover, or Gallery-copy job
insert, including jobs produced by either the Node API or Rust Worker. The
trigger path stores only the lane and durable job ID; it stores no email body,
recipient, credential, Artifact bytes, or authoritative job payload.

The bounded publisher claims records with `FOR UPDATE SKIP LOCKED`, assigns one
stable wake UUID, increments a fence, releases the transaction before the Queue
call, and records publication only while the owner, fence, and wake still match.
An indeterminate Queue response returns the row to pending while preserving the
same wake UUID, so a later publication creates only an at-least-once duplicate
wake. PostgreSQL job state remains authoritative. Focused integration coverage
proves trigger installation for all six producer tables, real
authentication-email insertion, strict wake shape, fenced completion, and
same-identity replay after a simulated lost Queue response.

This does not complete Queue deployment or recovery. Target-specific binding,
scheduled recovery and pruning, DLQ visibility, stale/lost/reordered wake
drills, and the Container controller remain tasks 4.4, 7.7-7.10, 11, and 12.
The outbox itself does not qualify a Cloudflare target or start a provider
resource.

## Fortieth-pass route-free Jobs export and Supabase refresh

The Jobs runtime factory now lives outside the HTTP runtime graph. Focused
dependency tests caught and removed an earlier transitive import of the content
Hono logger, so the route-free Queue/Cron bundle imports neither trusted nor
content HTTP builders, resident startup, process environment readers, nor the
Node database singleton. Its default export exposes only `queue` and
`scheduled`; it has no public `fetch` handler. The current composition handles
authentication-email wakes and scheduled outbox publication with
binding-provided Hyperdrive, Queue, Resend, configuration, and Secret values.

This remains partial task 4.4 evidence rather than task completion. Artifact,
thumbnail, alias, and Gallery lanes still need their bounded handlers or
Container controller; reconciliation and scheduled-execution gating remain
open; generated Wrangler/IaC bindings and live provider deployment remain
absent. No Cloudflare resource was started by this local implementation.

After explicit operator confirmation of Supabase CLI login, a read-only CLI
refresh found one unlinked healthy Free feasibility project using PostgreSQL
17.6.1. That proves current management-plane visibility only. It neither links
the repository nor proves password access, Hyperdrive runtime connectivity,
TLS hostname/certificate identity, backup/recovery, or production availability.

## Forty-first-pass pre-code documentation alignment

A fresh read-only refresh reconfirmed Wrangler authentication, empty R2 and
Queue lists, one retained private cache-disabled Hyperdrive using TLS `require`,
and one unlinked healthy Supabase PostgreSQL 17.6.1 project. The verifier process
still exposes no Resend key reference. The prototype baseline now presents these
as one current snapshot instead of three superseding same-day narratives, while
retaining failed refreshes only as a fail-closed design lesson.

The Jobs documentation now records the current accepted-lane boundary: the
route-free publisher handles authentication-email work only, and unsupported
outbox rows remain pending until the matching handler or Container controller is
registered. The task list requires allowlist expansion and consumer registration
to land atomically. Resend wording now distinguishes account-email test sends
from documented simulation addresses and preserves the verified-domain and
inbox-delivery gates. No provider resource, service, email send, or application
code change was part of this pass.
