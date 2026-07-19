# kubernetes-deployment Delta Specification

## ADDED Requirements

### Requirement: Deploy into an existing conformant Kubernetes cluster

The Kubernetes target SHALL install ShareSlices application resources into a configured namespace of an existing conformant Kubernetes cluster. `doctor` SHALL perform only read-only validation of the release's supported Kubernetes version and APIs, namespace access, application resource permissions, required Secret references, declared external-dependency addresses and TLS policy, configured ingress prerequisites, declared egress mechanism, and current cluster conformance evidence.

Connectivity and NetworkPolicy enforcement from the future workload network SHALL be proven in an explicitly authorized pre-traffic qualification phase using isolated, release-owned probe resources that are removed afterward, or by unexpired operator-supplied conformance evidence that identifies the tested cluster and policy. Read-only discovery of a CNI or API MUST NOT be reported as proof of runtime enforcement. Failure of an allowed-flow or denied-flow probe SHALL stop activation.

The Kubernetes target MUST NOT provision the cluster, cluster nodes, provider network, externally supplied PostgreSQL service, externally supplied object-storage service, externally supplied email service, or optional external CDN account.

#### Scenario: Validate an eligible cluster

- **WHEN** the configured cluster exposes the supported APIs and every required read-only configuration, permission, external-dependency declaration, and current-evidence check succeeds
- **THEN** `doctor` accepts the Kubernetes prerequisites without creating application resources or claiming that the future workload path has passed activation qualification

#### Scenario: Reject an unsupported cluster

- **WHEN** the cluster is missing a required API or falls outside the release's supported Kubernetes version range
- **THEN** `doctor` reports the unsupported capability and `apply` does not begin

#### Scenario: Reject an invalid external dependency declaration

- **WHEN** PostgreSQL, S3-compatible storage, or email delivery is required but its endpoint, TLS policy, credential reference, or required evidence is missing or invalid
- **THEN** `doctor` fails before ShareSlices workloads are rolled out, without treating deployment-host reachability as proof of the future workload path

#### Scenario: Qualify workload-network enforcement

- **WHEN** an operator authorizes pre-traffic qualification for a release whose runtime network path is not already covered by valid conformance evidence
- **THEN** isolated probes prove required dependency flows and forbidden flows before application traffic is activated and are removed after evidence is recorded

### Requirement: Render one deterministic Kustomize release

The Kubernetes target SHALL render one deterministic Kustomize release containing the namespace-scoped ShareSlices resources and explicit migration and runtime phases. The rendered release SHALL use immutable image digests, configured names, Kubernetes service discovery, and Secret references. It MUST NOT depend on fixed `ClusterIP` values, hard-coded cluster addresses, mutable image tags, deployable placeholder credentials, or local files outside the rendered release bundle.

Equivalent validated configuration and release artifacts SHALL produce an equivalent canonical manifest digest.

#### Scenario: Render the release repeatedly

- **WHEN** the same Kubernetes configuration and immutable release bundle are rendered more than once
- **THEN** each render produces the same canonical manifest digest and phase ordering

#### Scenario: Resolve an internal service

- **WHEN** one ShareSlices workload connects to another in the configured namespace
- **THEN** the rendered configuration uses Kubernetes service discovery rather than a fixed service IP address

#### Scenario: Inspect rendered Secret handling

- **WHEN** the rendered release is reviewed or stored for GitOps
- **THEN** it contains required Secret references and no placeholder or resolved production Secret values

### Requirement: Separate Kubernetes workloads by runtime role

The Kubernetes target SHALL deploy distinct runtime roles for trusted Web delivery, trusted API request handling, maintenance processing, resident Rust processing, and one-shot schema migration. When Gallery is enabled, it SHALL deploy the Untrusted-content application as a separate content-only workload and Service from the trusted API.

The trusted API role MUST NOT own resident authentication-email dispatch or reconciliation loops. The maintenance role SHALL own those non-request loops without becoming a public request ingress. Each role SHALL receive only its required configuration, Secret references, network access, and service-account permissions.

#### Scenario: Start trusted request workloads

- **WHEN** the Web and API workloads become ready
- **THEN** they can serve their configured request routes without requiring the maintenance loops to run inside the API Pods

#### Scenario: Maintenance delivery is unhealthy

- **WHEN** the maintenance workload cannot reach the email provider
- **THEN** API request readiness remains independent while the maintenance failure is reported through its own health and deployment status

#### Scenario: Start Gallery content serving

- **WHEN** Gallery is enabled and deployment eligibility succeeds
- **THEN** untrusted Artifact content is served by the separate content-only workload rather than the trusted API application graph

#### Scenario: Inspect role credentials

- **WHEN** the rendered service accounts, configuration, and Secret references are compared
- **THEN** no role receives permissions or credentials solely because another role requires them

### Requirement: Run schema migration as a gated one-shot phase

The Kubernetes target SHALL run the release's checked migrations through a one-shot Kubernetes Job before advancing runtime workloads that depend on them. The Job SHALL use the immutable release migration artifact, verify migration checksums, and use the shared migration exclusion mechanism so only one execution advances the schema.

Application Pods MUST NOT run schema migration as a per-Pod init container. Scaling, restarting, or rolling an application Deployment MUST NOT rerun a migration already recorded as complete for that release.

#### Scenario: Apply a release with a pending migration

- **WHEN** the release contains a valid unapplied migration
- **THEN** the migration Job completes successfully before dependent runtime workloads advance

#### Scenario: A migration Job fails

- **WHEN** the migration Job exits without confirming the release migration
- **THEN** the runtime rollout stops and deployment status reports the failed migration phase

#### Scenario: Scale the API after migration

- **WHEN** the API Deployment adds or replaces Pods after the release migration completed
- **THEN** those Pods start without executing the schema migration again

#### Scenario: Retry the same release

- **WHEN** `apply` is retried after the migration was durably recorded as complete
- **THEN** the migration phase confirms the existing checksum and does not advance the schema a second time

### Requirement: Run durable processing through resident Kubernetes workers

The Kubernetes target SHALL run the Rust processing runtime as resident worker Pods covering every processing lane required by enabled product capabilities. PostgreSQL job, attempt, lease, fence, and idempotency state SHALL remain authoritative; Kubernetes restart or scaling events MUST NOT create a second source of job truth.

On termination, a worker SHALL stop claiming new work and perform a bounded drain of its current attempt. Work not durably completed before termination MUST become recoverable through the existing lease and fence rules.

#### Scenario: A resident worker is idle

- **WHEN** no durable job is claimable
- **THEN** the worker remains healthy without creating synthetic jobs or changing authoritative job state

#### Scenario: A worker Pod terminates during an attempt

- **WHEN** the Pod cannot durably complete its claimed attempt within the termination window
- **THEN** lease expiry permits a later worker to recover the work without accepting a stale completion

#### Scenario: Scale resident workers horizontally

- **WHEN** multiple worker Pods claim work concurrently
- **THEN** PostgreSQL leases, fences, and idempotency rules determine ownership and prevent duplicate terminal commit

### Requirement: Deliver authentication email through enterprise SMTP

The Kubernetes target SHALL deliver authentication email through an operator-provided enterprise SMTP service. The maintenance workload SHALL use the existing durable encrypted authentication-email records, leases, bounded retries, circuit breaker, terminal outcomes, and payload-deletion rules and SHALL supply them to the SMTP Adapter without moving delivery into an API request.

Deployment configuration SHALL reference the SMTP credentials through a role-scoped Secret and SHALL configure a declared relay namespace, sender identity, endpoint identity, non-secret configuration revision, and required TLS policy. An unattempted pending delivery SHALL bind no transport until its first claim atomically freezes those then-current non-secret identities with the local Message-ID and payload digest. Credential or endpoint rotation MAY continue an attempted delivery only when the operator contract proves the same relay authority and sender scope; otherwise an attempted pending or indeterminate delivery MUST NOT migrate automatically. The Deployment Module MUST NOT create, administer, or weaken the operator's SMTP service. SMTP delivery health MUST be reported separately from API request readiness.

Before SMTP can create an external side effect, the Adapter SHALL durably persist its attempt ID, fence, submitting phase, and maximum call deadline. Only a live fenced attempt with evidence that complete submission did not occur MAY retry. A Pod or process crash, lease loss, or timeout during `DATA`, after complete submission, while awaiting the final reply, or in an otherwise unknown side-effect phase SHALL become acceptance-indeterminate and MUST NOT return to pending. Manual reconciliation SHALL wait beyond that deadline and a configured safety margin and SHALL prove the provider attempt quiescent rather than treating lease expiry as quiescence.

#### Scenario: Enterprise SMTP prerequisites are configured

- **WHEN** `doctor` validates the SMTP endpoint, DNS, TLS and authentication capability, sender syntax, and resolvable credential reference without sending email
- **THEN** it reports the SMTP Adapter prerequisites configured without claiming provider acceptance or exposing the credential

#### Scenario: Enterprise SMTP accepts a test delivery

- **WHEN** an operator explicitly authorizes deep verification with a test recipient
- **THEN** the verifier performs a bounded SMTP transaction and records redacted provider-acceptance evidence only after the server's final successful response to the complete message, separately from API readiness

#### Scenario: Final SMTP acceptance response is lost

- **WHEN** the Adapter has submitted the complete SMTP message but the connection fails before it can determine the server's final response
- **THEN** it records an acceptance-indeterminate outcome for manual reconciliation and does not automatically resend, because SMTP provides no idempotency contract for that ambiguity

#### Scenario: SMTP executor crashes near DATA submission

- **WHEN** a Pod or process crashes or loses its lease after entering the durable submitting phase and the Adapter cannot prove complete message submission did not occur
- **THEN** recovery records acceptance-indeterminate for manual reconciliation and does not return the delivery to pending or automatically resend it

#### Scenario: Authentication email becomes deliverable

- **WHEN** the maintenance workload leases a durable authentication-email record
- **THEN** it sends the existing rendered message through the configured enterprise SMTP Adapter and records the shared retry or terminal outcome

#### Scenario: Enterprise SMTP is unavailable

- **WHEN** SMTP reports a transient connection or transaction failure proven to occur before complete message submission
- **THEN** the existing bounded retry and circuit-breaker policy applies while API request readiness remains independent; a failure after complete submission instead follows the acceptance-indeterminate scenario

#### Scenario: SMTP credentials are missing

- **WHEN** the role-scoped SMTP Secret or a required key is unavailable
- **THEN** `doctor` and maintenance capability status report email delivery unavailable without placing SMTP credentials in rendered output

#### Scenario: SMTP relay changes during an attempted delivery

- **WHEN** an attempted pending or indeterminate delivery resolves to a different or unproven relay namespace, endpoint authority, or sender identity than its frozen transport snapshot
- **THEN** the maintenance dispatcher refuses automatic retry or migration and retains the record for the original transport or manual reconciliation

#### Scenario: SMTP configuration changes before first claim

- **WHEN** an unattempted pending delivery is first claimed after the SMTP configuration changed
- **THEN** the claim transaction freezes the then-current validated relay, endpoint, sender, revision, Message-ID, and payload digest before opening the SMTP transaction

### Requirement: Route Kubernetes ingress according to the shared route contract

The Kubernetes target SHALL derive public and internal routing from the shared machine-readable route contract and SHALL route each path only to its owning workload. Public ingress MUST NOT expose internal capture, maintenance, migration, health-administration, or other internal-only operations.

When Gallery is enabled, the Untrusted-content workload SHALL have a distinct Service and ingress boundary whose configured browser site satisfies the Gallery isolation specification. Failure to prove that boundary MUST keep Gallery deployment-ineligible. A public production profile SHALL use explicitly configured TLS and ingress or Gateway ownership; an intranet profile SHALL support its configured IP-and-port addresses without requiring public DNS.

#### Scenario: Route a Viewer Share link

- **WHEN** a request for `/a/{shareSlug}/` reaches configured Kubernetes public ingress
- **THEN** ingress routes it to the Viewer-owning runtime with the status, headers, and path semantics defined by the shared route contract

#### Scenario: Request an internal operation through public ingress

- **WHEN** a public request targets an internal capture, maintenance, migration, or administration-only route
- **THEN** public ingress does not route the request to that operation

#### Scenario: Configure Gallery on an unsafe content site

- **WHEN** the configured Untrusted-content address does not prove a separate browser-site and credential boundary
- **THEN** deployment verification classifies Gallery as ineligible even if the content workload is otherwise healthy

#### Scenario: Use an intranet address without DNS

- **WHEN** the Kubernetes profile configures direct IP-and-port addresses and does not enable a capability that requires public-site isolation
- **THEN** the public route contract resolves through those addresses without requiring a domain name

### Requirement: Keep an external CDN optional and target-local

The Kubernetes target SHALL support `delivery.mode: direct` and `delivery.mode: external-cdn`. Direct mode SHALL expose the configured Kubernetes ingress directly. External-CDN mode SHALL place an operator-configured CDN in front of Kubernetes public ingress while retaining Kubernetes as the sole ShareSlices runtime target.

External-CDN mode MUST NOT require or deploy the Cloudflare target's App Worker, Content Worker, R2 storage, Queue, or Container runtime. It SHALL permit edge caching only for routes explicitly classified cacheable by the shared cache contract. It MUST preserve route status, security headers, credential behavior, CORS behavior, and every `Cache-Control: no-store` response without storage or replay by the CDN.

`plan` SHALL expose the required edge policy without Secret values, and `verify` SHALL test the externally configured CDN address against the shared product contract.

#### Scenario: Use direct ingress

- **WHEN** the Kubernetes configuration selects `delivery.mode: direct`
- **THEN** rendering and verification use direct Kubernetes ingress and plan no external-CDN runtime dependency

#### Scenario: Use Cloudflare only as an external CDN

- **WHEN** a Kubernetes installation selects `delivery.mode: external-cdn` and configures Cloudflare CDN in front of its Kubernetes origin
- **THEN** the installation remains the Kubernetes target and plans no ShareSlices Workers, Queue, R2, or Container runtime

#### Scenario: Serve a non-cacheable response through the CDN

- **WHEN** the origin returns `Cache-Control: no-store` for a Preview, Viewer, known-link, authenticated, or other non-cacheable route
- **THEN** the CDN forwards the response without storing it and a later request is resolved through the origin contract again

#### Scenario: CDN changes observable behavior

- **WHEN** verification observes a status, security header, credential, CORS, route, or cache result that differs from the shared contract
- **THEN** verification fails the Kubernetes release rather than accepting provider-specific behavior

### Requirement: Apply a production Kubernetes security and availability baseline

The Kubernetes target SHALL render workload health probes that call endpoints implemented by the corresponding runtime, explicit CPU and memory requests and limits, least-privilege service accounts and RBAC, non-root and no-privilege-escalation container security, dropped unnecessary Linux capabilities, and default-deny NetworkPolicies with explicit required traffic.

For an external dependency whose address can change, deployment configuration SHALL select an enforceable egress mechanism: stable CIDRs, an operator-provided egress gateway or proxy, or a qualified CNI FQDN policy extension. A broad Internet CIDR plus a destination port MUST NOT be presented as host-level least privilege. If no configured mechanism can prove the required destination boundary, the production security baseline SHALL fail qualification.

Writable runtime paths SHALL use explicitly declared writable volumes rather than making the container root filesystem broadly writable. Runtime Deployments SHALL stop routing to unready Pods, allow graceful termination, and preserve at least one ready replica during rolling replacement whenever the configured replica count is greater than one. Public production ingress SHALL use the configured TLS termination and explicit ingress or Gateway class.

#### Scenario: A configured probe path is absent

- **WHEN** a rendered readiness or liveness probe targets a path not implemented by its runtime
- **THEN** deployment validation or verification fails instead of declaring the workload healthy

#### Scenario: Inspect a workload security context

- **WHEN** the Kubernetes release is rendered
- **THEN** each workload has its declared least-privilege identity, resource bounds, capability restrictions, and only the writable paths it requires

#### Scenario: Inspect network isolation

- **WHEN** the release NetworkPolicies are evaluated
- **THEN** ingress and egress are denied by default and each allowed workload-to-workload or workload-to-dependency path is explicit

#### Scenario: Roll a replicated workload

- **WHEN** a Deployment with more than one desired replica advances to a new release
- **THEN** readiness and rollout settings preserve at least one ready replica while old and new compatible Pods transition

### Requirement: Support direct reconciliation and render-only GitOps handoff without competing writers

The Kubernetes target SHALL render self-contained declarative bundles for prerequisite policy and configuration, one-shot migration, private runtimes, public runtimes and ingress, and release observation. Each bundle SHALL carry the same release and canonical manifest digests plus explicit predecessor and completion evidence. Direct reconciliation is the first-release fully automated apply and rollback mode.

Deployment configuration SHALL identify one reconciliation owner for ShareSlices application resources. When direct ownership is selected, `apply` SHALL use the rendered release and enforce every phase gate. When GitOps ownership is selected, `apply` and `rollback` SHALL only render or select the immutable phase bundles, return `external_reconciler_required`, and MUST NOT write the cluster or an external Git repository. A generic GitOps controller is not assumed to enforce migration-before-runtime ordering; an external operator or controller-specific pipeline SHALL promote the next bundle only after the prior completion evidence is observed. Controller-specific repository mutation and automatic promotion are outside the first release.

`status` MUST distinguish rendered, handed-off, observed, phase-blocked, and converged releases. `verify` MUST NOT run or claim success until the requested runtime and all predecessor phase evidence are observed in the cluster.

#### Scenario: Apply with direct ownership

- **WHEN** the Kubernetes configuration selects direct reconciliation
- **THEN** `apply` advances the rendered migration and runtime phases and records their observed release digests

#### Scenario: Hand off to GitOps

- **WHEN** the Kubernetes configuration selects GitOps reconciliation
- **THEN** the Deployment Module produces the immutable phase bundles, returns `external_reconciler_required`, and does not act as a Kubernetes or Git repository writer

#### Scenario: GitOps has not reconciled the requested release

- **WHEN** the desired release was rendered but the cluster still exposes the prior release digest
- **THEN** `status` reports the desired and observed releases separately and does not claim convergence

#### Scenario: GitOps exposes runtime before migration evidence

- **WHEN** the cluster exposes a requested runtime digest without the required migration completion checksum and observed schema head
- **THEN** `status` reports a phase-order violation, verification does not run, and the Deployment Module does not claim convergence

#### Scenario: Request GitOps rollback

- **WHEN** a compatible prior release is selected while GitOps owns reconciliation
- **THEN** `rollback` emits current-schema compatibility evidence plus the prior runtime, configuration, ingress, and observation bundles and returns `external_reconciler_required` without emitting a prior migration Job, changing cluster resources, or claiming rollback completion
