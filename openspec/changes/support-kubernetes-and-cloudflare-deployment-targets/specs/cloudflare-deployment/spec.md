# cloudflare-deployment Delta Specification

<!-- cspell:words Hyperdrive secretless -->

## ADDED Requirements

### Requirement: Deploy the Cloudflare target without Kubernetes

When an installation selects the `cloudflare` target, the Deployment Module SHALL deploy ShareSlices through Cloudflare Workers, Workers Static Assets, private R2, Hyperdrive and verified direct PostgreSQL connection paths, Queues, scheduled triggers, and bounded Cloudflare Containers. The target MUST NOT require Kubernetes workloads, Services, Ingress, CronJobs, Kubernetes-hosted object storage, or resident Kubernetes background workers to complete the same installation.

External PostgreSQL and Resend SHALL remain explicit prerequisites rather than Cloudflare-owned business stores. The Cloudflare target MUST use the same application, HTTP, authorization, database, job, object-layout, Gallery-isolation, cache, and durable authentication-email contracts as the Kubernetes target and MUST NOT introduce a second Cloudflare-specific implementation of product policy.

#### Scenario: Operator selects the Cloudflare target

- **WHEN** an operator applies a valid deployment configuration whose target is `cloudflare`
- **THEN** the release contains only the Cloudflare runtime composition and shared external prerequisites and does not require a Kubernetes release to be present

#### Scenario: Kubernetes is unavailable

- **WHEN** a configured Cloudflare installation has no Kubernetes cluster or Kubernetes credentials
- **THEN** Cloudflare `doctor`, `render`, `plan`, `apply`, `status`, `verify`, and compatible `rollback` remain fully operable

#### Scenario: A required Cloudflare prerequisite is missing

- **WHEN** read-only `doctor` cannot validate access, configuration, or existing evidence for a required Cloudflare account resource, external PostgreSQL connection mode, Resend configuration, route, domain, or Secret
- **THEN** it reports the failed prerequisite and performs no release mutation

#### Scenario: Target-specific composition changes

- **WHEN** a request executes through either supported deployment target
- **THEN** the target-specific entrypoint and infrastructure Adapters call shared application behavior without branching product policy on the selected provider

### Requirement: Qualify the Cloudflare platform contract

Each Cloudflare release SHALL pin the Wrangler version, Cloudflare Terraform provider version, Workers compatibility date and flags, Container package version, and generated configuration-schema digest used to build and verify the target. The App, content, and jobs Worker bundles MUST pass deployed compatibility tests for every imported runtime dependency and exercised product path; `nodejs_compat` or a package's documented generic Workers support MUST NOT be treated as proof that an untested application graph is compatible.

`doctor` SHALL collect limit evidence from three explicit sources: values observed through read-only provider interfaces, release-static limits from the pinned contract baseline, and current operator-supplied qualification evidence for facts the provider does not expose. It SHALL compare the configured installation with Worker, Static Assets, request-body, Queue, Hyperdrive, R2, Container instance, image, memory, disk, and route constraints. Missing or stale evidence for a required limit MUST remain `unknown` and block activation rather than be reported as live-verified.

A direct database path or egress boundary that can be proven only from a Container SHALL be qualified by an explicitly authorized, non-public pre-traffic probe during `apply`. `doctor` MUST NOT create a Container or report control-plane reachability as proof of Container reachability.

#### Scenario: Container entitlement is absent

- **WHEN** the Cloudflare account does not have the Workers Paid entitlement required by Containers
- **THEN** `doctor` marks the Cloudflare target ineligible instead of claiming a free or Container-capable deployment

#### Scenario: Configured Upload exceeds the edge limit

- **WHEN** the configured maximum accepted Upload body exceeds the live account's Cloudflare request-body limit
- **THEN** `doctor` rejects the configuration before routing Upload traffic to the App Worker

#### Scenario: Worker dependency is not compatible

- **WHEN** the deployed compatibility suite cannot prove an imported API, authentication, database, storage, or streaming dependency on the pinned Workers runtime
- **THEN** the release remains ineligible even if its bundle compiles successfully

#### Scenario: Provider contract changes

- **WHEN** an operator selects a Wrangler, Terraform provider, compatibility date, or Container package outside the release-qualified baseline
- **THEN** `plan` refuses production activation until the provider compatibility suite qualifies and records the new baseline

### Requirement: Bound Cloudflare cost-driving resources

Cloudflare deployment configuration SHALL explicitly bound every cost-driving execution control, including per-role Worker CPU limits, Queue consumer concurrency and retry policy, scheduled-trigger frequency, Container instance type, runner-slot count, `max_instances`, drain limits, `sleepAfter`, and the public route families that invoke Worker code before Static Assets. The optional Viewer byte cache SHALL remain disabled unless selected explicitly after representative measurement. The target MUST NOT describe Static Assets as an availability fallback for a Worker-first route: when the applicable Worker allowance is exhausted, that route may return a provider `429` instead of serving a matching asset.

`plan` and `status` SHALL report the current paid-plan prerequisite, configured maxima, observed quota headroom when available through the pinned provider interface, and stable warnings for approaching limits. They MUST NOT promise a free deployment, a fixed monthly bill, or exact future provider spend. Missing bounds or a configured maximum above a declared operator safety cap SHALL block activation.

Every explicitly authorized live prototype SHALL finish by disabling or removing
its public routes, triggers, consumers, Workers, and other continuously invocable
resources, then rereading provider inventory. A private prerequisite MAY remain
only with a recorded owner, purpose, expiry, and no public or active trigger.
Prototype evidence without this shutdown and inventory evidence SHALL be
incomplete. Production operations SHALL document only provider budget alerts or
spend controls actually observed for the qualified account and MUST NOT present
an alert, CPU limit, or configured maximum as a universal hard billing cap.

#### Scenario: Container concurrency is unbounded

- **WHEN** a Cloudflare configuration omits a runner-slot, `max_instances`, instance-type, or drain bound required by an enabled processing capability
- **THEN** validation rejects the release before provider mutation

#### Scenario: Operator inspects cost posture

- **WHEN** `plan` or `status` evaluates a valid Cloudflare installation
- **THEN** it reports paid prerequisites, configured cost-driving maxima, available quota headroom evidence, and uncertainty without presenting an exact bill

#### Scenario: Worker-first allowance is exhausted

- **WHEN** a public route is configured to invoke Worker code before Static Assets and the applicable Worker allowance is exhausted
- **THEN** verification expects fail-closed provider behavior, records the resulting unavailability, and does not claim that Static Assets will serve the request as a fallback

### Requirement: Route trusted traffic through an App Worker

The Cloudflare target SHALL expose a trusted App Worker with Workers Static Assets on the configured Web, API, and Viewer addresses. It SHALL apply the shared route contract before Static Assets or SPA fallback so management API, Viewer, Gallery trusted-surface, health, readiness, and Preview behavior reach their owning application Adapter while `/internal/*` remains publicly unreachable.

The App Worker MUST preserve method, bounded body streaming, status, bounded response streaming, headers, Cookie semantics, request identity, and the language-neutral error contract. Upload, export, and Download paths MUST NOT collect an entire accepted request or response in isolate memory. Static Assets fallback MUST NOT shadow a dynamic route or replace an application response. Public installation configuration SHALL be resolved at deployment runtime so one immutable Web build can be used by multiple installations.

#### Scenario: Browser requests an immutable Web asset

- **WHEN** a request matches a built immutable Web asset and no dynamic route has priority
- **THEN** Workers Static Assets serves that asset under the shared static-cache policy

#### Scenario: Browser requests a same-origin management API

- **WHEN** the Web calls a relative `/api/*` route through the trusted App address
- **THEN** the App Worker invokes the trusted API application with the original method, credentials, bounded streaming body, and response semantics

#### Scenario: Viewer request reaches the trusted edge

- **WHEN** a request matches a configured `/a/{shareSlug}/` route or its asset path
- **THEN** the App Worker resolves it through the Viewer application rather than Static Assets or SPA fallback

#### Scenario: Public request targets an internal route

- **WHEN** an external request reaches the App Worker for `/internal/*`
- **THEN** the edge returns the shared non-disclosing boundary without invoking the internal application route

#### Scenario: Dynamic route returns an error

- **WHEN** a dynamic application route returns a non-success response
- **THEN** the App Worker preserves that response and does not replace it with a static document

### Requirement: Isolate Artifact content on a content-only Worker

The Cloudflare target SHALL deploy an independently routed content-only Worker on a browser site and registrable-domain boundary separate from every trusted Web and API site. That Worker SHALL mount only the content application and its credential validation, effective-access lookup, committed-manifest lookup, private R2 streaming, health, policy-header, telemetry, and request-identification dependencies.

The content-only Worker MUST NOT mount management, account, Artifact mutation, Publication mutation, Gallery mutation, administration, or email behavior. It MUST NOT receive, forward, set, or depend on management cookies or ambient management credentials. Its route MUST NOT share a fallback or wildcard route that makes trusted management operations reachable from Artifact code.

#### Scenario: Artifact player requests authorized content

- **WHEN** a valid player or review authorization requests a normalized manifest-listed path from the configured content address
- **THEN** the content-only Worker revalidates the binding and effective access and streams only the committed private R2 object with the shared content policy headers

#### Scenario: Artifact requests a management operation

- **WHEN** Artifact code sends a management, account, or administration request to the content-only Worker
- **THEN** the Worker exposes no matching operation and supplies no management authority

#### Scenario: Management cookie is presented to content

- **WHEN** a client includes a management cookie in a request to the content-only Worker
- **THEN** the Worker neither consumes nor forwards that cookie and does not return a content-site management cookie

#### Scenario: Content domain shares the trusted registrable site

- **WHEN** the configured content hostname is a sibling subdomain or otherwise shares a registrable site with Web or API
- **THEN** `doctor` and live Gallery eligibility classify the topology as ineligible rather than treating the Cloudflare route as sufficient isolation

#### Scenario: Content Worker dependency graph expands

- **WHEN** a release would add a trusted management builder, Better Auth dependency, credentialed CORS, or aggregate mutation Adapter to the content-only Worker
- **THEN** deployment contract validation rejects the release before traffic reaches it

### Requirement: Keep R2 private behind shared object authorization

The Cloudflare target SHALL store product objects in private R2 using the same language-neutral object-layout and manifest contracts as the Kubernetes object-storage Adapter. Browser and CLI responses MUST NOT expose a public R2 hostname, bucket binding, raw object key, or signed R2 URL.

Every object read or mutation MUST first pass the same account, Version, Publication, Gallery, lease, fence, manifest, and lifecycle authorization that applies on the Kubernetes target. The R2 Adapter SHALL preserve recorded content types, metadata, ranges, bounded streaming, immutable identity, cleanup intent, and retry semantics required by the calling application Module.

#### Scenario: Authorized application reads a committed object

- **WHEN** a trusted or content-only application Module authorizes a committed manifest object
- **THEN** the R2 Adapter streams that exact private object without exposing its bucket location or object key

#### Scenario: Request supplies an arbitrary object key

- **WHEN** a caller attempts to address an R2 object not selected by an authorized manifest or application operation
- **THEN** the target rejects the request without reading or disclosing the object

#### Scenario: Caller requests a raw or staging object publicly

- **WHEN** a public caller attempts to retrieve an Upload archive, staging prefix, or cleanup candidate
- **THEN** the application returns the existing non-disclosing boundary and does not create a public or signed R2 URL

### Requirement: Retain PostgreSQL as the durable business authority

The Cloudflare target SHALL use the configured external PostgreSQL database as the sole durable authority for account, authorization, Artifact, Version, Publication, Gallery, job, attempt, lease, fence, outbox, reconciliation, idempotency, and release-compatible migration state. D1, Durable Objects, Queues, Worker memory, Cache API, and Container disk MUST NOT become a parallel business source of truth.

Authoritative and read-after-write database paths, including authentication, sessions, permissions, and job state, MUST use a cache-disabled Hyperdrive configuration or a verified direct connection. Every path SHALL select an explicit qualified TLS verification mode that verifies both the certificate chain and database hostname and SHALL prove that behavior with a negative test; observing encrypted transport alone MUST NOT be recorded as authenticated origin identity. The current Hyperdrive `require` mode validates against WebPKI but lacks the hostname match provided by `verify-full`, so it MUST NOT satisfy production origin-identity qualification by itself. An operation requiring advisory locks, unsupported session state, or another semantic not proven through Hyperdrive MUST use one verified direct PostgreSQL connection path for the complete operation. One logical transaction MUST NOT be split across Hyperdrive and direct connections. Schema migration SHALL run as an explicit one-shot release phase through the direct path and MUST NOT run in a request handler.

Each trusted non-browser Rust processing Container SHALL use a separately verified direct TLS PostgreSQL path and MUST NOT treat a Hyperdrive Worker binding as a socket available inside the Container. If such a Container uses a public database endpoint, its outbound policy SHALL deny every hostname except declared Runner dependencies and SHALL verify the effective PostgreSQL destination, hostname, and certificate using least-privilege database credentials. Because non-HTTP PostgreSQL traffic requires Container Internet, the path SHALL use Internet enabled together with an exact `allowedHosts` host allowlist and staged destination verification. That allowlist applies to the whole Container and MUST NOT be reported as port-level, per-process, stable-egress-IP, or Chromium isolation evidence.

If the database is private, the affected processing capability MUST remain ineligible until an official Container-compatible private TCP path is configured and exercised. A private path proven only for App Worker Hyperdrive does not satisfy this requirement. A Container that executes Artifact-controlled Chromium MUST NOT receive this direct database path.

#### Scenario: Request uses a Hyperdrive-compatible query path

- **WHEN** a request performs a database operation whose complete semantics are covered by the cache-disabled Hyperdrive compatibility suite
- **THEN** the Cloudflare database Adapter executes it without changing its transaction or freshness result

#### Scenario: Operation requires an advisory lock

- **WHEN** migration or another operation requires session behavior not supported through Hyperdrive
- **THEN** the target executes the complete operation through the verified direct PostgreSQL path rather than weakening or emulating the lock

#### Scenario: Required direct connection is unavailable

- **WHEN** read-only `doctor` finds no qualified direct PostgreSQL configuration or pre-traffic Container qualification cannot exercise the configured path
- **THEN** it marks the affected release capability ineligible and performs no traffic change

#### Scenario: Hyperdrive reaches a private database but a trusted processing Container cannot

- **WHEN** App Worker queries succeed through Hyperdrive or Workers VPC but the Rust Container has no verified direct TCP path to the same PostgreSQL authority
- **THEN** the affected processing readiness fails and the target does not claim that capability available

#### Scenario: An execution loses local state

- **WHEN** an App Worker, content-only Worker, Queue consumer, scheduled execution, or Container restarts
- **THEN** the next execution reconstructs authoritative state from PostgreSQL and R2 without consulting a parallel Cloudflare business store

#### Scenario: Database migration is requested

- **WHEN** a Cloudflare release contains unapplied migrations
- **THEN** the one-shot release phase applies them through the direct PostgreSQL path before new application traffic

### Requirement: Use Queue messages only as non-authoritative wake-up signals

The Cloudflare target SHALL persist the authoritative job or maintenance intent and a recoverable dispatch record in PostgreSQL before publishing a Cloudflare Queue message. Queue messages SHALL contain only bounded non-sensitive identifiers and wake-up metadata and MUST NOT contain credentials, raw Artifact bytes, email payloads, or authoritative job state.

Duplicate, delayed, reordered, stale, or missing at-least-once deliveries MUST be resolved through the existing PostgreSQL claim, attempt, lease, heartbeat, fence, idempotency, and terminal-state contracts. Scheduled reconciliation SHALL discover committed work whose wake-up signal was not delivered or was exhausted.

A Queue consumer that wakes Rust processing SHALL select one configured runner-slot identity, obtain its Container Durable Object stub, start or nudge that Container, persist the controller handoff outcome, and return within the Queue-consumer invocation bound. Queue acknowledgment SHALL mean only that the handoff was processed; it MUST NOT be recorded as authoritative completion of the PostgreSQL job. Stable slot count, Container `max_instances`, and PostgreSQL fences SHALL jointly bound concurrency.

#### Scenario: Queue delivers the same wake-up twice

- **WHEN** two consumers receive duplicate messages for one durable job
- **THEN** PostgreSQL claim and fence state permits at most one authoritative attempt outcome and the other wake-up becomes harmless

#### Scenario: Queue delivers messages out of order

- **WHEN** an older wake-up arrives after the referenced job has advanced or completed
- **THEN** the consumer observes current PostgreSQL state and performs no stale transition

#### Scenario: Database commit succeeds before Queue publication

- **WHEN** a transaction commits a job and dispatch record but immediate Queue publication fails
- **THEN** dispatch recovery or scheduled reconciliation republishes a wake-up without losing the authoritative job

#### Scenario: Queue message is permanently lost

- **WHEN** no wake-up for committed pending work remains deliverable
- **THEN** scheduled reconciliation discovers that PostgreSQL work and creates another bounded wake-up opportunity

#### Scenario: Queue handler starts a Runner

- **WHEN** a Queue consumer successfully addresses or starts a bounded Container slot
- **THEN** it returns after recording the handoff while either the trusted Container claims work or the jobs Worker retains the thumbnail claim, and PostgreSQL remains the only authority for job completion

#### Scenario: Wake storm exceeds available slots

- **WHEN** concurrent wake-ups exceed the configured Container runner-slot count
- **THEN** they converge on the bounded stable slots or defer through durable dispatch state without creating one Container identity per job

### Requirement: Drain enabled background lanes in bounded executions

The Cloudflare target SHALL expose bounded Runners over the same processing Modules used by the resident Kubernetes runtimes. Bounded execution SHALL cover every processing, thumbnail, Gallery, cleanup, reconciliation, and authentication-email lane required by enabled product capabilities.

Each Container or non-request Worker execution SHALL have configured limits for claims, wall time, concurrency, memory, CPU, and temporary disk appropriate to that runtime. Every production Container SHALL explicitly set `ssh.enabled = false`, provide no authorized keys, and expose no SSH access path. A trusted processing Container SHALL claim authoritative work from PostgreSQL, heartbeat and fence each running attempt, stop claiming before its deadline or termination grace period, and exit after bounded idle observation.

A Container that runs Artifact-controlled Chromium SHALL be secretless and SHALL have no direct PostgreSQL or R2 connection. The Jobs Worker SHALL claim and fence its attempt before start. A private execution broker SHALL issue a short-lived single-use bootstrap grant that is consumed to establish only a path-scoped read-only capture session for one immutable Version and attempt, plus a separate controller/output capability for heartbeat, output upload, and fenced commit. Consuming the bootstrap grant SHALL NOT make it reusable; later manifest requests use only the derived session.

The controller/output capability MUST NOT enter a page URL, Cookie, document, browser request-visible header, or Artifact-readable process state. The broker SHALL reject either capability when used for the other audience or operation. All broker database and R2 access SHALL execute outside the Container.

Temporary Container disk and process memory MUST NOT contain the sole durable copy of input, output, retry, or completion state. An idle Cloudflare installation MUST NOT require a resident processing Container to remain running.

#### Scenario: Queue wakes an idle Container

- **WHEN** a valid wake-up arrives for pending work and no suitable bounded Runner is active
- **THEN** the target starts or addresses a stable Container slot after the trusted Runner or jobs Worker establishes authoritative PostgreSQL claim state rather than trusting the Queue payload as the job

#### Scenario: Backlog exceeds one execution bound

- **WHEN** pending work remains after a Runner reaches its claim, time, or resource limit
- **THEN** it stops safely with durable leases and outcomes intact and arranges another wake-up without becoming an unbounded daemon

#### Scenario: Container becomes idle

- **WHEN** no claimable work remains for the configured idle interval
- **THEN** the Container exits or suspends according to bounded target policy without keeping local state authoritative

#### Scenario: Container terminates during an attempt

- **WHEN** a Container receives termination or stops before committing an attempt
- **THEN** it stops new claims and later recovery resolves the attempt without accepting an unfenced completion

#### Scenario: Container loses temporary disk

- **WHEN** Cloudflare replaces a Container and discards its local filesystem
- **THEN** committed PostgreSQL and R2 state remains sufficient to recover or retry every unfinished operation

#### Scenario: Thumbnail Container requests database or storage authority

- **WHEN** the secretless thumbnail Container attempts to reach PostgreSQL, an R2 endpoint, or a broker operation outside its bound capture-session or controller authority
- **THEN** the platform and broker deny the request without exposing a credential or accepting a business transition

#### Scenario: Artifact code crosses its capture-session authority

- **WHEN** Artifact-controlled code presents the browser-visible capture session to heartbeat, upload, commit, another mutation operation, or another Version or attempt
- **THEN** the broker rejects the audience mismatch and performs no database or R2 mutation

#### Scenario: Artifact code replays the bootstrap grant

- **WHEN** Artifact-controlled code reuses a consumed bootstrap grant after the browser capture session was established
- **THEN** the broker rejects the grant replay while valid manifest asset requests continue only through the derived session

### Requirement: Keep Cloudflare request isolates bounded

The trusted App Worker and content-only Worker request handlers MUST NOT start resident timers, polling loops, migration work, reconciliation dispatchers, email dispatchers, or background promises whose completion depends on an isolate remaining alive after the response.

#### Scenario: App Worker handles an ordinary request

- **WHEN** the App Worker completes an API, Viewer, Gallery, or Web request
- **THEN** the response does not depend on a resident dispatcher or unbounded post-response loop

### Requirement: Deliver authentication email through the Resend HTTPS Adapter

Authentication-email delivery SHALL implement the shared `account-entry` durable-delivery contract while using the Resend HTTPS API from a bounded Queue or scheduled execution. The Resend HTTPS Adapter SHALL use an operator-provided verified sending domain with click and open tracking disabled and a domain-scoped sending-access API key held as a Cloudflare Secret. Configuration SHALL declare a non-secret Resend team namespace and transport revision. An unattempted pending delivery SHALL bind no transport until its first claim atomically freezes the then-current team, sender/domain, endpoint, payload digest, and logical key. Key rotation MAY continue an attempted delivery only when it is proven to remain in the same team with the same required domain scope; an attempted pending or indeterminate delivery MUST NOT migrate automatically to another team, sender, or Adapter. The Adapter SHALL call `POST /emails` with `Authorization: Bearer ...`, `Content-Type: application/json`, a stable ShareSlices `User-Agent`, and `Idempotency-Key`. The JSON body SHALL contain required `from`, one-element `to`, and `subject` fields plus the selected `text` and `html` content and no attachments. Queue messages and deployment records MUST NOT contain the API key or decrypted email payload.

One immutable logical delivery ID and payload digest SHALL determine an idempotency key no longer than the provider limit. Before the first possible provider side effect, the delivery SHALL atomically freeze a conservative safe-replay cutoff from the local pre-send time, the pinned 24-hour Resend retention, and a declared clock/transport safety margin; no retry, restart, or rotation may extend it. Every retry of that delivery SHALL reuse the same key and byte-equivalent provider payload. After the prior call's maximum deadline and safety margin with observed quiescence, a successor fenced attempt MAY replay an indeterminate network or server outcome only before the frozen cutoff and while the request retains the exact team, key, sender, and payload. The Adapter SHALL treat provider idempotency as a bounded retry aid, not durable exactly-once delivery. When Resend accepts the request, the shared `sent` state SHALL retain its cross-provider meaning of transport or provider acceptance; the Adapter SHALL record the provider message identifier and shared `provider_accepted` classification without introducing an inbox-delivery state. A network-indeterminate delivery that remains unresolved at the cutoff SHALL follow the shared manual-reconciliation outcome and MUST NOT be blindly sent again.

Retry classification SHALL use the Resend error `type` and documented retry or quota headers. At minimum it SHALL map `invalid_idempotency_key`, `invalid_idempotent_request`, `concurrent_idempotent_requests`, `rate_limit_exceeded`, `daily_quota_exceeded`, and `monthly_quota_exceeded`, plus documented authentication, domain, validation, and policy failures. Unknown types, non-JSON responses, network failures, and server failures SHALL receive conservative bounded handling. The first release SHALL NOT ingest Resend delivery webhooks; final delivered, bounced, or complaint status remains outside this change.

The Deployment Module MUST NOT create or administer the Resend account or sending domain. `doctor` SHALL validate the Secret reference, HTTPS endpoint, exact sender-domain relationship, declared disabled-tracking prerequisite, and other non-secret configuration without requiring a broader Resend API key. Because a sending-only key cannot query remote domain, tracking, full quota headroom, bounce rate, spam-complaint rate, or account suspension state, those facts require fresh operator/dashboard evidence or remain explicitly unknown. A live acceptance probe SHALL occur only through explicitly authorized deep verification. Resend quota, deliverability-health, or plan degradation MUST be reported separately and MUST NOT change API request readiness.

The operator contract SHALL disclose that ShareSlices local payload deletion does not control Resend's provider-side retention. Provider message-content storage settings and free-tier quotas are mutable account facts, not capabilities guaranteed by this target.

#### Scenario: Authentication email is pending

- **WHEN** PostgreSQL contains a deliverable authentication-email record
- **THEN** a bounded triggered execution leases it, calls Resend with the configured sender, stable `User-Agent`, logical-delivery idempotency key, and unchanged payload, and commits the classified retry or terminal outcome

#### Scenario: Resend accepts a send request

- **WHEN** Resend accepts the email request and returns a provider message identifier
- **THEN** the Adapter records the existing `sent` transport-acceptance state, provider identifier, and `provider_accepted` classification without claiming that the recipient server or inbox accepted it

#### Scenario: Resend is unavailable or rate-limited

- **WHEN** Resend returns a rate-limit response, a transient provider response, or cannot be reached
- **THEN** the Adapter classifies the documented error type and headers and applies the corresponding durable retry, degradation, or terminal rule without changing API readiness or publishing the email body to a Queue

#### Scenario: Resend response is indeterminate before the safe-replay cutoff

- **WHEN** a prior call is quiescent after its maximum deadline and safety margin, current time remains strictly before the frozen cutoff, and the qualified Resend contract covers the delivery's frozen team-scoped key and byte-equivalent payload
- **THEN** a successor fenced attempt may replay that exact logical delivery and classifies any concurrent-idempotency response without changing the key, payload, sender, team, or delivery identity

#### Scenario: Provider idempotency window expires with an indeterminate outcome

- **WHEN** ShareSlices cannot prove acceptance or rejection before the conservative safe-replay cutoff frozen for Resend's first possible send
- **THEN** the delivery enters the shared indeterminate/manual-reconciliation outcome and is not automatically resent under a new key

#### Scenario: A restart occurs near the Resend cutoff

- **WHEN** a retrying executor restarts or observes clock skew near the frozen safe-replay cutoff
- **THEN** it does not recompute or extend the 24-hour window and makes no automatic provider call at or after the cutoff

#### Scenario: Authentication-mail tracking is enabled

- **WHEN** the configured Resend sending domain cannot attest that click and open tracking are disabled for authentication mail
- **THEN** email capability verification fails because link rewriting could change verification or recovery URLs

#### Scenario: Resend prerequisite is missing

- **WHEN** the API-key Secret reference, verified sender-domain configuration, or sender identity is absent
- **THEN** `doctor` reports the Resend Adapter unavailable before release activation without exposing Secret values

#### Scenario: Resend team changes during an attempted delivery

- **WHEN** an attempted pending or indeterminate delivery's current Secret or configuration resolves to another or unproven Resend team or sender/domain scope
- **THEN** the dispatcher refuses automatic retry or migration and preserves the frozen team namespace and payload identity for the original transport or manual reconciliation

#### Scenario: Resend configuration changes before first claim

- **WHEN** an unattempted pending delivery is first claimed after the Resend configuration changed
- **THEN** the claim transaction freezes the then-current validated team, sender/domain, endpoint, revision, payload digest, and logical key before the HTTPS request

#### Scenario: Deep verification sends a test email

- **WHEN** an operator explicitly authorizes deep verification with a test recipient
- **THEN** the verifier exercises one durable Resend delivery and records only redacted evidence and the provider result

#### Scenario: Scheduled reconciliation is delayed

- **WHEN** a scheduled trigger does not run at its expected instant
- **THEN** the next bounded run recovers overdue durable intents from PostgreSQL without assuming each interval executed exactly once

### Requirement: Deploy immutable Cloudflare releases in ordered phases

A Cloudflare release SHALL identify immutable App Worker code, content-only Worker code, Jobs Worker bundle, Static Assets manifest, Jobs Durable Object `exports` and migration/configuration identity, Container image content digests plus qualified provider references, route projection, configuration digest, migration digest and head, shared contract revisions, and N/N-1 compatibility metadata. Its deployment record SHALL retain the observed provider version or deployment identity for every Worker role. A Container provider reference SHALL use a provider digest when supported or a never-reused release tag verified against the recorded content digest when the pinned interface exposes only image tags. A release MUST NOT claim digest pinning that the provider cannot observe. Each Cloudflare resource, Secret binding, and field MUST have one declared deployment owner so infrastructure automation and Worker-version automation do not compete to manage it.

The Secret-free R2 deployment-record mirror SHALL be written only after the authoritative PostgreSQL lease and fence are validated. The Adapter SHALL reject a newer encoded mirror fence, update an existing object only with its current ETag match, and create an absent object only with `If-None-Match: *` or a qualified equivalent wildcard precondition. A precondition failure, lease loss between read and write, or indeterminate response SHALL stop every phase that depends on the mirror and reconcile from PostgreSQL plus the current R2 object; an old fence MUST NOT retry directly. The mirror MUST NOT grant or extend a deployment lease.

Before the Cloudflare target is declared supported, a disposable-account release gate SHALL prove App and Content version creation, zero-percent route-free exact-version verification through fetch Service Bindings, route-free Jobs functional verification, trigger-isolated Jobs Worker deployment, Container image availability, rolling mixed-version compatibility, retained-image rollback, and preservation of bound resources. Production configuration SHALL set both `workers_dev = false` and `preview_urls = false`.

An App or Content candidate uploaded with `wrangler versions upload` SHALL be added to the current deployment at zero percent before a version override can select it, and the two-version deployment limit SHALL be checked before staging. Zero percent controls ordinary traffic allocation but is not access control: on an upgrade, an external request to an existing route can present the version-override header. Before entering the current deployment, every candidate MUST therefore satisfy the complete production authentication, authorization, route, Cookie, cache, security-header, logging, and Secret-handling contract, contain no preview-only bypass or debug authority, and treat its version ID as non-secret.

Exact-version verification SHALL use a release-only, route-free verifier Worker triggered through an isolated temporary Queue and connected to App, Content, and Jobs by fetch-based Service Bindings. The consumer SHALL be created delivery-paused, resume only for one nonce-bound bounded probe, handle duplicate delivery as the same idempotent fenced operation, and pause again as soon as its result is observed. The verifier and target Workers MUST have `workers_dev` and preview URLs disabled, and the verifier MUST NOT have a public route or use production Queue or Cron. Because the documented override is an HTTP request header, RPC Service Bindings MUST NOT be used for version selection. Every App or Content probe SHALL confirm the actual version ID from `version_metadata` or correlated provider logs and fail if the override silently falls back to ordinary traffic routing. The route-free Jobs probe SHALL report the executing Worker version or deployment identity, embedded release-bundle identity, ordinary-configuration and `exports` digest, and configured Container image reference; the controller SHALL compare every value with the authorized release rather than accepting functional success from an older Jobs deployment. The route-free harness SHALL protect its trigger and evidence but MUST NOT be described as making an upgrade candidate unreachable through an existing production route.

Before Queue publication, the Deployment Module SHALL create the active PostgreSQL probe record only under the exact live Cloudflare deployment operation, owner, lease, release, and fencing token. Recovery MAY replay only the identical nonce, release, fence, sub-fence, and canonical expected Container identity; a conflicting existing nonce MUST block publication. The temporary Queue SHALL contain only a nonce plus release, fencing, expected App/Content versions, expected Jobs deployment/bundle/configuration identity, and expected Container image build identity and provider reference. Through a checked private wire contract, the verifier SHALL call the route-free Jobs `fetch` probe and record release-and-fence-scoped private evidence for those actual identities, the migration head, database path, and execution-broker scope. Each Container image SHALL embed an immutable build identity, release ID, and contract revision known before publication; the release manifest SHALL map that identity to the image content digest and qualified provider reference without claiming that a process can self-measure its registry digest. The verifier SHALL exercise every production-capable stable trusted-processing and thumbnail slot within the configured concurrency bound. Each actual instance SHALL return its embedded identity together with release, fence, nonce, class, slot, and provider instance identity. The controller SHALL correlate those values with provider rollout state and SHALL accept convergence only when every such slot runs the expected build and no prior-image instance remains selectable. Provider deployment metadata, a selected image, a Container listing, or one compatible instance alone MUST NOT count as functional or convergence verification. That contract SHALL reject every public, production-Queue, Cron, stale-fence, or unscoped caller.

Every synthetic database row, broker attempt, Container invocation, and R2 object created by the probe SHALL be positively owned by the release, fence, and nonce, SHALL use a dedicated non-product namespace, and MUST NOT select or mutate a real account, delivery, Artifact, Version, Publication, or job. Before cleanup, the Deployment Module SHALL atomically record the validated redacted evidence digest, mark the nonce terminal, and revoke or advance its probe sub-fence in the authoritative PostgreSQL journal. Every verifier, Jobs, broker, and Container synthetic mutation SHALL recheck the live nonce and sub-fence at its authoritative database write or commit boundary so work that has not crossed an external side-effect boundary becomes a no-op or rejected stale write.

After marking the nonce terminal, the Module SHALL immediately pause and detach the verifier consumer, drain or fence every nonce-scoped active invocation lease, and wait the pinned maximum in-flight Worker, Container, broker, database, and object-write interval plus its safety margin. Queue pause MUST NOT be reported as cancellation or drainage of an already-running consumer. Because a PostgreSQL pre-check is not atomic with an already-started R2 write, only a post-quiescence final inventory and idempotent cleanup MAY prove positively owned synthetic state, temporary resources, and raw evidence absent. The terminal nonce tombstone SHALL remain through a bound computed from the observed maximum Queue retention, send/retry delay and retry schedule, active-invocation lease, interrupted-recovery interval, and cross-storage side-effect interval, plus a pinned safety margin; its expected retention SHALL NOT be reported as an orphan or block activation. It MAY be garbage-collected only after that bound and another no-owned-state check. Unconfirmed nonce marking, quiescence, or cleanup SHALL remain a non-public isolated orphan in status and MUST NOT activate product ingress, Queue delivery, Cron, or the scheduled-execution gate.

The first deployment of any Worker script cannot rely on `wrangler versions upload`. It SHALL use the pinned immediate-deployment interface against the final script name in a no-ingress bootstrap state. App and Content scripts have no public route or custom domain during bootstrap. Before the Jobs bootstrap, the selected qualified Container image SHALL be available and verified; that bootstrap SHALL select the image and declare every stable Container class while the Jobs script has no public route or Cron trigger and any Queue consumer remains delivery-paused. The bootstrap bundle SHALL only establish stable script and Durable Object identity; the actual release Jobs bundle SHALL be deployed separately through the trigger-isolated immediate path.

The ShareSlices Jobs Worker SHALL use Durable Object `exports` for its Container classes. A minimal exports-only Worker MAY establish provider-interface compatibility, but ordinary releases MUST NOT use `wrangler versions upload` until the complete Container-bearing Jobs configuration, Secret path, activation behavior, and rollback semantics pass the pinned disposable-account gate. Until then, the qualified Container image SHALL be available before immediate Jobs deployment. The initial Jobs bootstrap SHALL declare every stable Container Durable Object class required by the release.

On an upgrade, the PostgreSQL-backed scheduled-execution gate SHALL close so a late scheduled invocation becomes a fenced no-op. Queue delivery SHALL pause, Cron SHALL detach, the control plane SHALL be reread for expected absence, the full maximum propagation interval recorded by the pinned platform baseline SHALL elapse, and in-flight work SHALL be drained, expired, or safely fenced. The platform does not expose global propagation completion, so automation MUST NOT claim to have observed it. On a first installation before the product migration creates that gate, the Jobs script MUST have no active Queue delivery, Cron trigger, public route, `workers.dev` address, or preview URL; the migration SHALL create the gate closed before any trigger attaches. Queue, Cron, and the scheduled-execution gate SHALL remain isolated until every migration, staged probe, candidate activation, and applicable public-route verification passes.

A later Durable Object class lifecycle change MUST be refused by ordinary apply and handled through a separately authorized maintenance procedure. Automatic rollback MUST NOT cross such a change.

Queue consumers, Cron schedules, custom domains, and routes bind to Worker script identity rather than one Worker version and therefore invoke the script's active deployment. Before the first provider mutation, including a first-install bootstrap, `apply` SHALL prove that every proposed Terraform-owned field remains compatible with the active release and its recorded rollback candidate when either exists; a first installation SHALL record that neither predecessor is present. A breaking route, binding-resource, Queue-consumer, scheduled-trigger, Hyperdrive, or durable-resource transition MUST be refused by ordinary apply and handled through a separately authorized maintenance procedure.

`apply` SHALL use at least two observed Terraform phases. The prerequisite phase MAY create or expand private R2, Queues, Hyperdrive, and DNS or TLS prerequisites only when they neither bind a Worker nor expose a serving address. A Queue consumer MAY be attached only while queue delivery is explicitly paused. Worker custom-domain attachments, public routes, and scheduled triggers MUST remain absent until activation.

After App and Content versions and their staged Secrets, qualified Container images, the trigger-isolated release Jobs deployment with preserved or explicitly supplied Secrets, pre-migration probes, and the one-shot migration are complete, the release-only verifier harness SHALL reverify the exact staged App and Content version IDs, exact Jobs identity, database and broker behavior, and actual image build identity of every production-capable stable Container slot against the observed migration head. The harness nonce SHALL be marked terminal and its consumer SHALL be paused, detached, and brought through bounded quiescence and final cleanup before product trigger activation.

On a first installation, the phase SHALL promote Content and then App candidates to 100 percent and reverify their actual version IDs through the release-only harness while no public ingress exists. Before attaching ingress, it SHALL replace each App and Content current deployment with a candidate-only deployment, reread the provider state until the exact candidate-only membership is observed, and prove that an override naming the bootstrap version no longer selects it. Only after that negative check and safe harness detachment SHALL it attach Content ingress and then the App custom domain and public routes, and run black-box verification while Cron remains absent, Queue delivery remains paused, and the scheduled-execution gate remains closed. Only after that verification succeeds SHALL it attach Cron, reread the expected control-plane state, wait the full pinned maximum propagation interval, resume Queue delivery, and open the scheduled gate last.

On an upgrade, existing entry resources SHALL remain attached to the script identities while the phase shifts Content first and App/Static Assets last and completes black-box verification with product triggers still isolated. It SHALL then restore Cron through the same control-plane read and full safety interval, resume Queue delivery, and open the scheduled gate last. Neither branch may treat custom-domain attachment as version selection or expose the first-install bootstrap deployment between route attachment and candidate activation.

Existing in-flight Queue messages remain subject to PostgreSQL claims and fences during pause or compensation. Every phase SHALL record its observed state before the next begins.

Cloudflare Container replacement is rolling rather than atomic, so previous and new controllers, images, and job contracts MUST remain compatible throughout rollout. After any failed staged, migration, post-migration, candidate-reverification, or pre-traffic phase, compensation SHALL remove each failed App or Content candidate from its current deployment and observe the exact replacement membership. On upgrade that membership SHALL be the retained previous version only; on first installation it SHALL be the retained bootstrap version only with public routes absent. Retained version artifacts MAY remain in version storage for evidence or recovery but MUST NOT remain override-selectable through the current deployment. If candidate removal is failed or indeterminate, status SHALL be degraded and blocked and product triggers MUST remain isolated. On upgrade it SHALL also state that the candidate remains externally selectable through the existing route and MUST NOT claim that the previous release alone is serving.

Rollback SHALL reactivate compatible previous App and Content deployments with their recorded code, Static Assets, bindings, and version-scoped Secrets. Jobs rollback SHALL close the scheduled-execution gate, pause Queue delivery, detach Cron, reread the expected control-plane absence, wait the full maximum propagation interval from the pinned baseline, and immediately redeploy the retained compatible Jobs bundle that selects the previous Container image and configuration. That Jobs deployment SHALL be followed by a separately observed rolling replacement of Container instances; Jobs Worker activation MUST NOT be treated as Container convergence. After verification, Cron restoration SHALL be confirmed in the control plane and held behind the same full safety interval, Queue delivery SHALL resume, and the scheduled-execution gate SHALL open last.

Routes, custom domains, Cron triggers, Queue consumers, Hyperdrive configurations, R2 buckets, and Queues SHALL remain at current infrastructure state under the field's single qualified owner and MUST be proven compatible with the previous Worker and Container contracts. Rollback MUST refuse across a Durable Object lifecycle change, when a recorded Worker version has left the provider-addressable 100-published-version window, or when the previous Jobs bundle, binding, backing resource, retained Container image, selectable Container configuration, or long-lived resource compatibility is unavailable.

Rollback MUST NOT execute an automatic down migration, rewind IaC, delete R2 data, or claim that PostgreSQL schema or durable state was reversed.

#### Scenario: Cloudflare apply succeeds

- **WHEN** every prerequisite, migration, compatibility check, staged probe, traffic shift, and black-box verification succeeds
- **THEN** release status records the immutable Cloudflare artifact digests and observed production versions as the current release

#### Scenario: Migration fails

- **WHEN** the one-shot migration phase fails or its checksum history is inconsistent
- **THEN** automation restores and observes previous-only App and Content current deployments on upgrade, removes the failed release candidates from override selection, keeps product triggers isolated, and reports the forward migration state without claiming an automatic down migration

#### Scenario: First installation fails before activation

- **WHEN** a first installation fails migration, staged verification, candidate activation verification, or Container qualification before public activation
- **THEN** no App or Content Worker custom-domain attachment or public route, active Queue delivery, or scheduled trigger exists; a pre-created Queue consumer is either absent or observed delivery-paused; current deployments are observed bootstrap-only with failed release candidates absent; any unconfirmed candidate or verifier cleanup remains non-public, isolated, and blocked in status; and the release remains inactive

#### Scenario: Activated first-install candidate fails isolated reverification

- **WHEN** a first-install Content or App candidate was promoted while ingress was absent but the release-only harness cannot prove the expected active version or migration-head contract
- **THEN** public ingress and product triggers remain absent, Queue delivery remains paused, the scheduled gate remains closed, bootstrap-only current deployment membership is restored and observed so the failed release candidate is absent, and the release is not activated

#### Scenario: First installation attaches public ingress

- **WHEN** the first installation has reverified the activated App and Content candidate version IDs, observed candidate-only current deployments, and proved an override cannot select either bootstrap version while no public ingress exists
- **THEN** it detaches the verifier harness, attaches Content ingress and then the App custom domain and public routes, verifies those routes while background triggers remain isolated, and only then restores Cron, Queue delivery, and the scheduled gate in order so the bootstrap deployment never receives a public request

#### Scenario: First-install public verification fails

- **WHEN** newly attached first-install ingress fails black-box verification before background activation
- **THEN** automation detaches positively owned ingress, leaves Cron absent, Queue delivery paused, and the scheduled gate closed, and reports the release inactive

#### Scenario: Container rollout is mixed

- **WHEN** Cloudflare is rolling from the previous Container image to the new image
- **THEN** both images and the active jobs Worker use N/N-1-compatible database, job, broker, and object contracts until convergence is observed

#### Scenario: Staged content probe fails

- **WHEN** the new content-only Worker fails route, R2, authorization, policy-header, or isolation verification before traffic shift
- **THEN** automation replaces and observes the current deployment as previous-only before reporting compensation; if removal is not confirmed, it reports the failed candidate as externally selectable and keeps the release and triggers blocked

#### Scenario: Traffic verification fails

- **WHEN** a new App or content deployment receives traffic but shared black-box verification fails
- **THEN** the Adapter reactivates and observes prior-only App and Content current deployments so the failed candidates are no longer override-selectable, separately converges the retained compatible Container image and configuration when they changed, and reports that PostgreSQL remains at its forward migration head

#### Scenario: Jobs functional probe reaches the wrong release

- **WHEN** the route-free Jobs probe succeeds functionally but reports a Worker deployment, release-bundle, configuration/`exports`, or configured image different from the authorized release, any production-capable stable slot returns the wrong embedded build/release/contract identity, or a previous-image instance remains selectable
- **THEN** verification fails, product triggers remain isolated, and no functional result from that older or unexpected Worker or Container is accepted as release or convergence evidence

#### Scenario: Synthetic verifier state cannot be cleaned

- **WHEN** a release-only probe succeeds, fails, or is interrupted after creating nonce-owned synthetic state and bounded quiescence plus final inventory cannot prove every owned row, attempt, invocation, and object except the retained terminal tombstone removed
- **THEN** status reports the exact isolated orphan scope, real product records remain untouched, and product ingress and triggers do not activate until reconciliation confirms quiescence and cleanup; a correctly retained tombstone alone is normal control state and does not block activation

#### Scenario: A duplicate verifier invocation is already in flight during cleanup

- **WHEN** the nonce is marked terminal while a duplicate Worker, broker, Container, database, or R2 operation has already started
- **THEN** new writes fail the nonce or sub-fence pre-check, active invocation leases are drained or fenced through the bounded in-flight window, and final inventory runs only afterward so a late external write cannot recreate cleaned synthetic state

#### Scenario: Previous application is not compatible

- **WHEN** requested rollback metadata cannot prove compatibility with the current schema or already committed job contracts
- **THEN** automatic rollback refuses the unsafe transition and reports the required recovery action

#### Scenario: Previous Container image was removed

- **WHEN** the previous release record identifies a Container image or configuration that is no longer retained or selectable through the pinned provider interface
- **THEN** rollback refuses before traffic change and reports the invalidated release-retention contract

#### Scenario: Previous Worker version left provider retention

- **WHEN** bootstrap, verifier, or release churn has pushed a recorded rollback version outside the provider-addressable 100-published-version window, or one of its required binding resources no longer exists
- **THEN** rollback refuses before traffic or trigger mutation and reports that the local release bundle cannot restore the missing provider identity

#### Scenario: Current infrastructure is incompatible with the prior Worker

- **WHEN** a Terraform-owned route, trigger, Queue consumer, binding resource, or domain no longer satisfies the recorded prior Worker version
- **THEN** application rollback refuses without changing traffic and reports the separately reviewed IaC recovery or forward-fix required

### Requirement: Preserve the shared route and cache contract at the Cloudflare edge

The Cloudflare target SHALL consume the same machine-readable route and cache contract used by direct Kubernetes ingress and optional Kubernetes CDN delivery. Cloudflare's edge cache, Static Assets behavior, Cache API, Worker routing, or tiered cache MUST NOT change application status, authorization, revocation, credential, security-header, or `no-store` semantics.

The Cloudflare target SHALL model Edge/CDN as an explicit module with `web-assets-only` and `web-and-public-viewer-bytes` modes. `web-assets-only` SHALL be the default. Content-hashed release-manifest Web assets MAY use Workers Static Assets caching. The release SHALL generate a Static Assets `_headers` projection that gives content-hashed files immutable browser caching and gives the HTML shell and runtime bootstrap a release-coupled revalidation policy. Because `_headers` does not apply to responses generated by Worker code, every Worker-produced response SHALL attach its authoritative headers directly. Preview, stable Viewer responses, known Share-link state, management API, authentication, Upload, Gallery authorization, Gallery JSON, Gallery Download, isolated Artifact content, and every other contract-classified dynamic response MUST execute required Worker logic and preserve its cache directive on every request.

In `web-and-public-viewer-bytes` mode, the App Worker MAY populate and reuse an internal edge cache of committed immutable Version bytes only after current Publication authorization. Its cache identity SHALL include immutable Version content identity, normalized manifest path, and a canonical representation descriptor containing content type, content encoding, renderer or format revision, and every allowed response-negotiation input. The Worker MUST NOT vary a cacheable representation on an input omitted from that identity. Only a complete successful `200` representation within the configured Cache API size bound MAY populate that cache. A Range request or `206 Partial Content` response SHALL bypass Cache API population and reuse and stream the authorized range from private R2.

The cacheable internal representation SHALL be separate from the outward stable Viewer response. The Worker MUST NOT pass the outward `Cache-Control: no-store` response to `cache.put()` or return internal cache headers to the client; it SHALL construct the outward response with the product status, range, content type, security headers, and `no-store` policy after retrieving authorized bytes. It MUST NOT expose the internal cache identity, a public R2 address, or an authorization-bypassing version URL. Cache tags and purge MAY remove obsolete bytes as hygiene but MUST NOT be required for Unpublish, expiry, replacement, restriction, or access revocation to take effect.

#### Scenario: Request matches a dynamic route and a static path

- **WHEN** a path is classified as dynamic by the shared route contract even though Static Assets contains a matching or fallback file
- **THEN** the App Worker executes the dynamic route and Static Assets does not satisfy it

#### Scenario: Cloudflare receives a no-store response

- **WHEN** Preview, Viewer, Gallery content, or another dynamic route returns `Cache-Control: no-store`
- **THEN** Cloudflare forwards the directive and neither edge cache nor Cache API stores or reuses that response

#### Scenario: Publication closes between requests

- **WHEN** a Publication expires or is Unpublished after a prior Viewer response
- **THEN** the next Cloudflare request reaches authoritative application state and cannot be satisfied from prior Artifact bytes

#### Scenario: Immutable Web asset is requested

- **WHEN** a request targets a release-manifest asset explicitly classified as immutable and public
- **THEN** Workers Static Assets may cache it without expanding cacheability to a dynamic route

#### Scenario: Optional Viewer byte cache hits

- **WHEN** `web-and-public-viewer-bytes` is enabled and current Publication authorization fixes a Version content identity and normalized manifest path already held by the internal edge cache
- **THEN** the App Worker may reuse the immutable bytes while the stable Viewer route remains dynamic and `no-store`

#### Scenario: Viewer requests a byte range

- **WHEN** an authorized Viewer request includes a Range header or produces a `206 Partial Content` response
- **THEN** the App Worker bypasses optional Cache API population and reuse, streams the authorized range from private R2, and preserves the stable Viewer response's `no-store` and range semantics

#### Scenario: Populate an internal Viewer representation

- **WHEN** an authorized full-body Viewer asset miss returns a bounded successful representation eligible for internal reuse
- **THEN** the Worker stores a separate cacheable internal response and constructs the outward stable Viewer response independently with `Cache-Control: no-store`

#### Scenario: Cache lookup is attempted before Viewer authorization

- **WHEN** implementation or deployed routing can return optional Viewer bytes before current Publication authorization succeeds
- **THEN** verification fails the CDN capability and the target falls back to `web-assets-only` rather than serving the unsafe route

#### Scenario: Client requests R2 or an internal cache identity

- **WHEN** a client requests an `r2.dev`, R2 custom-domain, object-key, or internal cache-key address
- **THEN** no ShareSlices production route exposes the bytes and verification reports any provider-level public access as a release blocker

### Requirement: Verify Cloudflare target parity and fail closed

Cloudflare core `verify` SHALL be read-only and exercise the shared deployment contract through the production Web, API, Viewer, and isolated content addresses. It SHALL verify route ownership, statuses, Cookies, security headers, cache directives, private-object non-exposure, observed release metadata, and existing readiness evidence without creating product/provider state, sending mail, starting Containers, publishing Queue messages, or changing authorization. Stateful bounded-streaming, R2-read instrumentation, authorization/revocation transitions, Queue duplication/recovery, Container execution/termination, Upload, and delivery probes SHALL run only in an explicitly authorized isolated pre-traffic or deep verification level with positive ownership, bounded cleanup, and a result that identifies that level. Cache verification MAY combine those authorized probes with response headers; `CF-Cache-Status` MAY corroborate the result but MUST NOT be the sole evidence of a hit or bypass.

Core ShareSlices readiness, Gallery eligibility, email capability, processing capability, and thumbnail capability SHALL be reported separately. A capability that is optional for a configured installation MUST fail only the product behavior that depends on it, while a release MUST NOT claim that capability ready. A capability required by the selected production target still blocks that target's qualification even when Free-compatible prototype work can defer its implementation. In particular, deferring thumbnail work may report thumbnail readiness unavailable during prototyping but MUST NOT qualify the complete Cloudflare target. Gallery SHALL remain fail-closed unless the actual Cloudflare topology and all live readiness gates pass.

#### Scenario: Core application passes while Gallery is ineligible

- **WHEN** Web, API, Viewer, PostgreSQL, R2, and processing are healthy but the content site or a Gallery dependency is not eligible
- **THEN** status reports the core release ready and Gallery unavailable without exposing Gallery content or claiming full target parity

#### Scenario: Content route leaks a management credential

- **WHEN** verification observes a management Cookie, credentialed CORS, management route, or management `Set-Cookie` behavior on the content-only site
- **THEN** verification fails Gallery readiness and the content capability remains unavailable

#### Scenario: Queue wake-up is duplicated during deep verification

- **WHEN** an operator explicitly authorizes isolated deep verification and the contract delivers duplicate wake-up signals for one synthetic durable job
- **THEN** verification observes one authoritative terminal outcome and no duplicate object or business transition

#### Scenario: Production state differs from the verified release

- **WHEN** the observed Worker version, route, binding, provider-verifiable Container image identity, or configuration digest differs from the verified release
- **THEN** status reports drift and verify does not claim the release healthy

### Requirement: Protect Cloudflare configuration and ingress metadata

Cloudflare configuration SHALL distinguish checked non-secret values from Secret references and runtime bindings. Plans, rendered artifacts, release records, logs, Queue messages, and verification output MUST NOT contain Secret values, database credentials, email credentials, raw authorization tokens, raw Share slugs, raw Artifact content, or sensitive object keys.

The App Worker SHALL accept Cloudflare-derived client and transport metadata only from the trusted Cloudflare execution boundary, normalize it into the shared ingress metadata contract, and remove forged client-supplied forwarding headers before invoking the application. The content-only Worker SHALL apply the same request-identity and log-redaction contract without receiving management authority.

Terraform SHALL NOT own Cloudflare Worker Secret values. Required Secret names and operator-controlled non-secret revisions SHALL be checked inputs. App and Content Secret values SHALL be resolved only into a zero-percent ordinary-traffic candidate through the pinned Wrangler version-upload `--secrets-file` interface, then follow route-free verification and traffic shift. Because an existing production route can select that candidate with a version override, the candidate MUST already enforce the full production security contract and MUST NOT expose the Secret value or preview-only authority.

The Jobs path SHALL rely on the provider contract that ordinary `wrangler deploy` preserves existing encrypted Secrets. When Jobs Secrets change, the Deployment Module SHALL resolve them only into an ephemeral `--secrets-file` for the same Queue-paused, Cron-detached immediate deployment. It MUST keep omitted existing Secrets, verify every declared required Secret name after deployment, destroy the ephemeral file, and keep its contents out of logs, plans, bundles, state, and records. Standalone immediate-deploy Secret commands and versioned-Secret commands whose compatibility with the chosen Durable Object `exports` has not passed the pinned disposable-account gate MUST NOT be used. Rollback MAY restore retained bindings but MUST NOT claim that it restores a credential revoked or expired at an external provider.

Removing a Jobs Secret binding SHALL be a separate rollback-aware maintenance operation, not an omission from ordinary deploy. It MUST refuse while any active or retained rollback bundle requires the name. After the rollback window no longer depends on it, the operation SHALL close the scheduled-execution gate, pause Queue delivery, detach Cron, reread the expected control-plane absence, wait the full pinned maximum propagation interval, and use only a provider deletion interface proven with the selected `exports` configuration in a disposable account. Because the documented deletion command creates and immediately deploys a Worker version, the operation SHALL verify that the obsolete binding is absent, every required binding remains, the code, ordinary configuration, Durable Object `exports`, and selected Container image match the authorized pre-deletion bundle, and Jobs plus rolling Containers converge before restoring Cron, Queue delivery, and the gate in that order. If deletion succeeds but any postcondition fails or is indeterminate, triggers MUST remain isolated while the exact retained bundle re-adds the binding from the operator Secret source or an authorized forward-fix is applied. If no qualified deletion interface is available, automation MUST retain the binding and report the blocked retirement rather than invoking an unqualified standalone Secret command.

#### Scenario: Operator renders a Cloudflare plan

- **WHEN** deployment configuration refers to database, Resend, or signing Secrets, or to Secret-bearing R2, Hyperdrive, Queue, or Container configuration
- **THEN** the plan shows only stable reference names and redacted change evidence

#### Scenario: Client spoofs a forwarding header

- **WHEN** an external request supplies its own client-IP, scheme, host, or Cloudflare-named forwarding header
- **THEN** the trusted ingress Adapter discards the untrusted value and projects only metadata supplied by the actual Cloudflare boundary

#### Scenario: Secret is rotated

- **WHEN** an operator updates an App or Content Secret reference without changing product behavior
- **THEN** a zero-percent ordinary-traffic candidate records only the non-secret configuration revision, already enforces the production security contract, and verification proves the new binding without exposing either value

#### Scenario: Jobs Secret is rotated

- **WHEN** an operator updates a Secret consumed by the Jobs Worker
- **THEN** the scheduled-execution gate closes, Queue delivery pauses, Cron detaches through the control-plane check and full pinned safety interval, the target Jobs bundle deploys with an ephemeral Secrets file, required names and rollout state are verified, triggers resume through the same safety check, and the gate opens last without recording the Secret value

#### Scenario: Jobs Secret binding is retired

- **WHEN** an obsolete Jobs Secret name is absent from every active and retained rollback bundle and the pinned deletion interface passed the `exports` qualification gate
- **THEN** a separately authorized trigger-isolated maintenance operation removes that binding, proves the approved code, configuration, `exports`, and Container image did not change, verifies all remaining bindings and Worker/Container convergence, and restores Cron, Queue delivery, and the scheduled gate in order

#### Scenario: Jobs Secret deletion postcondition fails

- **WHEN** the provider removed the binding but the resulting Worker or Container deployment cannot prove every authorized non-Secret identity and retained binding
- **THEN** Cron remains absent, Queue delivery remains paused, the scheduled gate remains closed, and automation re-adds the binding from the operator Secret source with the exact retained bundle or requires an authorized forward-fix before any trigger is restored

#### Scenario: Jobs Secret retirement is not qualified

- **WHEN** a retained rollback bundle still requires the Secret or the pinned provider interface cannot prove safe deletion with the selected `exports` configuration
- **THEN** automation leaves the binding unchanged, reports the blocked least-privilege retirement, and invokes no unqualified standalone Secret command
