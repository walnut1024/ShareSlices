# Official platform audit: local Compose and production deployment targets

<!-- cspell:words Hyperdrive predeclare rollouts secretless underspecified workerd -->

Audit date: 2026-07-19

Reality recheck: 2026-07-21. See
[document-reality-audit.md](document-reality-audit.md) for corrections to
Terraform provider pin evidence, Worker-limit source classification,
Terraform/Wrangler Worker-field ownership, Hyperdrive TLS evidence, and current
Resend rate-limit wording.

## Scope and verdict

This audit checks the canonical local Docker Compose topology and the Cloudflare deployment target, including its Resend HTTPS Adapter, against current first-party product manuals and API references. It also checks the Kubernetes deployment primitives that the target relies on; provider-specific managed-cluster behavior still requires a representative conformance run.

The proposed Cloudflare architecture is **conditionally feasible, but support remains gated on disposable-account qualification**. Its principal components exist and fit the intended roles: Workers with Static Assets, private R2, cache-disabled Hyperdrive, Queues, Cron Triggers, Containers, staged Worker versions and Secrets, and Resend over HTTPS. The following assumptions require implementation-blocking evidence rather than inference:

1. Cloudflare documents VM-level Container isolation, but not the Kubernetes-equivalent process controls required by the proposal (capability dropping, seccomp profile, privilege-escalation prevention, and separate network policy for Chromium).
2. A thumbnail Container cannot both use direct PostgreSQL TCP and prove that untrusted Chromium cannot reach PostgreSQL merely through `enableInternet` or `allowedHosts`; those controls apply to the Container network, not separately to the Rust process and Chromium child process.
3. This design chooses Durable Object `exports` for the Jobs Worker. The current Durable Object manual says configuration containing `exports` fails `wrangler versions upload`, while Wrangler behavior is actively evolving. The qualified default therefore uses immediate Jobs `wrangler deploy` with Queue delivery paused and Cron detached, followed by observed Container rollout; every pinned toolchain must reconfirm the interface, and the manuals do not establish an atomic Worker-and-Container switch.
4. `nodejs_compat` does not make arbitrary Node.js dependencies compatible. The exact Better Auth, Drizzle, PostgreSQL driver, archive-processing, and storage paths must pass a workerd compatibility harness.
5. A single Worker HTTP request cannot exceed the Cloudflare account-plan request-body limit. The current default 50 MiB artifact limit fits the current 100 MB Cloudflare Free/Pro account-plan tier, but this classification is independent of the Workers Free/Paid entitlement. Deployment-configurable limits above the account ceiling require either validation that rejects the configuration or a new client-side multipart protocol.

The Cloudflare target also requires Workers Paid because Containers are not available on the Free plan. It can be low-cost and scale-to-zero, but it is not an entirely free deployment target.

## Reconciliation applied to the change artifacts

The proposal, design, specifications, and tasks were revised after this audit:

- Cloudflare is now explicitly a Workers Paid, entitlement- and live-limit-qualified target rather than an assumed free deployment.
- Thumbnail execution now uses a separate secretless Rust/Chromium Container and a private jobs-Worker execution broker. A browser-visible capability can only read fixed manifest bytes; a different controller/output capability owns heartbeat, upload, and fenced commit and never enters an Artifact-visible surface.
- Trusted non-browser processing may retain a direct PostgreSQL path, but private or public reachability is a separate capability gate and does not establish thumbnail readiness.
- Worker dependency compatibility, request-body limits, Container image availability, rolling mixed-version behavior, route-free fetch-Service-Binding exact-version and Jobs functional verification, trigger-isolated Jobs deployment, and rollback retention are implementation-blocking disposable-account gates.
- Terraform, Wrangler, the operator Secret source, and the Deployment Module now have field-level ownership boundaries, including explicit treatment of routes, Queue consumers, queue delivery pause/resume, Cron triggers, ordinary and Secret bindings, Durable Object migrations, Container settings, operation fencing, and the deployment-state object.
- Cloudflare Edge/CDN is now an explicit module. Static Assets caching is separated from the data-center-local Cache API; the optional Viewer byte cache uses a separate cacheable full-body representation only after current Publication authorization, Range/206 bypasses it, and private R2 remains inaccessible through `r2.dev` or a public bucket domain.
- Resend now has a minimum HTTP contract, provider-acceptance semantics, logical-delivery idempotency before a conservatively frozen cutoff inside the 24-hour retention, error-type classification, disabled authentication-mail tracking, no first-release delivery webhooks, and explicit provider-side retention disclosure.
- Kubernetes planning now requires server-side dry-run. Read-only `doctor` checks declared CNI and evidence, while an explicitly authorized isolated pre-traffic phase proves actual policy enforcement and admitted Pod security settings before activation.
- Docker Compose is now explicit as the only non-production development/test topology rather than a third deployment target. Its four supported `mise` lifecycle commands remain stable, its composition and controller policy move under `deploy/`, and its role graph evolves with the runtime seams.
- Compose readiness now distinguishes start order, service health, successful one-shot completion, `up --wait`, and host reachability. Automated tests require isolated project identities and exact-project volume cleanup, while ordinary developer shutdown preserves named volumes.

## Decision matrix

| Area | Status | Official reality | Required change or gate |
| --- | --- | --- | --- |
| Workers application runtime | Conditional | Workers supports a documented subset of Node.js APIs under `nodejs_compat`; unsupported APIs may be stubs that throw or do nothing. Hono and Better Auth both document Workers support, with Better Auth requiring Node compatibility/AsyncLocalStorage support. | Keep the runtime compatibility spike. Exercise the real production dependency graph and all auth/database/storage paths; do not infer compatibility from build success. |
| Static Assets routing | Supported with configuration | Assets are served before Worker code by default. `run_worker_first = true` or route patterns are required when dynamic routes must take priority. | Declare the exact dynamic route families in Wrangler configuration and test that no asset shadows them. |
| Static Assets caching | Supported | Static Assets are automatically cached across Cloudflare's network and use tiered caching between edge locations and asset storage. | Treat content-hashed build assets as immutable-cache eligible, keep HTML/bootstrap release-coupled, and verify asset/version consistency during rollout. |
| Optional Viewer byte cache | Supported with authorization-first design | The Workers Cache API is data-center-local, `cache.put()` does not participate in tiered caching, rejects `206`, and rejects responses whose cache policy forbids storage. | Keep stable Viewer responses dynamic and `no-store`; authorize first, store only a separate bounded full-body representation, bypass Range/206, measure R2 reads, and make the feature optional. |
| Dynamic response caching | Supported with verification | Workers caching honors `Cache-Control: no-store` and `private`, but enabled caching can heuristically cache responses without explicit directives. More-specific Cloudflare cache headers may override ordinary `Cache-Control`. | Require explicit `no-store` on authenticated/dynamic responses and verify that no cache rule or Cloudflare-specific header overrides it. |
| Versioned assets | Supported | A Worker version includes code, Static Assets, bindings, and compatibility settings. Associated R2/Queue/database state is not versioned. | The proposal's application-only rollback boundary is correct. Preserve compatible backing resources during rollback windows. |
| Worker Secrets | Supported with split release paths | App and Content can upload Secrets with a zero-percent ordinary-traffic candidate. Ordinary `wrangler deploy` preserves existing encrypted Secrets, and `wrangler deploy --secrets-file` can update Jobs Secrets during the same immediate deployment. Omission does not delete an existing binding. `wrangler secret delete` creates and immediately deploys a new version, while the official contract does not guarantee that versioned-Secret or deletion commands preserve a configuration using Durable Object `exports`. | An upgrade candidate is still selectable through an existing route with a version override, so it must already enforce production security. Preserve or update Jobs Secrets only in trigger-isolated deploy. Retire a Jobs binding only after rollback retention and qualification proves the code, configuration, `exports`, image, and retained bindings are unchanged; keep triggers isolated and re-add from the operator source or forward-fix if post-deletion checks fail. |
| Route-free staged verification | Supported with a dedicated harness | A version in the current deployment can receive 0% ordinary traffic and be selected by the version-override request header. A fetch-based Service Binding can carry that header to a Worker with no public URL; RPC calls do not carry an HTTP override header. On upgrade, the same header can select the candidate through an existing production route, so 0% and the private harness do not make the candidate inaccessible. Override failure silently follows ordinary deployment percentages, and Custom Domains route to a Worker service name rather than one version. | Require the full production security contract before staging. Use a release-only Worker triggered by an isolated temporary Queue, fetch Service Bindings to App/Content/Jobs, correlated App/Content version evidence, exact Jobs identity, and embedded runtime build evidence from every production-capable stable Container slot. Before first-install ingress, observe candidate-only current deployments and prove bootstrap overrides fail. After upgrade failure, observe previous-only current deployments; otherwise report the candidate still externally selectable and keep activation blocked. |
| Hyperdrive query path | Supported with constraints | Caching can be disabled while retaining connection pooling. Hyperdrive uses transaction pooling, does not invalidate cached reads on writes, imposes a 60-second statement limit, and does not support SQL-level prepared statements, advisory locks, LISTEN/NOTIFY, or arbitrary session state. | Keep caching disabled. Prove transaction scope and driver behavior. Route unsupported features through one direct connection for the entire operation. |
| Direct PostgreSQL fallback | Conditional | Workers supports outbound TCP, but private/localhost/Cloudflare destinations are blocked and source addresses are not the published Cloudflare IP ranges. Private databases require a supported private-connectivity design such as Hyperdrive with Cloudflare Tunnel or Workers VPC. | Make public reachability or private connectivity an explicit prerequisite. Do not assume a Worker can directly reach an enterprise-private database. |
| R2 private object storage | Supported | R2 buckets are private by default. Worker bindings support ranged reads, streaming reads/writes, and multipart upload. Public `r2.dev` or custom-domain access is an explicit bucket setting; direct R2 custom-domain caching would create a separate public route. | Verification must assert that public development URLs and public custom-domain access are disabled. Optional Viewer acceleration must cache only behind the authorization-first Worker route. |
| R2 deployment-record mirror | Supported with application fencing | R2 reads and writes are strongly consistent, and both the Workers binding and S3-compatible API expose conditional writes, including wildcard create-only behavior. R2 does not interpret a numeric deployment fencing token or grant a PostgreSQL lease. | Validate PostgreSQL first, reject a newer encoded mirror fence, use ETag match for update and `If-None-Match: *` or its qualified equivalent for first create. Treat precondition, lease-loss, or ambiguous results as stale or indeterminate and reconcile from PostgreSQL plus current R2 state without old-fence retry. |
| Large uploads through Workers | Conditional | R2 supports very large multipart objects, but each HTTP request entering a Worker remains subject to the Worker body limit. Multipart avoids that ceiling only when the client sends parts as separate requests. | Keep the configured maximum at or below the account body limit, or propose an explicit multipart wire-contract change. Do not claim server-side multipart alone removes the inbound limit. |
| Queue delivery model | Supported | Queues provide at-least-once delivery. Messages can be duplicated; batch failures retry unacknowledged messages. Each queue has one consumer type, and a queue can have one push consumer Worker. Messages are limited to 128 KB. | The database-authoritative/wake-signal design is correct. Keep payloads to identifiers, make claims idempotent, configure retries/DLQ, and add reconciliation for DLQ and retention exhaustion. For release probes, compute terminal nonce/sub-fence retention from observed Queue retention, delay/retry, invocation-lease, recovery, and cross-storage side-effect bounds; pause does not prove in-flight drainage. |
| Queue runtime | Supported with limits | Push-consumer execution is limited to 15 minutes wall time, with configurable CPU up to five minutes; queue retention and concurrency vary by plan. | Keep the Worker handler bounded and hand long work to a Container. Validate plan-specific retention and concurrency in `doctor`. |
| Cron recovery | Supported with operational caveat | Cron runs scheduled handlers in UTC. Trigger creation, change, and deletion can take up to 15 minutes to propagate. The manual exposes no global propagation-complete state and does not provide an exactly-once or exact-time guarantee, so a removed trigger may still invoke the updated Jobs script during that window. | Treat Cron as a recovery signal, not authority. Close the PostgreSQL-backed gate, reread the expected control-plane configuration, and wait the full maximum interval in the pinned baseline before mutation or reliance. Keep the gate closed throughout; late invocations become fenced no-ops. |
| Container availability and cost | Supported, paid only | Containers are available on Workers Paid, offer predefined instance types and constrained custom CPU/memory/disk settings, support scale-to-zero, and have ephemeral disks. A Container instance is backed by a Durable Object and controlled through a Worker. | State the $5/month Workers Paid floor as a current, non-contractual price. Validate the selected predefined or custom resources and represent Durable Objects as platform control-plane state, not product business state. |
| Container job lifecycle | Supported with design work | Containers can run batch processes without exposing a port, have no documented maximum runtime, and receive SIGTERM followed by SIGKILL after 15 minutes during termination. Cold starts are commonly seconds and first deployment provisioning can take minutes. | Persist claim/heartbeat/result state outside the Container and handle termination, retries, cold start, and ephemeral-disk loss. |
| Container outbound isolation | Not proven | Internet-disabled Containers deny outbound traffic by default. Only explicitly allowed or intercepted HTTP/HTTPS traffic on ports 80/443 and Cloudflare-provided DNS can leave; `allowedHosts` is deny-by-default when set. Outbound interception requires `ContainerProxy`, and HTTPS interception requires trusting the injected CA. These controls still do not create per-process policy inside one Container. | Keep thumbnails Internet-disabled on an internal broker host. Use Internet enabled plus an exact host allowlist only for trusted direct PostgreSQL, export `ContainerProxy`, and prove Artifact Chromium cannot obtain mutation authority. |
| Container SSH | Supported with explicit shutdown | Container SSH is enabled by default in the current platform contract. | Set `ssh.enabled = false`, configure no authorized keys, and verify no SSH access path for production and secretless thumbnail Containers. |
| Kubernetes-equivalent sandbox controls | Not documented | Cloudflare documents strong isolation between Container VMs, but current product manuals do not expose Kubernetes-style configuration for Linux capability drop, `no-new-privileges`, seccomp profiles, host namespace controls, or mount policies. | Do not claim equivalent hardening. Validate the required controls experimentally and reject the Cloudflare thumbnail capability if the product's isolation invariant cannot be met. |
| Container image/version rollout | Not proven | A Jobs configuration can select a Container image, but `wrangler deploy` rolls Container instances separately, normally 10% then 100%; selecting a retained bundle is not proof that instances converged. The current Durable Object manual says configurations containing `exports` fail `wrangler versions upload`, gradual deployment cannot cross a Durable Object lifecycle change, and Wrangler behavior is evolving. | Pin and qualify the exact toolchain. Embed a pre-publication build/release/contract identity mapped to the image digest/provider reference, exercise every production-capable stable slot, correlate actual instance evidence with rollout state, and reject while a previous-image instance remains selectable. Stage App and Content Workers at 0%, predeclare stable classes, forbid ordinary lifecycle changes, and retain old bundles/images. |
| Queue activation control | Supported | Queue delivery can be paused at queue level while messages continue to accumulate. Consumer creation itself is an active attachment unless delivery is paused, and messages already in flight can still complete. | Create or update Jobs consumers only with delivery paused, fence or drain in-flight work, verify the Jobs Worker and Containers, then resume explicitly. A release-only verifier must mark its nonce terminal, pause/detach, drain nonce-scoped active invocations through the maximum external-write interval, and only then inventory and clean; the longer-lived tombstone blocks late retries without delaying activation. |
| Worker rollback | Supported with boundaries | A rollback immediately shifts 100% traffic to a selected recent version. Only the 100 most recently published versions are retained; connected resources are not changed, and rollback can fail when a binding resource or Durable Object history is incompatible. The Jobs path uses immediate deploy rather than version activation. | Reactivate retained App/Content versions only after proving they remain provider-addressable, redeploy the retained Jobs bundle with triggers isolated, and observe Container convergence separately. Keep resources under their qualified current owner and prove routes, Cron, Queue consumers, R2, Queues, Hyperdrive, bindings, and retained images compatible. |
| Terraform/Wrangler ownership | Conditional; Worker-coupled split is unqualified | Cloudflare provides Terraform resources for R2, Queues, routes/domains, Worker scripts/deployments, and Hyperdrive, while Wrangler treats its Worker configuration as source of truth and directs Wrangler-managed Cron to Wrangler configuration. Managing the same object or omitting externally managed Worker fields can cause drift or replacement. Hyperdrive credentials are sensitive but still exist in Terraform state. | Choose exactly one owner for every field. A separate Terraform owner for Cron, Queue consumers, routes, domains, or bindings is accepted only after repeated Terraform apply plus every Wrangler deploy path proves preservation and empty drift in the pinned disposable account; otherwise one tool owns the Worker-coupled field. Protect Terraform state as secret-bearing material. |
| Script-bound entry resources | Supported with separate lifecycle | Queue consumers, Cron schedules, routes, and Custom Domains reference a Worker script or service identity, while Worker deployments carry version IDs and traffic percentages. Entry resources therefore follow the script's active deployment and are not rolled back or version-selected by attaching a domain. | Isolate Queue and Cron independently around immediate Jobs deploy; promote and verify first-install candidates before attaching domains, keep route/trigger compatibility current across rollback, and do not imply version activation restores Terraform-owned entry resources. |
| Kubernetes read-only planning | Supported | Kubernetes dry-run executes admission and validation without persisting the request, and `kubectl apply` supports server-side dry-run and an explicit field manager. | Implement `plan` with server-side apply dry-run, preserve field conflicts as blockers, and never use client rendering alone as proof that the live cluster accepts the release. |
| Kubernetes migration Job | Supported with idempotency | A `batch/v1` Job is a one-off task, but Pod failure and Job retry can execute the workload again. | Keep immutable migration checksums, the installation advisory lock, and transaction/idempotency rules; a Job object alone does not guarantee exactly-once migration execution. |
| Kubernetes NetworkPolicy | Conditional | The API can exist even when the selected network plugin does not implement NetworkPolicy, and standard policy cannot safely select a changing external FQDN. | Keep `doctor` read-only. Require stable CIDRs, an egress gateway/proxy, or a qualified CNI FQDN extension, then prove allow and deny behavior with isolated pre-traffic probes or current cluster-specific evidence. |
| Kubernetes security context | Supported | The API exposes non-root execution, read-only root filesystem, capability control, privilege-escalation control, and seccomp profiles including `RuntimeDefault`. | Keep these controls explicit in every applicable Pod and verify the admitted Pod spec; do not rely on cluster defaults. |
| Kubernetes ingress portability | Conditional | Service is stable Kubernetes API, while Ingress and Gateway behavior depends on an installed controller and cloud integration. | Keep controller class, TLS, address, forwarded metadata, and route behavior as deployment inputs and live verification evidence rather than hard-coded provider assumptions. |
| Compose startup and readiness | Supported with explicit health contracts | Compose long-form `depends_on` supports `service_healthy` and `service_completed_successfully`; `up --wait` waits for running or healthy services, but a service without a health check is only proven running. Startup ordering is not an application runtime-availability guarantee. | Keep meaningful health checks on every critical resident service, model migration and object initialization as successful one-shot dependencies, bound the wait, retain application retries, and perform host HTTP/SMTP probes after Compose readiness. |
| Compose development/test isolation | Supported with constraints | Explicit `-p` scopes ordinary project resources, but project-name precedence, ambient Docker/Compose controls, aliased or remote daemon contexts, published ports, explicit resource `name:` values, and external resources can still change or collide with the intended project. Shell variables take precedence over `--env-file`; `config --environment` exposes the interpolation environment. Context names are mutable, multiple endpoint aliases can reach one Engine, an Engine restart can change server ID, and a remote daemon's loopback is not the caller's loopback. | Launch test children from a hermetic allowlist, freeze an explicit endpoint/TLS snapshot, hold endpoint/project and Engine-ID/project locks from first mutation through cleanup, and bracket each mutation with Engine-ID checks. Reject remote test daemons and project-sharing resources, allocate test ports dynamically on loopback before application startup, parameterize distinct-browser-site endpoints, and verify exact ownership before cleanup. |
| Compose teardown and data retention | Supported with different destructive scopes | `docker compose down` removes project containers and networks but preserves named volumes unless `--volumes` is supplied; `--remove-orphans` remains project-scoped. | Ordinary `dev-down` preserves developer data. Test teardown runs in a guaranteed cleanup path with the exact test project identity and may remove only that project's volumes and orphans; never run global prune. |
| SMTP acceptance and ambiguity | Supported with explicit durable phase classification | SMTP transfers responsibility only after the receiver returns final success for the complete message. RFC 5321 warns that a timeout while waiting for that final reply commonly leads to duplicate delivery if the sender retries; SMTP has no general idempotency key. A process crash or lease expiry does not itself reveal whether the complete message crossed that boundary. | Persist attempt ID/fence/phase/deadline before external side effects. Retry only when durable evidence proves complete submission did not occur, and record acceptance only from the final success reply. A crash, lease loss, or timeout in an unknown `DATA`/post-submission phase enters manual reconciliation without automatic resend and cannot reconcile until the provider-call deadline plus safety margin is past and quiescence is observed. |
| Resend HTTPS adapter | Supported | Resend accepts `POST /emails` with Bearer authentication and returns an email ID. Direct HTTP clients must send a stable `User-Agent`. A successful request means accepted for processing, not final delivery. | Specify the minimum HTTP contract and stable `User-Agent`. Use SMTP-equivalent acceptance semantics unless delivery/bounce webhooks are explicitly added. |
| Resend idempotency | Conditional | `Idempotency-Key` is limited to 256 characters and retained for 24 hours. Same key plus a different payload is a permanent 409 error; concurrent use can return a retryable 409. | Derive the key from the logical mail ID and keep the payload byte-for-byte stable. Freeze one conservative safe-replay cutoff before the first possible send from the pinned retention minus clock/transport margin; never extend it on retry. After the prior call deadline and quiescence, permit a same-team/key/payload replay only before that cutoff. Persist local terminal state because provider deduplication expires. |
| Email provider namespace across retries | Conditional | Resend teams are distinct and have separate API keys and usage; Resend's rotation guidance creates the replacement key with the same permission and domain scope. Neither that guidance nor SMTP supplies a cross-team or cross-relay idempotency guarantee. | Freeze a non-secret provider/team or relay namespace, sender/domain, endpoint/configuration revision, payload digest, and logical key before the first attempt. Continue credential rotation only when it proves the same namespace and sender scope; never auto-migrate an attempted pending or indeterminate delivery to another team, relay, sender, or Adapter. |
| Resend authentication-mail security | Conditional | Click tracking rewrites links and can break authentication links. Tracking is currently off by default but can be enabled at the domain level. | Require click and open tracking to remain disabled for the authentication domain. A sending-only runtime key cannot inspect this remotely, so verify it operationally or with an authorized deep check. |
| Resend error handling | Conditional | Resend differentiates rate limiting, daily/monthly quota exhaustion, concurrent/invalid idempotency, validation, authentication, and transient server failures. HTTP status alone is insufficient. | Classify by Resend error `type`, honor retry headers, and retry unresolved network/5xx cases only with the same key and payload before the conservatively frozen safe-replay cutoff. |
| Resend least privilege and domain verification | Supported with doctor boundary | A sending-access key can be scoped to a verified domain. Domain verification requires DNS records such as SPF and DKIM. A sending-only key cannot query management-domain status. | Keep a domain-scoped sending key in runtime. Ordinary `doctor` can verify local sender/key references; remote verification requires an explicit test send or separate management credential that must not be given to runtime. |
| Resend free tier and privacy | Supported for low volume, not a guarantee | Current free pricing advertises 3,000 emails/month, 100/day, one domain, and 30-day data retention. Recipient count affects quota. Disabling message-content storage is not a free-plan capability. | Treat quota/pricing as mutable operator facts, not product constants. Document that Resend may retain authentication-mail content even after ShareSlices deletes its local payload. |

## Implementation-blocking feasibility gates

### 1. Runtime compatibility gate

Run the real built application under the Workers runtime, not merely a bundler. The gate must cover:

- sign-up, session, password-reset, and Better Auth hooks;
- Drizzle plus the selected PostgreSQL driver through cache-disabled Hyperdrive;
- transaction-bound paths through the direct client;
- streaming and ranged R2 reads/writes;
- archive and upload boundary cases;
- absence of unsupported Node API stubs at runtime.

Workers' Node compatibility layer is deliberately partial. Hono's and Better Auth's first-party Workers guides make the architecture plausible, but they do not validate ShareSlices' complete dependency graph.

### 2. Thumbnail isolation and connectivity gate

The current security requirement is stronger than the documented Cloudflare Container control surface. The test must demonstrate all of the following in the actual production image:

- Chromium runs without root privileges and cannot escalate;
- Chromium cannot reach PostgreSQL, arbitrary internet destinations, R2 public endpoints, or Worker management routes;
- the trusted runner can still claim/heartbeat/complete jobs and access only the exact committed objects required;
- inherited file descriptors, environment variables, local sockets, DNS, redirect chains, and browser schemes do not bypass the boundary;
- termination, cold start, replay, and duplicate Queue delivery leave authoritative state recoverable.

If Cloudflare cannot enforce different network authority for the trusted Rust runner and its Chromium child, redesign the Container as a secretless compute sandbox. A narrow Worker-side handler can hold R2 bindings and database credentials while exposing only job-specific operations. If neither design meets the product invariant, deployment must fail with the thumbnail capability disabled rather than weaken the invariant.

### 3. Release and rollback gate

Before promising ordered Cloudflare release automation, prove with a disposable account that:

1. App and Content Worker versions can be uploaded, added to the current deployment at 0%, and selected by a release-only route-free verifier through fetch Service Bindings that confirms the actual version ID, while the same harness proves the exact Jobs Worker deployment, release bundle, configuration/`exports`, migration head, and embedded build/release/contract identity of every production-capable stable Container slot without production Queue or Cron;
2. App/Content Secret rotation creates a zero-percent ordinary-traffic candidate that already enforces production security despite external override selection on an existing route, while Jobs deploy preserves existing Secrets and a Jobs rotation can use an ephemeral `--secrets-file` without leaking or deleting required values; Jobs Secret deletion must preserve code, configuration, `exports`, image, and retained bindings or compensate with triggers still isolated;
3. the final Jobs script name can bootstrap with no active ingress or triggers, and later Jobs releases can update only after the scheduled-execution gate closes, Queue delivery pauses, Cron is absent in the control plane, the full pinned maximum propagation interval elapses, and in-flight work is drained or fenced; a late Cron invocation must become a fenced no-op;
4. every stable Container Durable Object class is declared initially and ordinary release validation rejects later lifecycle changes;
5. the required Container image is fully available before immediate Jobs deployment;
6. retained App/Content versions plus a separately retained Jobs bundle and Container image survive rollback;
7. old images and bound resources are retained for the declared rollback window;
8. the documented rolling Container replacement cannot create a mixed incompatible state, every stable slot exercises the expected build mapped to the recorded image digest/provider reference, and no previous-image instance remains selectable;
9. first-install App and Content candidates are promoted, reverified, and observed as candidate-only current deployments before Custom Domains or routes attach; an override cannot select the retained bootstrap versions; and product background triggers remain isolated until public black-box verification succeeds;
10. failed upgrade candidates are removed from current deployments and observed absent so version overrides cannot select them, while an unconfirmed removal remains explicitly degraded and blocked rather than being described as previous-only serving;
11. every synthetic verifier database row, broker attempt, Container invocation, and R2 object is release/fence/nonce-owned in a non-product namespace; marking the nonce terminal and advancing its sub-fence blocks new work, bounded active-invocation quiescence precedes final cross-storage inventory and cleanup, and the tombstone remains through the observed maximum Queue retention, send/retry delay and schedule, active-invocation lease, interrupted-recovery, and cross-storage side-effect intervals plus safety margin without being treated as an orphan.

Until this passes, the proposal should call the sequence a target release design, not a supported atomic deployment behavior.

### 4. Upload-limit gate

At deployment validation time, compare the configured maximum artifact request size with the Cloudflare account-plan Worker body limit. The current 50 MiB default is below the documented 100 MB Cloudflare Free/Pro account-plan ceiling; “Free/Pro” here does not mean Workers Free/Paid. A higher configured limit must fail validation unless a separately specified client multipart protocol is enabled. R2 multipart APIs alone do not change the size of an incoming Worker request.

### 5. Ownership gate

Generate and validate one machine-readable field ownership matrix. At minimum it must decide ownership for:

- R2 bucket creation and public-access settings;
- long-lived product Queue and DLQ creation, consumer attachment, retry/batch/concurrency settings;
- release-only verifier Worker, temporary Queue/consumer, fetch Service Bindings, and private evidence-prefix creation and cleanup;
- queue-level delivery pause/resume during Jobs deployment and compensation;
- Hyperdrive configuration and secret-bearing Terraform state;
- Worker routes, custom domains, `preview_urls`, and `workers_dev` exposure;
- version-scoped bindings and compatibility dates/flags;
- App/Content version-scoped Secret bindings, Jobs deploy-time Secret preservation/update/deletion compensation, and the operator Secret source;
- Cron Triggers;
- Durable Object migrations and Container class/image/rollout settings.

The same field must never be mutated by both Terraform and Wrangler. For Cron,
Queue consumers, routes, domains, and bindings, the gate must also prove that
omission from Wrangler does not remove or replace the externally managed field;
if it cannot, the field and Worker configuration need one owner.

### 6. Kubernetes conformance gate

Run the generated bundle against each declared supported cluster profile and prove:

- server-side dry-run accepts every resource and reports no unowned field conflict;
- the one release-scoped migration Job cannot advance the same migration twice across Pod or Job retry;
- an explicitly authorized isolated qualification phase proves the installed CNI enforces default-deny and declared ingress/egress paths without making `doctor` mutating;
- admitted Pods retain non-root, capability-drop, no-privilege-escalation, read-only-root, and `RuntimeDefault` seccomp settings;
- the selected Ingress or Gateway implementation preserves route, TLS, client-metadata, body-size, timeout, Cookie, and `no-store` behavior;
- direct ingress and optional CDN addresses pass the same black-box contract.

### 7. Compose ownership and isolation gate

Before the Deployment Module takes ownership of the local topology, prove from a clean and an existing-data workspace that:

1. every `up`, `ps`, `logs`, `down`, `run`, and `config` invocation passes its topology's fixed ordered files, repository-root `--project-directory`, explicit `-p shareslices` or `-p shareslices-test`, and the frozen endpoint/TLS/client-configuration snapshot rather than a mutable context alias. The test controller creates every Docker/Compose child from a strict allowlist and inherits no caller environment. Real developer inputs use only `config --quiet`; full model output and `config --environment` are allowed only in the hermetic non-sensitive test environment and are not persisted by default. Canaries prove that declared shell overrides, unrelated Secret-like values, Docker/Compose controls, CI or agent values, developer `.env`, and registry credentials cannot affect the test model or reach output;
2. the canonical developer project and its existing PostgreSQL and object-storage volume identities are preserved across the path migration, repeated start, and ordinary shutdown;
3. the installed Docker Compose plugin passes the recorded feature baseline for bounded wait, long-form dependency conditions, and machine-readable status; every critical resident role has a meaningful health check, initialization and migration complete successfully, and host HTTP plus SMTP probes still fail startup when publication is unreachable;
4. every mutating developer or test lifecycle acquires a host-global endpoint/project lock and then the observed Engine-ID/project lock, brackets every build, create, start, `up`, `run`, `exec`, recreation, `down`, or cleanup command with Engine-ID checks, and holds both locks continuously through `finally`. An identity change performs no action under the stale Engine lock and requires the replacement Engine/project lock before positive-ownership reconciliation. Status/log paths remain read-only but use the frozen connection and return indeterminate if their before/after identities differ. Context-update and Engine-reset race tests fail closed. Cleanup matches the repository/topology/endpoint/Engine/project marker before removing only test-project resources without masking the primary failure. Crash recovery may adopt a stale project only after acquiring both locks when every marker and resource label matches; ambiguity fails closed with exact diagnostics. A future remote-developer profile needs one controller host or a daemon-side/distributed lease and is outside this gate;
5. the developer topology retains its canonical loopback ports, while every test publication requests a dynamically assigned loopback host port. Under the same locks, the controller first creates only endpoint services with no public-URL dependency or application business side effect, discovers and freezes their machine-readable mappings, injects the resulting URLs into remaining test roles, and starts those roles without recreating the endpoint layer. Trusted and Untrusted-content origins pass the distinct-browser-site validator and never reuse developer defaults. Test model validation rejects external networks, volumes, configs, or Secrets, explicit resource names outside project scope, `container_name`, and other shared-resource escapes before mutation;
6. only the locked `shareslices-test` maintenance role delivers a real authentication message through its test Mailpit endpoint while API HTTP and content-only roles hold no SMTP authority; the canonical developer topology receives only read-only readiness, route, and response-header probes;
7. the provider-neutral black-box subset runs against the locked test project for every writing, sending, credential, authorization, or lifecycle scenario, and every Kubernetes-, CDN-, Cloudflare-, or Resend-only row reports `not_applicable` rather than being silently skipped or reported as qualified.

The local result is development regression evidence only. It cannot activate or qualify either production target.

## Resend HTTPS Adapter contract that matches the official API

The Cloudflare mail adapter should use this minimal contract:

- `POST https://api.resend.com/emails` with `Authorization: Bearer ...`, `Content-Type: application/json`, a stable `User-Agent`, and `Idempotency-Key`;
- required JSON `from`, one-element `to`, and `subject`, plus the selected `text` and `html` authentication content and no attachments;
- a stable logical-mail idempotency key (maximum 256 characters), reused with an unchanged payload;
- a first-attempt non-secret snapshot of the Resend team namespace, sender/domain, endpoint and configuration revision, payload digest, and logical key; key rotation continues only when the replacement remains in the same team with the same required domain scope, and an attempted delivery never migrates automatically to another team or Adapter;
- acceptance state recorded with the returned provider email ID; no claim of final delivery without webhook events;
- retries classified at minimum by documented `invalid_idempotency_key`, `invalid_idempotent_request`, `concurrent_idempotent_requests`, `rate_limit_exceeded`, `daily_quota_exceeded`, and `monthly_quota_exceeded` types; unknown, non-JSON, network, and server failures remain conservative and bounded;
- a verified sender domain and domain-scoped sending-access key;
- click/open tracking disabled for the authentication-mail domain;
- local durable terminal/deduplication state beyond Resend's 24-hour key window.

Rate limits are shared across a Resend team rather than dedicated to one ShareSlices installation. Current manuals list a default of 5 requests per second per team and allow approved increases; live `ratelimit-*` and `retry-after` response headers plus the account Usage settings are authoritative for the installation. Account health also depends on bounce and complaint posture. These dated observations are operator/dashboard evidence, not embedded product constants. A sending-only key and response headers do not provide complete account-health or quota-headroom observation, so unavailable facts remain warnings or required fresh operator evidence.

If delivered/bounced state is later required, that is a separate behavior change: Resend webhooks are at-least-once, may be duplicated and unordered, and require raw-body signature verification and event-ID deduplication.

## Current cost and quota facts

These are planning inputs, not stable product guarantees:

- Cloudflare Containers require Workers Paid. Current Workers Paid base pricing starts at USD 5/month and includes usage allowances; Containers, Worker requests, and backing Durable Objects remain metered.
- Resend currently lists a free tier of 3,000 transactional emails/month and 100/day with one domain. Multiple recipients count separately, and free service has no paid overage buffer.
- Resend currently retains regular-plan email data for 30 days. Disabling message-content storage is an additional paid-plan capability.

Deployment documentation should link operators to the live pricing/limits pages and avoid embedding these figures as compatibility constants.

## Primary sources

### Docker Compose

- [Control startup and shutdown order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Compose services: `depends_on`, `healthcheck`, and `container_name`](https://docs.docker.com/reference/compose-file/services/)
- [`docker compose up`, including `--wait` and test exit behavior](https://docs.docker.com/reference/cli/docker/compose/up/)
- [`docker compose down` and named-volume behavior](https://docs.docker.com/reference/cli/docker/compose/down/)
- [`docker compose` root options, including `--project-directory`](https://docs.docker.com/reference/cli/docker/compose/)
- [`docker compose config`, including quiet validation](https://docs.docker.com/reference/cli/docker/compose/config/)
- [Merge rules and relative paths for multiple Compose files](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
- [Compose variable interpolation and `.env` discovery](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- [Predefined Compose environment variables and precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars/)
- [Compose project-name precedence and CI isolation](https://docs.docker.com/compose/how-tos/project-name/)
- [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [Compose port publication, including automatic host-port allocation](https://docs.docker.com/reference/compose-file/services/#ports)
- [`docker compose ps --format json`, including published-port state](https://docs.docker.com/reference/cli/docker/compose/ps/)
- [`docker compose port`](https://docs.docker.com/reference/cli/docker/compose/port/)
- [Named volume scope](https://docs.docker.com/reference/compose-file/volumes/#name)
- [Named network scope](https://docs.docker.com/reference/compose-file/networks/#name)
- [Docker contexts and endpoint selection](https://docs.docker.com/engine/manage-resources/contexts/)
- [Docker CLI environment-variable precedence](https://docs.docker.com/reference/cli/docker/)
- [Docker Engine information and server ID](https://docs.docker.com/reference/cli/docker/system/info/)

### Cloudflare Workers and Static Assets

- [Node.js compatibility APIs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Workers Hono framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/)
- [Hono Cloudflare Workers guide](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Better Auth installation and Cloudflare notes](https://better-auth.com/docs/installation)
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static Assets binding and `run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Static Assets SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Static Assets overview and caching behavior](https://developers.cloudflare.com/workers/static-assets/)
- [Static Assets response headers and `_headers`](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare cache response statuses](https://developers.cloudflare.com/cache/concepts/cache-responses/)
- [Workers caching configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Deployment management and first-version constraints](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)
- [Worker Secrets and versioned upload](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler source-of-truth behavior and Secret preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
- [Upload Secrets alongside code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code)
- [Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [`workers.dev` routing controls](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
- [Service Bindings and non-public Worker calls](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Fetch-based Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
- [Worker Deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/)
- [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [Version affinity for asset consistency](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/)

### Hyperdrive, R2, Queues, and Cron

- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Hyperdrive supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
- [How Hyperdrive uses transaction pooling](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
- [Connecting to PostgreSQL from Workers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Hyperdrive private database with Tunnel](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
- [Hyperdrive private database with Workers VPC](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 consistency guarantees](https://developers.cloudflare.com/r2/reference/consistency/)
- [R2 multipart upload in Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [R2 object upload methods](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [R2 public bucket settings](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Queue DLQs](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)
- [Queue limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Queue configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Pause and resume Queue delivery](https://developers.cloudflare.com/queues/configuration/pause-purge/)
- [Queue and consumer API resources](https://developers.cloudflare.com/api/resources/queues/)
- [Queue batching and retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [How Queues work](https://developers.cloudflare.com/queues/reference/how-queues-works/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Scheduled handler API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)

### Cloudflare Containers and infrastructure management

- [Containers overview](https://developers.cloudflare.com/containers/)
- [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [Container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Container limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Container SSH configuration](https://developers.cloudflare.com/containers/ssh/)
- [SSH enabled-by-default announcement](https://developers.cloudflare.com/changelog/post/2026-05-12-ssh-enabled-by-default/)
- [Container lifecycle API](https://developers.cloudflare.com/containers/container-class/)
- [Container outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)
- [Worker-to-Container and Container-to-Worker connections](https://developers.cloudflare.com/containers/platform-details/workers-connections/)
- [Container image management](https://developers.cloudflare.com/containers/platform-details/image-management/)
- [Container rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/)
- [Durable Object migration constraints and `exports`](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/#constraints-and-limitations)
- [Container FAQ](https://developers.cloudflare.com/containers/faq/)
- [Terraform best practices and state ownership](https://developers.cloudflare.com/terraform/advanced-topics/best-practices/)
- [Terraform R2 resources](https://developers.cloudflare.com/api/terraform/resources/r2/)
- [Terraform Queues resources](https://developers.cloudflare.com/api/terraform/resources/queues/)
- [Terraform Queue consumer resources](https://developers.cloudflare.com/api/terraform/resources/queues/subresources/consumers/)
- [Terraform Worker routes](https://developers.cloudflare.com/api/terraform/resources/workers/subresources/routes/)
- [Terraform Worker domains](https://developers.cloudflare.com/api/terraform/resources/workers/subresources/domains/)
- [Terraform Worker deployments](https://developers.cloudflare.com/api/terraform/resources/workers/subresources/scripts/subresources/deployments/)
- [Terraform Worker schedule resources](https://developers.cloudflare.com/api/terraform/resources/workers/subresources/scripts/subresources/schedules/)
- [Terraform Hyperdrive resource](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/hyperdrive_config)

### Resend

- [Send Email API](https://resend.com/docs/api-reference/emails/send-email)
- [API introduction and HTTP requirements](https://resend.com/docs/api-reference/introduction)
- [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Managing Resend teams and their separate API-key/usage namespaces](https://resend.com/docs/dashboard/settings/team)
- [Resend API-key rotation with matching permission and domain scope](https://resend.com/docs/knowledge-base/how-to-handle-api-keys)
- [API errors](https://resend.com/docs/api-reference/errors)
- [Rate-limit headers](https://resend.com/docs/api-reference/rate-limit)
- [API key permissions](https://resend.com/docs/dashboard/api-keys/introduction)
- [Domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Domain mismatch behavior](https://resend.com/docs/knowledge-base/403-error-domain-mismatch)
- [Tracking behavior](https://resend.com/docs/dashboard/domains/tracking)
- [Authentication-email deliverability guidance](https://resend.com/docs/knowledge-base/how-do-i-maximize-deliverability-for-supabase-auth-emails)
- [Webhook event semantics](https://resend.com/docs/webhooks/event-types)
- [Webhook delivery guarantees](https://resend.com/docs/webhooks/introduction)
- [Webhook signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Message-content retention](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend)
- [Current Resend pricing](https://resend.com/pricing)

### SMTP

- [RFC 5321: SMTP responsibility, final reply, timeout, and duplicate-delivery semantics](https://www.rfc-editor.org/info/rfc5321/)

### Kubernetes

- [Kubernetes API dry-run guarantees](https://kubernetes.io/docs/reference/using-api/api-concepts/#dry-run)
- [`kubectl apply` server-side dry-run and field manager](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/)
- [`batch/v1` Job API and retry behavior](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/)
- [NetworkPolicy and CNI enforcement caveat](https://kubernetes.io/docs/concepts/services-networking/)
- [NetworkPolicy behavior and limitations](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Pod and Container security contexts](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [Seccomp in Kubernetes](https://kubernetes.io/docs/reference/node/seccomp/)
- [Ingress concepts and controller requirement](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Gateway API concepts](https://kubernetes.io/docs/concepts/services-networking/gateway/)
