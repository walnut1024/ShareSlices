# Kubernetes and Cloudflare Deployment Targets Design

<!-- cspell:words Hyperdrive secretless unkeyed -->

## Context

At proposal time, ShareSlices had one canonical local Compose stack whose
checked topology and controller policy were split across the repository. Tasks
13.1-13.3 have since moved the base, Gallery and test Compose inputs under
`deploy/compose/` and the policy-owning controllers under
`deploy/automation/local-compose/`; the supported `mise` commands now reach
that implementation through policy-free wrappers under `tools/`.

At proposal time, the Kubernetes manifests demonstrated several deployment
shapes but did not form a supported production deployment. They contained fixed
Service addresses, a deployable placeholder Secret, per-API-Pod migration init
containers, mutable image references, incomplete public routing, and
configuration validation that reasoned about a cross-workload variable union
instead of each runtime role. The implementing tasks have replaced those inputs;
the current implementation boundary is tracked in `docs/design/modules.md` and
the task/evidence records below rather than inferred from this historical gap.

The proposal also began with a content-only process that imported broader API
configuration than its manifest supplied, an API process that started
authentication-email and reconciliation loops, and independent long-running
Rust processing loops. Implementation has separated the API maintenance
composition and moved every currently enabled Rust lane—Artifact processing,
thumbnail, bundle-alias index rebuilding, Gallery safety, Gallery cover, and
Gallery copy—onto the shared `Runner`. The same core now provides a private
bounded-drain command with explicit lane selection, maximum claims, idle
observations, wall time, graceful cancellation, and machine-readable
remaining-work evidence. Kubernetes resident-workload rendering is now current,
while its live target qualification and the Cloudflare Jobs, Queue, and
Container Adapters remain target work; the shared Runner alone does not qualify
either production composition. Long-running resident
assumptions still do not map directly to event-driven Cloudflare Workers and
on-demand Containers.

The product decision is not to span one installation across Kubernetes and Cloudflare. A production installation selects exactly one **deployment target**:

```text
                           ShareSlices source
                                  │
                   ┌──────────────┴──────────────┐
                   │                             │
          local development/test       immutable production release
          deploy/compose + mise                    │
        not a DeploymentTarget          validated deployment configuration
                                                    │
                                       target = exactly one of:
                                         ┌──────────┴──────────┐
                                         │                     │
                                  Kubernetes target     Cloudflare target
                                         │                     │
                               optional external CDN    explicit Edge/CDN module
                               does not change target   inside this target
```

A deployment target identifies a production installation's application-compute and release composition. Docker Compose is a local execution topology and contract harness, not a deployment target, and is never accepted by the production configuration discriminator. Using Cloudflare or another provider only as a CDN in front of Kubernetes does not turn that installation into the Cloudflare target. Likewise, using a provider's S3-compatible object storage from Kubernetes does not change the target.

Both targets preserve one product implementation and one set of HTTP, PostgreSQL, object-layout, job, authorization, Gallery-isolation, email-delivery, and cache contracts. Platform differences belong in runtime entrypoints and infrastructure Adapters. Application and domain Modules do not branch on `kubernetes` or `cloudflare`.

`deploy/` becomes the product-owned Deployment Module rather than a collection of examples. It owns target selection, configuration validation, deterministic rendering, release planning, deployment, observation, verification, and compatible rollback. Workflow files remain thin callers of repository `mise` tasks and do not become a second implementation of deployment policy.

The design and delta specifications describe the intended post-change contract,
not the current release inventory. The Deployment Module is `Status: mixed` in
the durable module map while individual implemented parts coexist with
unfinished target work; neither production target is release-supported until
its implementation and verification are complete. A release advertises only a
target whose required provider-neutral and target-specific qualification
evidence passed; an unavailable Cloudflare capability does not turn Kubernetes
into a hybrid target or reduce Kubernetes eligibility.

### Verified provider-contract baseline

This design was checked against the official platform contracts available on
2026-07-19, reality-rechecked on 2026-07-21, and given a focused Runner,
Containers, Hyperdrive TLS, Static Assets, and Resend refresh on 2026-07-22.
These facts are compatibility inputs, not permanent assumptions. The
claim-level evidence, qualification gates, corrections, and complete
official-source index are in [the official platform audit](evidence/official-platform-audit.md)
and [the document reality audit](evidence/document-reality-audit.md).

The [current prototype execution baseline](evidence/current-prototype-execution-baseline.md) separately records mutable account observations and the work they permit. Account login, an enabled R2 subscription, a visible Supabase project, a `workers.dev` hostname, or a successful `resend.dev` request is prototype evidence only. None of those observations replaces Workers Paid Container entitlement, owned production zones, distinct registrable sites, a verified Resend sending domain, or target-specific release qualification.

### Current implementation checkpoint

This checkpoint prevents the intended target architecture from being mistaken
for the next executable deployment plan:

- Local development and automated integration use the canonical Compose
  topology only. Compose is regression evidence, not a production target or
  production-target qualification evidence.
- Kubernetes is the only production target with an implemented mutating
  lifecycle path. It still lacks complete deep verification, network probes,
  retirement, optional-CDN acceptance, GitOps external-owner validation,
  real-cluster acceptance, and release qualification. It therefore remains
  unavailable as a supported release target.
- The current Cloudflare account can exercise only bounded Workers
  Free-compatible prototypes plus separately enabled R2. This is not a third
  target and production `render`, `plan`, and `apply` must reject it. Trusted
  background processing still requires Containers and Workers Paid. Deferring
  thumbnail generation does not remove that independent processing gate.
- Supabase is only the currently observed prototype implementation of the
  operator-provided external PostgreSQL dependency, not a required ShareSlices
  vendor. A Free project may pause after low activity and is not production
  availability or recoverability evidence.
- `resend.dev` may exercise bounded API and idempotency behavior only. It cannot
  qualify arbitrary-recipient authentication mail, a verified sending domain,
  disabled tracking, same-domain key rotation, or inbox delivery.
- Live provider work is opt-in and disposable. After bounded verification,
  public routes and continuously invocable resources are removed or disabled,
  provider inventory is reread, and each deliberately retained private
  prerequisite receives an owner and expiry. Ordinary implementation and
  documentation checks do not start provider services.

Development proceeds from unchecked task acceptance criteria, not from the
presence of a renderer, prototype, authenticated CLI, stored credential, or
provider resource. Provider facts are refreshed immediately before a live
prototype and again before qualification.

- [Cloudflare Containers](https://developers.cloudflare.com/containers/) require Workers Paid. A Container is controlled through a Durable Object, runs a `linux/amd64` image, uses ephemeral disk, defaults to a ten-minute `sleepAfter`, and receives `SIGTERM` before a fifteen-minute forced shutdown. Queue and scheduled handlers must explicitly address or start that Container; a Queue is not itself a Container scheduler. [Container SSH](https://developers.cloudflare.com/containers/ssh/) is enabled by default, so production images explicitly disable it and provide no authorized keys.
- [Cloudflare Queue delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) is at least once, and a Queue-consumer invocation has a finite platform duration. The Queue handler therefore acknowledges only controller handoff; PostgreSQL, not the Queue acknowledgment, determines processing success and recovery.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) include a 128 MB isolate limit, Cloudflare-account-plan-dependent inbound request limits, bundle and Static Assets limits, and bounded Queue or scheduled invocations. The request-body tiers follow the Cloudflare account plan (for example Free or Pro), not the separate Workers Free/Paid entitlement. The current default 50 MiB ShareSlices Upload fits the documented 100 MB minimum request-body tier, but that value is release-static evidence rather than a live account measurement. Deployment validation must classify provider-observed, release-static, and operator-evidenced facts and compare the configured Upload policy and generated Web assets with the qualified applicable values.
- [Hyperdrive](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/) supports the repository's `pg` and Drizzle path when `nodejs_compat` and a supported compatibility date are used, but it does not support advisory locks, `LISTEN`/`NOTIFY`, SQL-level prepared-statement management, or arbitrary session state. Its cache is enabled by default and is not invalidated by writes, so this target explicitly provisions cache-disabled configurations. The current first-party TLS contract says PostgreSQL `require` validates the certificate chain against WebPKI but does not perform the hostname match added by `verify-full`. Production qualification therefore selects `verify-full` or a subsequently qualified equivalent, proves hostname and certificate validation including a negative case, and never treats `pg_stat_ssl` or encryption alone as authenticated origin identity.
- [R2's Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) provides streaming bodies, ranges, conditional operations, and multipart upload. Those interfaces require a dedicated Adapter and do not imply that the existing S3 client can run unchanged in a Worker.
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) are automatically cached across Cloudflare's network and, by default, are resolved before Worker code. Dynamic route families therefore require selective `run_worker_first` routing, while content-hashed build assets can use the platform's edge delivery. [Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/) default browser caching to `public, max-age=0, must-revalidate`; `_headers` can override asset responses but never Worker-generated responses.
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) respects `Cache-Control`, `Cache-Tag`, and validators, but its entries are local to the data center that writes them and `cache.put()` does not participate in tiered caching. `cache.put()` rejects `206 Partial Content` and responses whose cache policy forbids storage, so the optional byte cache needs a full-body internal representation separate from the outward `no-store` Viewer response.
- [Cloudflare cache status](https://developers.cloudflare.com/cache/concepts/cache-responses/) distinguishes cached, bypassed, and dynamic responses for the request path that emitted the header. A top-level Worker response does not by itself prove the result of an internal Cache API lookup or the number of R2 reads. `Set-Cookie`, authorization, and restrictive cache directives also affect eligibility, so ShareSlices verifies behavior with repeated requests, origin or R2 instrumentation, and authorization transitions instead of relying on that header alone.
- [R2 buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) are private by default; public custom domains and `r2.dev` are separate exposure settings. ShareSlices keeps both disabled and reaches R2 only through Worker bindings, including when optional edge acceleration is enabled.
- [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) version code, Static Assets, bindings, and compatibility settings, but do not version R2, Queue, Durable Object, or PostgreSQL state. The current [Durable Object migration constraints](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/#constraints-and-limitations) state that `wrangler versions upload` fails when Wrangler configuration contains `exports`. This design chooses `exports` for the Jobs Worker's Container classes, so its qualified default path is immediate deployment with Queue delivery paused and Cron detached. Because Wrangler behavior is evolving, the pinned disposable-account gate must reconfirm this constraint rather than treating it as permanent.
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) can accompany App and Content version upload through `--secrets-file`. A normal `wrangler deploy` preserves existing encrypted Secrets, and Jobs rotation can supply an ephemeral `--secrets-file` during its trigger-isolated immediate deployment. The official contract does not prove that versioned Secret commands preserve the Jobs Worker's chosen `exports`, so that path remains forbidden unless the pinned disposable-account gate proves it.
- [Container outbound policy](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/) denies Internet-disabled Container egress by default and permits only explicitly allowed or intercepted HTTP/HTTPS on ports 80/443 plus Cloudflare-provided DNS. Outbound interception requires `ContainerProxy`, and HTTPS interception requires the Container to trust the injected CA. Direct PostgreSQL therefore needs Internet enabled plus an exact host allowlist; that allowlist applies to the whole Container and is not documented as port-level or per-process enforcement. The secretless thumbnail broker can stay Internet-disabled over its internal virtual HTTP host.
- [Resend's send API](https://resend.com/docs/api-reference/emails/send-email) accepts an HTTPS send request and returns a provider message ID. Its idempotency key is retained for only 24 hours, while final delivery is a separate provider event. The first release intentionally implements SMTP-equivalent provider-acceptance semantics and does not claim inbox delivery or exactly-once delivery.
- [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/) distinguishes container start from readiness. Long-form `depends_on` can require `service_healthy` or a one-shot dependency's `service_completed_successfully`, but every critical dependency still needs a meaningful `healthcheck` and application-level retry behavior.
- [`docker compose up --wait`](https://docs.docker.com/reference/cli/docker/compose/up/) waits for services to be running or healthy and implies detached mode. A critical service without a health check is only proven running, so the local controller must keep explicit HTTP and SMTP host probes after Compose reports readiness.
- [Compose project names](https://docs.docker.com/compose/how-tos/project-name/) scope ordinary resources, but project-name precedence and ambient `COMPOSE_*` controls can silently change the target model. [`docker compose down`](https://docs.docker.com/reference/cli/docker/compose/down/) preserves named volumes unless `--volumes` is selected. The controller therefore passes the ordered files, repository project directory, and explicit `shareslices` or `shareslices-test` project name on every invocation. The fixed test project is protected by host-global endpoint/project and Engine-ID/project OS locks, each mutation is bracketed by identity checks, and cleanup is limited to its verified owner.

The release manifest pins the Wrangler version, Cloudflare Terraform provider version, Workers compatibility date and flags, Container package version, and generated configuration schema digest used for qualification. `doctor` compares provider-observable facts with that baseline and requires current operator or disposable-account evidence for limits the provider interfaces do not expose. A newer provider version or changed official contract is adopted only after the compatibility suite passes; unproven support is a release blocker, not an optimistic warning.

## Goals / Non-Goals

**Goals:**

- Support two explicit, mutually exclusive production targets: an existing conformant Kubernetes cluster and a Cloudflare edge/serverless composition.
- Keep one non-production Docker Compose topology for local development and automated integration tests, owned by `deploy/` and exposed through the existing canonical `mise` lifecycle rather than the production deployment CLI.
- Give both targets one non-interactive lifecycle: `doctor`, `render`, `plan`, `apply`, `status`, `verify`, and `rollback`.
- Build immutable application artifacts once per release and deploy only recorded digests or provider version identifiers.
- Preserve one business implementation while adding only the runtime, database, storage, email, request-metadata, and execution Adapters required by the second target.
- Make Kubernetes portable across managed cloud Kubernetes products without fixed cluster addresses or cloud-specific application manifests.
- Support Kubernetes through direct ingress or an optional external CDN while preserving routes, statuses, credentials, security headers, and caching behavior.
- Compose Cloudflare from Workers Static Assets, trusted and content-only Workers, private R2, external PostgreSQL, cache-disabled Hyperdrive, Queues, scheduled triggers, on-demand Containers, and Resend.
- Expose Cloudflare Edge/CDN as an explicit module with default Web-asset caching, optional authorization-first immutable Viewer byte caching, and mandatory bypass for every dynamic or credential-bearing route.
- Keep PostgreSQL job rows, leases, fences, attempts, outbox records, and idempotency keys authoritative; Cloudflare Queues only reduce wake-up latency.
- Use enterprise SMTP for Kubernetes and the Resend HTTPS API for Cloudflare without changing the durable authentication-email lifecycle.
- Make application release resumable, observable, redacted, safe to retry, and compatible with N/N-1 runtime overlap.
- Verify both targets through one machine-readable black-box deployment contract.
- Run the provider-neutral subset of that contract against Compose so runtime-role, routing, authorization, email-lifecycle, and cache-header regressions are detected locally without claiming provider qualification.
- Bound and report Cloudflare's cost-driving controls without presenting mutable provider pricing or free quota as a product guarantee.

**Non-Goals:**

- Running Kubernetes and Cloudflare application runtimes together for one installation.
- Adding a hybrid target, active-active multi-target failover, or automatic live migration between targets.
- Provisioning EKS, GKE, AKS, VPCs, Cloudflare accounts, domain registrations, external PostgreSQL, enterprise SMTP, Resend accounts or domains, or general-purpose Secret-management products.
- Replacing PostgreSQL with D1, replacing the durable job model with Queues, or publishing R2 buckets directly.
- Adding a third backend implementation or reproducing product policy in deployment code.
- Guaranteeing a specific provider price or free quota. Plans and limits are external prerequisites and can change independently of a ShareSlices release.
- Automatically applying down migrations, restoring databases, or treating application rollback as database disaster recovery.
- Provisioning backups or choosing operator RPO and RTO policy; the deployment contract still requires recoverability evidence and restore drills for its external prerequisites and control-plane state.
- Promoting Compose to a production deployment target, adding a second local runtime topology, changing the canonical local origins or lifecycle commands, or using local fixtures as evidence that enterprise SMTP, Resend, Kubernetes, CDN, or Cloudflare provider contracts passed.
- Providing first-party provisioning for every external CDN or GitOps controller in the first release.

## Decisions

### 1. Model deployment configuration as a discriminated target union

The Deployment Module accepts one versioned configuration document whose `target` is either `kubernetes` or `cloudflare`. Common inputs include installation identity, public addresses, release reference, enabled product capabilities, external PostgreSQL, email sender identity, logical Secret references and their non-secret revisions, reconciliation ownership, recovery-policy evidence, and verification policy. Target-specific inputs live only under the selected target block; Cloudflare also requires explicit cost-driving resource bounds.

Validation rejects all of the following before rendering or remote mutation:

- no selected target, an unknown target, or both target blocks;
- a field belonging to the unselected target;
- a Kubernetes CDN without its required edge, origin, and trusted-proxy configuration;
- Gallery enabled without a separately verifiable Untrusted-content site;
- a Secret value embedded where only a reference is allowed;
- an SMTP configuration under Cloudflare or a Resend configuration under Kubernetes.

This makes mutual exclusion structural rather than conventional. A published ShareSlices release can contain artifacts for both targets, but one installation's materialized bundle and observed record contain only its selected target.

Runtime configuration is generated per role rather than copied as one environment-variable union. API HTTP, maintenance, content-only, Rust processing, migration, and Web bootstrap each receive only the values and Secret references they consume. Per-role contract checks replace the current union check that can allow one workload to omit a required value because another workload contains it.

Alternative: maintain unrelated Kubernetes and Cloudflare configuration formats. Rejected because origins, feature policy, release identity, verification, compatibility, and Secret rules would drift.

Alternative: accept both target blocks and ignore one. Rejected because stale credentials and accidental cross-target dependencies would be difficult to detect.

### 2. Make `deploy/` a deep Deployment Module

The target repository shape is:

```text
deploy/
├── README.md
├── compose/                         canonical non-production composition
│   ├── compose.yaml                 base services and role graph
│   ├── compose.gallery-local.yaml   canonical isolated-content overlay
│   ├── compose.test.yaml            test-only composition extension
│   ├── test.env                     checked non-sensitive test inputs
│   ├── Caddyfile                    trusted local Web/API routing
├── contract/
│   ├── deployment.schema.json       discriminated deployment input
│   ├── release.schema.json          immutable build/release identity
│   ├── route-matrix.yaml            generated projection of OpenAPI route owners
│   ├── cache-policy.yaml            generated projection of implemented cache requirements
│   └── verification-scenarios.yaml  source-linked black-box checks
├── automation/
│   ├── cli/                         command parsing and JSON results
│   ├── core/                        lifecycle, plans, redaction, phase journal
│   ├── local-compose/               canonical mise lifecycle implementation
│   └── adapters/
│       ├── kubernetes/
│       └── cloudflare/
├── kubernetes/                      Kustomize sources and target fixtures
├── cloudflare/                      IaC, Wrangler inputs, and target fixtures
└── tests/                           render, drift, safety, and parity fixtures
```

Cloudflare application entrypoints remain with the API runtime and Rust processing remains in `worker/`. `deploy/` packages and composes those runtimes; it does not become another business-runtime source tree.

A repository CLI, invoked through `mise run deploy -- <command>`, owns the lifecycle and returns stable JSON plus concise human output:

- `doctor` validates configuration, pinned tools, credentials, target capabilities, externally visible dependency facts, DNS/TLS expectations, and Secret references without mutation. It reports when runtime-path proof still requires an explicitly authorized pre-traffic qualification probe.
- `render` materializes a deterministic, Secret-free target bundle from one release and deployment configuration.
- `plan` compares the bundle with observed target state and reports ordered changes, compatibility blockers, drift, and any destructive action.
- `apply` executes the exact reviewed plan, resumes from observed state after interruption, and records each confirmed outcome. Ordinary apply may retire only positively owned superseded resources under the declared retention rules; every other destructive or security-sensitive change is refused or requires a separately authorized maintenance procedure.
- `status` reports desired and active releases, component versions, health, drift, and optional-capability readiness.
- `verify` executes the common deployment contract. Default verification is read-only; explicitly authorized deep verification may create and remove only its isolated test data.
- `rollback` reactivates a recorded compatible application release without reversing migrations or deleting durable resources; an external GitOps owner receives a handoff result rather than an unearned convergence claim.

`doctor`, `render`, `plan`, and `status` never mutate target or application state. Reapplying an already converged release is an idempotent observation and verification pass. CI entrypoints call this interface and contain no provider decision logic.

Alternative: encode deployment behavior in GitHub Actions. Rejected because local operation, another CI system, testing, redaction, and rollback would acquire separate implementations.

Alternative: use shell scripts as the policy owner. Rejected because typed configuration, ordered plans, redaction, observed-state comparison, and resumable multi-component releases need a testable implementation.

### 3. Treat Compose as a local execution topology, not a production target

The active `consolidate-local-development-stack` change defines the future `local-development-stack` capability. Complete and archive that change before this change moves Compose files or ownership. Once archived, that capability owns the canonical commands, origins, readiness, loopback publication, data retention, and developer/test isolation contract.

This change defines only the boundary between that local capability and production deployment orchestration; it does not introduce a second local capability. If implementation needs to alter an observable local-stack guarantee beyond the archived specification, it must add a `MODIFIED` delta before changing the behavior.

`deploy/compose/` owns the complete checked non-production composition: the base Compose model, the canonical Gallery-isolation overlay, Caddy routing, local-only defaults, and test-specific inputs. `deploy/automation/local-compose/` owns command construction, readiness and host probes, endpoint reporting, exact-project cleanup, and failure diagnostics. If compatibility wrappers remain under `tools/`, they contain no composition policy.

Moving the YAML files must preserve the repository root as the Compose project directory and the current `shareslices` developer project and named-volume identities, or deliberately migrate every relative build context, bind mount, environment-file reference, network, and volume. A path-only move is invalid. The controller owns one fixed ordered file list for the developer topology and one fixed ordered file list for the test topology. Every call supplies its topology's list, explicit repository-root `--project-directory`, and `-p shareslices` or `-p shareslices-test`; it clears or rejects ambient `COMPOSE_FILE`, `COMPOSE_PROJECT_NAME`, `COMPOSE_PROFILES`, `COMPOSE_ENV_FILES`, `COMPOSE_DISABLE_ENV_FILE`, progress/menu/experimental, and orphan-policy overrides that could select another model, output mode, or cleanup target. The repository-root `.env` remains an intentional interpolation input only for the developer topology.

The test controller supplies one checked non-sensitive fixture through `--env-file` and starts every Docker or Compose child process from a newly constructed hermetic allowlist rather than the caller's inherited environment. It injects only the minimal process values needed to execute the pinned tools, an isolated temporary and Docker client configuration, the frozen endpoint/TLS connection inputs, and the declared fixture variables. It does not inherit `HOME`, registry credentials, Docker/Compose controls, application variables, CI metadata, agent variables, or unrelated shell values. This is required even for variables declared in the fixture because Compose gives the shell environment precedence over `--env-file`. Command arguments, not ambient variables, select the files, project, profiles, endpoint, progress mode, and orphan behavior.

The supported interactive interface remains exactly:

```text
mise run dev         build, recreate, migrate, wait, and host-probe
mise run dev-status  report Compose state and host-observable readiness
mise run dev-logs    follow the canonical project logs
mise run dev-down    stop the canonical project and preserve named data volumes
```

There is no `target: compose`, no `mise run deploy -- ... compose`, and no second `dev-compose` entrypoint. The production deployment schema and release journal never ingest local Compose configuration or local credentials.

The Compose service graph evolves with the runtime seams introduced by this change. It retains PostgreSQL, private MinIO, Mailpit, object-store initialization, and one-shot migration, and it separately composes trusted HTTP, maintenance/authentication-email dispatch, content-only HTTP, resident processing, and Web/Caddy roles as those entrypoints become available. A production role MUST NOT be folded back into the API process only for local convenience. Core services are always part of the canonical topology. Diagnostics and test tools use the isolated test project or one-shot `run --rm` execution. If any long-lived service uses a Compose profile, the controller records and supplies the same profile set to `up`, `ps`, `logs`, and `down` so it cannot become an orphan. If the `local-development-stack` capability later implements its permitted explicit non-production remote-access exception, the controller treats that selection as a controlled override that is never available to automated tests or production qualification; this change does not create that profile.

Critical long-running services have capability-based health checks. One-shot initialization and migration use successful completion dependencies, and `up --wait` is followed by host HTTP and SMTP probes because Compose readiness alone does not prove published-port reachability. Application retry behavior remains necessary after startup; dependency ordering is not treated as a runtime availability guarantee. The repository records a tested Docker Compose feature baseline for `--wait-timeout`, long-form dependency conditions, and machine-readable `ps`; the controller fails before mutation when the installed plugin lacks a required feature instead of guessing from a version string alone.

Local authentication email uses the common durable delivery workflow through the SMTP Adapter and Mailpit. It proves local enqueue, lease, retry, provider-acceptance, and rendered-message behavior, but it cannot qualify enterprise SMTP TLS/authentication or any Resend domain, tracking, quota, retention, HTTP, or idempotency contract.

Automated API and Web integration tests use the fixed `shareslices-test` project, test-only loopback endpoints, database, object data, and volumes. Read-only context discovery may inspect Docker CLI configuration only long enough to resolve the selected context into a frozen connection snapshot: normalized endpoint, TLS-verification mode, TLS-material identity, and an isolated client-configuration input. Every later Docker and Compose command uses that explicit snapshot and never reuses the mutable context alias. Unix sockets and Windows named pipes are local; TCP and SSH endpoints are remote by default even when their hostname appears loopback. Automated tests always reject a remote daemon. The developer lifecycle rejects it by default and may allow it only if the separately owned `local-development-stack` capability has formally implemented and the operator has selected its explicit non-production remote-access profile; that profile remains ineligible for tests or production qualification. Because a host-local OS lock cannot coordinate multiple clients of one remote Engine, such a future profile must constrain mutation to one controller host or provide a daemon-side or distributed lease and ownership protocol; otherwise it fails closed.

Before either developer or test lifecycle mutates Docker state, the controller acquires an OS-managed exclusive lock in a host-global runtime namespace outside every checkout, first by the frozen endpoint fingerprint plus project name and then by the observed Docker Engine server ID plus project name. The endpoint lock remains stable if the Engine restarts with a new ID; the Engine lock coalesces multiple local endpoint aliases that reach the same daemon. After both locks are held, the controller brackets every mutation or cleanup command with Engine-ID reads through the frozen connection snapshot and accepts the result only when the before and after values both equal the locked identity. Both locks are held continuously from the controller's first mutation through its `finally` path and cover build, create, start, `up`, one-shot `run`, `exec`, recreation, `down`, orphan removal, and volume cleanup. If the identity changes, the controller performs no further mutation or cleanup under the stale Engine lock; while retaining the endpoint lock it must acquire the replacement Engine/project lock and reconcile only positively owned resources, or fail closed with exact recovery instructions. No direct mutating Docker or Compose path may bypass the controller. Lock ownership, rather than a PID or timestamp guess, proves that no local controller process is live; another run waits or fails closed and MUST NOT issue a pre-emptive `down --volumes`. Read-only status and log operations need not take the exclusive lifecycle locks, but they still use the frozen endpoint, exact project, and fixed topology and return indeterminate if their before/after Engine IDs differ.

The test ownership marker records the repository identity, fixed topology digest, frozen endpoint fingerprint, Docker Engine server ID, project name, and run nonce; the nonce proves resource attribution but not process liveness. After acquiring both host-global OS locks, a new controller may adopt and clean a crashed run only when the marker's repository identity and topology digest match and every discovered resource is positively owned by that exact project. An unknown marker, changed topology, endpoint or Engine mismatch, external resource, or ambiguous owner fails closed with exact recovery diagnostics. Teardown runs in the same locked `finally` path, matches the marker, brackets each removal with Engine-ID checks, removes only the test project's orphans and volumes, and reports cleanup failure without replacing the original test failure.

The developer topology retains its canonical loopback ports. The test topology omits every fixed host port and requests loopback-only dynamic publication. Under the same lifecycle locks, the controller first creates only the test ingress/proxy and dependency endpoints whose checked configuration does not depend on their own public URL and cannot execute application business work. It discovers and cross-checks their assigned bindings from machine-readable Compose state, freezes the Web, API, content, Mailpit, SMTP, database, and object-store endpoints, injects those values into the remaining test-role configuration, and only then creates and starts application roles. The controller fails if the second phase would recreate or renumber an already frozen publication. Every observed binding must remain on the caller's loopback interface. The configured trusted and Untrusted-content host names must still satisfy the product's distinct-browser-site validator; changing only the port is insufficient. Test-model validation rejects external networks, volumes, configs, or Secrets, explicit resource names that escape project scoping, `container_name`, and any other shared-resource escape before the first mutation. The test harness never stops, recreates, shares durable state or browser credentials with, or deletes volumes from the stable developer project. Human users do not gain another test-stack lifecycle to manage.

Against the real developer `.env`, model validation uses `docker compose config --quiet` so expanded Secret-bearing configuration is never returned to the controller, test framework, logs, or persistent output. A full resolved-model assertion or `config --environment` invocation is permitted only inside the hermetic non-sensitive test environment and is not persisted by default; a required model hash or snapshot must prove that its input contains only the declared fixture allowlist. Post-output redaction is not an acceptable control for real developer inputs. Canary tests inject a declared shell override, an unrelated Secret-like shell value, Docker/Compose control values, and fixture values, then prove the fixture remains authoritative and no ambient value reaches test interpolation, container configuration, diagnostics, snapshots, or logs.

The shared deployment verifier may run only read-only readiness, route, and response-header probes against the canonical developer topology. Authentication, authorization, Viewer-isolation, authentication-email lifecycle, or any other probe that creates state, changes credentials, starts work, or sends mail MUST use the locked `shareslices-test` topology and its test-only endpoints. Provider-only rows such as Kubernetes CNI enforcement, external-CDN caching, Workers Static Assets, Cache API, R2, Containers, Hyperdrive, Queues, and Resend return an explicit `not_applicable` reason. A passing local run is regression evidence, never production-target qualification or release activation evidence.

Alternative: make Compose the third target of the production deployment CLI. Rejected because local fixtures, source builds, mutable development data, and destructive test cleanup do not satisfy the immutable release, external-prerequisite, Secret, recovery, and provider-observation contract.

Alternative: leave Compose files at the repository root and only mention them from `deploy/README.md`. Rejected because runtime-role composition and deployment verification would continue to have split ownership.

### 4. Separate release construction, target application, and observed state

A release workflow produces one immutable manifest and target artifacts from the same source revision. `apply` never compiles source or silently resolves a mutable tag. Artifact content identity and provider deployment identity are separate: every artifact has a content digest, while a provider reference is either that digest or a qualified never-reused release tag mapped back to it when the pinned provider exposes only tags. The manifest records at least:

- release ID and source revision;
- Kubernetes API/Web/content/maintenance/Rust image digests;
- Cloudflare App, content, and jobs Worker bundle digests;
- Cloudflare Container image content digests, provider-verified digests when supported or never-reused release tags otherwise, observed provider image identity, and Web Static Assets manifest digest;
- migration head and every migration checksum;
- HTTP, job, object-layout, route/cache, and verification-contract revisions;
- database-schema range and N/N-1 component compatibility;
- minimum deployment-configuration schema and build provenance.

Rendering combines this manifest with one target configuration and produces a target-bundle digest. Secret values are excluded; stable reference names, operator-controlled non-secret revisions, and a canonical redacted-configuration digest are recorded. Provider-generated version IDs are observed after upload and stored in the deployment record without changing artifact identity.

The record is control-plane state rather than product business state:

- Kubernetes stores the active and previous release marker in a Secret-free ConfigMap and resource labels/annotations.
- Cloudflare mirrors the Secret-free release record into a dedicated private deployment-state object and tags each Worker version with the release ID; that object is target evidence, not the operation-lock source of truth.
- The immutable bundle is retained in an operator-supplied release store. OCI images use an operator-supplied OCI registry; non-image bundles use a versioned immutable object or artifact store. Build-push and deploy-pull credentials are separate, Kubernetes receives only its required image-pull reference, and retention or garbage collection MUST preserve every recorded rollback candidate.

`status` reconstructs observed state from actual workloads, Worker deployments, bindings, routes, and provider-verifiable image identities and compares it with the record. It reports drift rather than trusting either source alone.

Mutating operations use an authoritative PostgreSQL-backed deployment-operation lease, phase journal, monotonically increasing fencing token, and heartbeat shared by both targets. A short direct PostgreSQL advisory lock serializes only coordination-schema bootstrap, lease acquisition, and lease update; it is never held as the sole guarantee across Terraform, Wrangler, or Kubernetes rollout time. On first installation, one direct transaction under a deterministic advisory lock installs the fixed checksum-verified deployment-control schema and initial fence before any provider mutation. Every later mutating phase rechecks the durable lease and stamps the fencing token into the Kubernetes release marker, Cloudflare conditional release-record mirror, and release-owned resource metadata. A process that loses ownership stops before its next mutation, and a stale token cannot overwrite a newer release record. Creating or losing the Cloudflare R2 deployment-state object therefore cannot create or erase the authoritative lock.

The R2 mirror encodes the release and numeric fence, but R2 conditional operations compare object state rather than interpret that fence. A mirror writer therefore validates the current PostgreSQL lease and fence and reads and rejects a newer encoded mirror fence in application logic. If the object exists, it updates with `If-Match: <etag>` or the qualified binding equivalent; if it is absent, it creates with `If-None-Match: *` or the qualified wildcard equivalent. An absent read, precondition failure, lost lease between read and write, network-indeterminate result, or ambiguous conditional write becomes `stale` or `indeterminate`, stops any phase that depends on that evidence, and is reconciled from the PostgreSQL journal plus the current R2 object without direct retry by the old fence. It never grants, renews, or extends an operation lease.

Every bundle also contains a release inventory. After a replacement passes verification, the Deployment Module first removes traffic and schedules from superseded release-owned resources, verifies that the route cannot be reached or that the provider control plane is detached and its required safety window has elapsed, and then scales down or deletes only resources whose ownership and rollback retention are proven. Unknown resources and durable prerequisites are reported, never guessed or garbage-collected.

Alternative: derive a release from the current checkout during every deployment. Rejected because environments could receive different bytes under one apparent version.

Alternative: rely only on Kubernetes Deployment history or independent Cloudflare Worker histories. Rejected because neither describes a multi-component target release or its compatibility evidence.

### 5. Add composition seams without forking business behavior

The API exposes builders for trusted HTTP, content-only HTTP, and bounded maintenance behavior. Node and Cloudflare entrypoints compose those builders with platform Adapters. HTTP serving, email dispatch, migration, and reconciliation are no longer inseparably started by one process.

Second Adapters are added only at real runtime boundaries:

- **Configuration:** role-specific validated Node environment values or Cloudflare bindings.
- **HTTP entry:** Node listener or Cloudflare `fetch` handler over the same Hono application.
- **Database:** direct Node PostgreSQL, cache-disabled Hyperdrive for compatible Worker queries, and a direct path for unsupported operations.
- **Object storage:** private S3-compatible storage or private R2 behind the same responsibility.
- **Email:** enterprise SMTP for Kubernetes and a Resend HTTPS Adapter for Cloudflare.
- **Request metadata:** canonical client and scheme data derived only from the configured trusted ingress or Cloudflare execution boundary.
- **Maintenance:** resident bounded loops on Kubernetes or Queue/scheduled drains on Cloudflare.
- **Web public configuration:** deployment-provided runtime bootstrap data instead of a target-specific rebuild or baked Turnstile site key.

Application Modules continue to own transactions, authorization, Artifact and Publication behavior, Gallery eligibility, message rendering, retry classification, circuit breaking, and stable result mapping. They receive capabilities, not a deployment-target enum.

Hyperdrive query caching is disabled for the initial Cloudflare target because authentication, authorization, Publication, Gallery eligibility, job claims, and read-after-write behavior require fresh state. Operations requiring advisory locks or unsupported session semantics run as a whole through a verified direct PostgreSQL path, normally the deployment control plane or a trusted non-browser processing Container. The secretless thumbnail Container is excluded from every direct path. Migrations always use one checked-out direct client for the advisory lock and every per-file transaction; every committed migration prefix remains compatible with the still-serving N-1 runtime. A later change can enable caching only for an explicitly stale-safe read model.

Alternative: fork the API for Cloudflare. Rejected because authorization, lifecycle precedence, and Gallery policy would have two sources of truth.

Alternative: pass `target` through application code and branch at call sites. Rejected because platform policy would spread through business Modules and make parity untestable.

### 6. Fix the email provider per deployment target

The email surface remains the existing `AuthenticationEmailDelivery` responsibility: the request transaction persists an encrypted delivery record, returns without contacting a provider, and a separate executor leases and attempts delivery. Only the transport Adapter changes.

An unattempted pending delivery has no frozen transport identity. Its first claim atomically freezes the then-current validated Adapter kind, declared Resend team/account or SMTP-relay namespace, sender/domain and endpoint identity, transport-configuration revision, serializer and payload digest, logical idempotency key when supported, and stable local message identifier. Secret values remain outside the record; only their reference and non-secret revision are retained. Retries reproduce the same provider bytes inside that namespace. A credential may rotate in place only when the operator contract proves the new credential belongs to the same namespace and keeps the required sender/domain scope. An attempted pending or indeterminate delivery never migrates automatically to another Resend team, SMTP relay authority, sender, or Adapter; deployment must retain the old transport until drain or route that record to manual reconciliation.

Every provider call durably records an attempt ID, fence, phase, and maximum deadline. The executor persists a submitting phase before crossing any external side-effect boundary and records complete-submission/awaiting-final-acceptance evidence when known. For finite provider deduplication, the first submitting transition also atomically freezes one conservative safe-replay cutoff from the local pre-send time, pinned retention contract, and clock/transport safety margin; no retry or restart extends it. A live fenced attempt whose durable evidence proves complete submission did not occur can return to bounded retry. After the previous call's maximum deadline and safety margin with observed quiescence, a successor fenced attempt may also replay an acceptance-indeterminate request only before that cutoff and while a qualified provider deduplication contract still covers the frozen namespace, key, and byte-equivalent payload. A crash, lease loss, expired attempt, or elapsed cutoff after submission may have begun otherwise goes to manual reconciliation. Lease expiry alone is neither quiescence, proof of failure, nor replay authority.

For Kubernetes:

- the operator supplies an enterprise SMTP endpoint, TLS policy, sender identity, and role-scoped Secret reference;
- the maintenance workload owns the SMTP Adapter and resident bounded dispatcher;
- each logical delivery keeps one stable local RFC Message-ID, but that identifier is reconciliation evidence rather than a provider identifier or deduplication guarantee. Final SMTP success records `sent` and `provider_accepted` even when the server returns no provider queue ID. Failures durably proven to occur before complete message submission may retry within the bounded policy; a crash or lease loss during `DATA`, loss of the final server response after complete submission, or another unknown side-effect phase becomes acceptance-indeterminate and goes to manual reconciliation without automatic resend;
- SMTP failure changes email capability health, not API request readiness;
- ShareSlices never creates or administers the enterprise mail service.

For Cloudflare:

- the operator supplies a Resend account, verified sending domain, sender identity, and domain-scoped sending-access API key as a Cloudflare Secret;
- a bounded jobs Worker execution calls the Resend HTTPS API directly;
- the Adapter sends `Authorization`, JSON `Content-Type`, a stable `User-Agent`, and `Idempotency-Key` headers; the body contains required `from`, one-element `to`, and `subject` fields plus HTML and text but no attachment;
- one immutable logical delivery ID and payload digest determine the provider idempotency key; the first possible send atomically freezes a conservative safe-replay cutoff from Resend's pinned retention and a safety margin. Every retry before that cutoff reuses the same key and byte-equivalent provider payload, and the returned provider message ID is recorded. After the prior call deadline and quiescence, an indeterminate network or server outcome may use this exact deduplicated replay, but no retry restarts or extends the cutoff;
- the provider idempotency window is only an additional retry guard. If an indeterminate attempt remains unresolved at the conservatively frozen safe-replay cutoff, the Adapter does not blindly create another send and instead records the shared indeterminate/manual-reconciliation outcome;
- Resend error `type`, `retry-after`, and rate-limit or quota headers map into the existing bounded retry and circuit-breaker policy. The minimum mapping covers `invalid_idempotency_key`, `invalid_idempotent_request`, `concurrent_idempotent_requests`, `rate_limit_exceeded`, `daily_quota_exceeded`, and `monthly_quota_exceeded`; unknown types, non-JSON responses, network failures, and server failures remain conservative and bounded;
- Queue messages contain only a wake identifier, never the decrypted email body or API key;
- the sending domain keeps click and open tracking disabled for authentication mail so Resend does not rewrite verification or recovery links;
- `doctor` verifies references and non-secret configuration without demanding a broader Resend key. A sending-only runtime key cannot query remote domain, tracking, full quota headroom, bounce/spam health, or suspension state, so those facts use current operator/dashboard evidence and actual provider acceptance is proven only by explicitly authorized deep verification or normal delivery.

The selected Resend plan and quota are deployment prerequisites, not product constants. Quota exhaustion is reported as email-delivery degradation and never silently converted into a successful send. A successful `POST /emails` preserves the existing cross-provider durable `sent` meaning of transport or provider acceptance, stores the provider message ID, and records `provider_accepted` as a result classification; it does not claim inbox delivery or add a new delivery state. The first release does not ingest Resend webhooks; if delivered, bounced, or complaint state later becomes product behavior, a separate change must add raw-body signature verification, event idempotency, and out-of-order handling.

An indeterminate result is resolved only through a non-public one-shot operator maintenance entrypoint when either a finite provider deduplication window expires without resolution or a non-idempotent transport loses its final response after complete submission. It is not an HTTP route or end-user CLI operation. `deploy/automation/` may provide only a thin launcher; the operation belongs to the shared account application responsibility rather than the seven target lifecycle operations, consumes no deployment plan or operation lease, and mutates no release or target state.

The launcher passes a versioned canonical, short-lived, single-use signed authorization envelope issued by an operator-controlled account-maintenance key. Deployment configuration carries only public verification material and the accepted issuer plus installation-specific audience. The envelope binds operator subject, installation, action, delivery ID and revision, frozen transport-snapshot revision, attempt ID and fence, provider/relay namespace, sender, local Message-ID, optional provider ID, payload digest, finite-provider safe-replay cutoff when present, decision-and-evidence digest, nonce, issue time, and expiry. The application derives the audit actor from that verified subject and rejects invalid scope, identity, correlation, expiry, signature, digest, or replay instead of accepting free-form identity or evidence from another provider attempt.

The direct PostgreSQL operation accepts an initial resolution only for a delivery already fenced in manual reconciliation with no active dispatcher lease after the maximum provider-call deadline, safety margin, and observed attempt quiescence and, for finite provider deduplication, at or after the frozen safe-replay cutoff. One transaction uniquely claims the authorization nonce, locks the delivery and its verification or recovery material, checks the revision, attempt fence, frozen transport identity and cutoff, and evidence correlation, and serializes the resolution and audit against dispatcher claims, code verification, and reset-grant issuance. Correlated acceptance becomes existing `sent` plus `provider_accepted` and an optional provider ID. Correlated rejection becomes terminal `failed` plus `provider_rejected`; unresolved closure becomes terminal `failed` plus `acceptance_unresolved`. The operation never sends or enqueues the old payload and never expires, extends, invalidates, or recreates an authentication code or reset grant; existing reuse, expiry, consumption, and circuit-breaker rules remain authoritative. A later permitted user request receives a new logical delivery identity and reuses the active code when the implemented account contract requires it. A fresh-authorized idempotent repeat may inspect an already resolved delivery only when its expected current revision, signed decision, evidence digest, frozen identities, and attempt fence exactly match the recorded resolution. It still consumes its fresh nonce and may record a separate invocation audit, but never mutates delivery or authentication material or duplicates the resolution audit. Every decision is nonce-protected, actor-attributed, revision-guarded, redacted, and auditable.

ShareSlices deletes or retains its encrypted local payload according to the existing product policy, but that policy does not claim deletion from Resend. The operator runbook discloses the provider's current data-retention behavior, selected quota, and whether the account plan supports disabling message-content storage. Free-tier availability remains a mutable provider fact, not a deployment guarantee.

Alternative: use SMTP from Cloudflare Workers. Rejected because the Resend HTTPS API fits the event-driven Worker runtime and is the selected Cloudflare target contract.

Alternative: place the full email payload in Cloudflare Queue. Rejected because PostgreSQL already owns encrypted durable delivery and Queue retention would create another sensitive source of truth.

### 7. Give background processing resident and bounded Runner modes

The existing processing Modules remain the sole implementation of Upload processing, thumbnails, bundle-alias work, Gallery safety, covers, copies, reconciliation, and cleanup. A Runner layer composes them in two modes:

- `resident`: repeatedly claims work and waits for shutdown, used by Kubernetes;
- `drain`: claims enabled lanes until a maximum count, idle bound, or wall-clock deadline, used by Cloudflare Containers and triggered maintenance.

Both modes use the same PostgreSQL claims, leases, heartbeats, fences, attempts, retry rules, idempotency behavior, storage Adapter, and structured outcomes. The bounded Runner stops new claims before termination, completes or safely relinquishes in-flight work within the platform grace period, and reports whether claimable work remains.

On Cloudflare, Queue messages are at-least-once wake signals. A message can name a lane or durable job ID for efficiency, but the consumer rereads PostgreSQL and claims through the fenced contract. A transactional dispatch record bridges database commit and Queue publication. Scheduled triggers recover pending dispatches, exhausted signals, or otherwise stranded wake-ups. Duplicate messages and concurrent Containers cannot create a second terminal result.

The Queue consumer does not execute the Rust drain inside its finite Worker invocation. It selects one bounded runner-slot ID, obtains that Container's Durable Object stub, starts or nudges the Container, persists the controller handoff result, and returns. A trusted processing Container then claims PostgreSQL work independently; for thumbnails, the jobs Worker establishes the claim and starts only the grant-bound secretless Container. Stable slot IDs plus `max_instances` and database fences bound concurrency; using one unbounded Container ID per job is forbidden because it can exceed the account limit before claims serialize.

The Container class sets an explicit `sleepAfter` rather than relying on the platform default, and its idle hook calls `stop()` after the drain reports no remaining claimable work. It handles the platform `SIGTERM`, stops new claims, and finishes or relinquishes work before the documented force-stop deadline. Temporary memory and ephemeral disk never hold the only copy of input, output, attempt, or completion state.

Alternative: make Queue messages the durable job source. Rejected because it would create target-specific job semantics and weaken existing recovery guarantees.

Alternative: keep a Cloudflare Container permanently polling. Rejected because it defeats the low-idle-cost objective and the platform's on-demand composition.

### 8. Rebuild Kubernetes around one deterministic Kustomize implementation

The Kubernetes target assumes an existing conformant cluster, configured ingress implementation, external PostgreSQL, private S3-compatible storage, and enterprise SMTP. Kustomize remains the one manifest implementation; Helm is not added in parallel.

```text
public ingress
├── Web/static runtime
├── trusted API HTTP runtime
└── Viewer route group

isolated content ingress on a separate registrable site
└── content-only runtime

private workloads
├── Node maintenance + enterprise SMTP Adapter
├── resident Rust Runner
└── one-shot migration Job
```

The rendered bundle:

- uses Services and cluster DNS instead of fixed ClusterIPs;
- references immutable images by digest;
- runs migration once as a release phase rather than per API Pod;
- separates trusted HTTP and maintenance execution;
- routes every checked public family, including `/api`, `/a`, Gallery trusted routes, health, Preview, and content-only paths;
- keeps internal routes unavailable from public ingress;
- references pre-created or externally managed Secrets instead of applying placeholder values;
- scopes configuration, Secret keys, ServiceAccounts, and network access per workload;
- sets non-root, read-only filesystem, capability-drop, seccomp, resources, probes, shutdown, disruption, and scheduling baselines;
- configures ingress class, TLS, replicas, resources, and topology from deployment input rather than source edits;
- applies default-deny NetworkPolicies and declares an enforceable external-egress mechanism: stable CIDRs, an operator-provided egress gateway or proxy, or a qualified CNI FQDN extension.

Gallery remains fail-closed when live DNS, cookie, registrable-site, content-route, browser-policy, or network evidence is absent. Rendering a NetworkPolicy object or reading a CNI name is not proof of enforcement, particularly when provider-managed dependencies require dynamic FQDN egress that standard NetworkPolicy cannot express safely. Read-only `doctor` checks the declared mechanism and existing evidence. An explicitly authorized pre-traffic qualification phase creates isolated probe resources, proves allowed and denied flows from the workload network, records expiring cluster-specific evidence, and removes those resources before activation.

`render` produces separate immutable prerequisite, migration, private-runtime, public-runtime/ingress, and observation bundles. First-party direct `apply` promotes them only after each observed gate succeeds. Under GitOps ownership, `apply` and `rollback` return `external_reconciler_required`; they neither write the cluster nor push a Git repository. An external operator or controller-specific pipeline promotes the next bundle only after the prior completion evidence is observed. The Deployment Module never assumes that an arbitrary GitOps reconciler enforces Job-before-Deployment ordering, and one installation still declares only one manifest writer.

Alternative: retain copied environment overlays with embedded addresses and Secret placeholders. Rejected because they already drift and cannot provide deterministic release identity.

Alternative: add Helm beside Kustomize. Rejected because it duplicates topology before a second packaging contract exists.

### 9. Treat a Kubernetes CDN as an optional delivery Adapter

The Kubernetes target supports `delivery.mode = direct` or `delivery.mode = external-cdn`. This setting changes public delivery and trusted-proxy configuration, not compute, database, processing, or target identity.

The first release defines a provider-neutral external-CDN contract rather than provisioning provider accounts. Configuration supplies edge addresses, origin addresses, TLS expectations, trusted metadata, and any origin-access requirement. The Deployment Module verifies the observed edge and origin instead of assuming the provider preserves configuration.

The shared cache-policy projection references the implemented requirements that permit immutable content-hashed Web assets at the edge. API, authentication, Preview, Viewer, known-link state, Gallery authorization, Gallery entry and asset, and every other current dynamic `no-store` response remain non-cacheable. Credentials, `Set-Cookie`, status precedence, redirects, CORS, and security headers remain equivalent at origin and edge.

Ingress strips forged forwarding headers and constructs canonical client metadata only from a configured trusted hop. An external CDN that overrides `no-store`, caches credential-bound content, changes status behavior, or exposes a forbidden origin route fails verification.

Alternative: call Kubernetes behind Cloudflare a hybrid target. Rejected because CDN delivery does not change where ShareSlices runtimes execute.

Alternative: duplicate cache rules in provider scripts. Rejected because provider output must be generated from the source-linked route/cache projections and validated against their OpenAPI and implemented-spec owners.

### 10. Assemble the Cloudflare target from three Worker responsibilities and bounded Containers

The Cloudflare target uses an existing Cloudflare account, existing zones for the trusted and content registrable sites, external PostgreSQL, and an existing Resend account.

```text
Cloudflare Edge / CDN
├── content-hashed Web assets: cacheable
├── immutable Viewer Version bytes: optional, after authorization
└── dynamic, credentialed, Preview, and stable Viewer routes: bypass

trusted Web, API, and Viewer hosts
└── App Worker
    ├── Workers Static Assets
    ├── trusted Hono HTTP application
    ├── cache-disabled Hyperdrive
    └── private R2 bindings

separate Untrusted-content registrable site
└── Content Worker
    ├── content-only Hono application
    ├── cache-disabled Hyperdrive
    └── private manifest-backed R2 reads

no public route
└── Jobs Worker
    ├── Queue consumers
    ├── scheduled maintenance and recovery
    ├── Resend HTTPS Adapter
    ├── bounded processing-Container controller
    │    └── trusted Rust drain Runner
    └── thumbnail execution broker
         └── secretless Rust + Chromium Container

release time only, no public route
└── Verifier Worker ← isolated temporary Queue
    ├── fetch Service Binding → App / Content candidate versions
    ├── fetch Service Binding → Jobs private probe
    └── private release-and-fence evidence
```

The App Worker performs checked host-aware routing before static fallback. Management hosts expose trusted Web and API routes; Viewer hosts expose only the Viewer route group. Static Assets cannot shadow dynamic application routes. `/internal/*` remains unavailable publicly.

#### Cloudflare Edge/CDN policy

The Cloudflare target owns an explicit Edge/CDN module with two deployment modes:

| Mode | Behavior |
| --- | --- |
| `web-assets-only` | Default. Workers Static Assets distributes release-manifest Web files. A generated `_headers` projection gives content-hashed JavaScript, CSS, fonts, and images immutable browser caching, while the HTML shell and runtime bootstrap use release-coupled revalidation rather than indefinite caching. |
| `web-and-public-viewer-bytes` | Optional. In addition to Web assets, the App Worker may reuse immutable committed Version bytes from an internal edge cache only after it resolves the stable Share route against current Publication state and fixes the authorized Version. |

The optional mode does not cache the stable `/a/{shareSlug}/` entry, known-link state, Preview route, API response, login or Cookie response, management route, Upload, Gallery authorization, or isolated credential-bearing content response. Those routes execute Worker logic first and retain `Cache-Control: no-store`. A Static Assets match or SPA fallback can never satisfy them. `_headers` applies only to Static Assets, so Worker-generated responses attach the authoritative cache and security headers in code.

Selective `assets.run_worker_first` routing is also a capacity boundary, not a
free fallback mechanism. Requests matching those patterns invoke Worker code
and consume the applicable Worker allowance; on Workers Free, exhausting that
allowance returns `429` rather than falling back to the matching Static Asset.
The generated routing projection therefore sends only declared static paths
directly to Static Assets, counts every Worker-first public path in quota and
abuse-risk planning, and verifies fail-closed behavior under an exhausted or
artificially bounded allowance.

For an eligible public Viewer asset, the App Worker follows one ordered flow:

1. Authorize the stable Share route against current Publication state and fix one committed immutable Version.
2. Build an internal cache identity from the Version content identity, normalized manifest path, and a canonical representation descriptor. The descriptor includes content type, content encoding, renderer or format revision, and every allowed response-negotiation input; unkeyed negotiation is forbidden. The stable Share slug, Cookie, authorization header, and Preview grant never become shared cache identity.
3. On a miss, read the exact object through a private R2 binding and optionally populate a separate cacheable full-body `200` response.
4. Construct the outward stable Viewer response independently with the product status, content type, content encoding, security headers, validators, `Vary` policy, and `Cache-Control: no-store`. The outward response is never passed to `cache.put()`.
5. Bypass Cache API population and reuse for Range requests and `206` responses. Because authorization runs before every lookup, Unpublish, expiry, replacement, or restriction prevents later access without depending on purge completion.

The implementation may attach cache tags and perform precise purge during release, Publication, or content-retirement workflows as hygiene and storage reclamation, but purge is not the authorization mechanism. `r2.dev` and public R2 custom-domain access remain disabled, so neither a cache key nor an object address creates a second public route around the Worker.

The official Cache API is data-center-local, `cache.put()` does not use tiered caching, rejects `206` and no-store responses, and can reject an oversized representation. The feasibility and cost test therefore sets an explicit full-body size bound and measures real hit ratio, R2-read reduction, and rejection behavior before enabling Viewer byte caching; the design does not claim global replication or savings merely because the API is named Cache. `CF-Cache-Status` is corroborating evidence only; repeated requests, R2-read instrumentation, and post-Unpublish or expiry probes establish correctness.

The content Worker is independently deployed and routed on a different registrable site from Web and API. It receives no management routes, Better Auth builder, Session-cookie dependency, email binding, Queue control, or administrative mutation interface. R2 stays private; all content is selected through current credential, eligibility, manifest, path, and response-hardening policy.

The jobs Worker has no public route. Queue and scheduled handlers perform bounded Node maintenance or address stable pools of Durable Object-backed Containers. A trusted processing Container uses the same Rust processing Modules and PostgreSQL job contract as Kubernetes for non-browser lanes. A separate thumbnail Container runs Chromium without database credentials, R2 credentials, or general Worker authority. Both images are built for `linux/amd64`, must fit their selected instance disks, and are qualified under the account's Workers Paid Container entitlement.

The trusted Rust processing Runner cannot use a Hyperdrive binding as though it were a PostgreSQL socket inside the Container. It needs one proven direct TLS PostgreSQL path with explicit hostname/certificate verification and least-privilege database credentials. For a public database endpoint, the Container uses a deny-by-default `allowedHosts` host policy with Internet enabled because Cloudflare denies non-HTTP PostgreSQL traffic when `enableInternet` is false. That policy is whole-Container host filtering, not proven port-level or per-process isolation, and no stable egress-source address is assumed. If the database is private, those processing lanes are ineligible until an official Container-compatible private TCP path is configured and tested; a Hyperdrive Tunnel or Workers VPC connection for the App Worker alone does not prove Container reachability.

HTTP/HTTPS egress from each Container is intercepted by the trusted jobs Worker. The Worker exports Cloudflare's required `ContainerProxy`; HTTPS interception is enabled only when needed and then the Container explicitly trusts the injected ephemeral CA. Private R2 operations are exposed to the processing Runner through narrowly scoped virtual HTTP handlers backed by Worker bindings, so R2 credentials and public R2 URLs are not placed in the image. The thumbnail Container keeps `enableInternet = false` and allows only its internal broker host over the platform-secured virtual HTTP path; the trusted processing Container enables Internet solely for direct PostgreSQL on its exact allowed host and denies every undeclared host.

For thumbnails, the Jobs Worker claims and fences the attempt before starting a named thumbnail slot. The broker issues a short-lived single-use bootstrap grant for the Chromium entry URL. Consuming it atomically establishes a separate HttpOnly, SameSite-strict, route-path-scoped capture session limited to `GET` of the immutable Version's allowed manifest paths; replaying the bootstrap grant still fails. A distinct controller/output capability owns heartbeat, upload, and fenced commit. Only the bootstrap grant and derived read session may enter the browser request context. The mutation capability never enters a URL, Cookie, document, Artifact-readable header, or browser process state.

The broker binds both audiences to `containerId`, rejects cross-audience use, and performs every PostgreSQL and R2 action outside the Container. Artifact-controlled Chromium cannot address mutation operations, PostgreSQL, R2, or the Internet. Read-only `doctor` validates configuration and existing evidence; staged qualification proves the effective database hostname policy, broker scope, intercepted destinations, DNS behavior, inherited descriptors, redirects, browser schemes, and blocked arbitrary egress before the corresponding capability can pass.

Infrastructure as Code (IaC) and application-release ownership are disjoint:

| Concern | Owner |
| --- | --- |
| Long-lived R2 buckets, product Queues and DLQ, Hyperdrive configurations, routes, and custom domains | Pinned Cloudflare Terraform provider under `deploy/cloudflare/` |
| Cron triggers, Queue-consumer attachment and delivery settings, and other Worker-coupled fields | Exactly one owner selected by the disposable-account source-of-truth gate; Terraform/Wrangler split ownership is forbidden until repeated apply/deploy proves preservation and empty drift |
| App and Content bundles, Static Assets, ordinary and Secret bindings, versions, and deployments | Pinned Wrangler Adapter under `deploy/cloudflare/`; resolved Secrets enter only staged version upload |
| Jobs bundle, ordinary and Secret bindings, Container `exports`, configuration, image, and immediate deployment | Pinned Wrangler Adapter under `deploy/cloudflare/`; existing Secrets are preserved and rotation uses the same trigger-isolated deploy with an ephemeral `--secrets-file` |
| Release-only verifier Worker, fetch-based Service Bindings, isolated temporary Queue and paused consumer, and private evidence prefix | Deployment Module through pinned provider Adapters; names include the release and fence, never overlap product Queues, expose no public route, and are removed only after positive ownership checks |
| Secret values before the target-specific release mutation | Operator Secret source; never Terraform state, rendered bundles, or deployment records |
| Authoritative operation lease, fencing sequence, and phase journal | Deployment Module through the application-owned deployment-control schema in external PostgreSQL; first-install bootstrap is one checksum-verified transaction under a deterministic advisory lock |
| Secret-free Cloudflare deployment-state object and conditional target record | Deployment Module through a private Workers R2 binding or S3-compatible API whose conditional create and update paths passed the pinned gate; after validating the PostgreSQL fence and encoded mirror fence, an existing object uses ETag match and an absent object uses wildcard create-only preconditions |
| Release ordering, compatibility, verification, records, and rollback eligibility | Deployment Module |

Queue consumers, Cron schedules, and routes bind to a Worker script identity, not a Worker version. They therefore invoke whichever deployment is active for that script and do not roll back with an App or Content version. This is why Jobs immediate deploy requires independent Queue/Cron isolation and why trigger compatibility is validated against both active and rollback releases.

IaC state uses an operator-configured encrypted, access-controlled backend and is never committed. Sensitive values remain outside plans and release bundles. IaC and Wrangler cannot own the same resource field. Because Wrangler treats its configuration as Worker source of truth, generated inputs may omit a Terraform-owned Worker-coupled field only after a disposable-account loop proves repeated Terraform apply plus every Wrangler deploy path preserves that field and returns empty drift. Otherwise one tool must own the Worker and field together, and activation remains blocked until the ownership matrix selects that single owner. Production configuration explicitly sets both `workers_dev = false` and `preview_urls = false`, and `doctor` verifies that neither public fallback is active. Terraform never owns Worker Secret values or mutates version bindings.

App and Content Secret rotation creates zero-percent ordinary-traffic candidates, verifies them through the release-only harness, and then shifts traffic. Zero percent is not an access-control boundary: during an upgrade, an external request to an existing route can present the documented version-override header. Every candidate must therefore satisfy the full production authentication, authorization, route, header, logging, and Secret-handling contract before it enters the current deployment; it contains no preview-only bypass or debug authority, and its version ID is not treated as a Secret. Jobs deploy preserves existing Secrets. A Jobs Secret rotation closes the scheduled-execution gate, pauses Queue delivery, detaches Cron, confirms the control-plane absence, waits the full maximum propagation interval recorded by the pinned platform baseline, and resolves an ephemeral `--secrets-file` only for that immediate deployment. It verifies required Secret names and rollout state, destroys the file without logging or recording its contents, restores triggers through the same control-plane and safety-window checks, and opens the scheduled gate last. Cloudflare exposes no global propagation-complete signal; the closed gate makes any late invocation a fenced no-op.

Omitting a Jobs Secret does not retire it. Binding deletion waits until no active or retained rollback bundle requires the name, then runs as a separately authorized trigger-isolated maintenance operation through a pinned deletion interface that passed disposable-account qualification with the chosen `exports` configuration. Because the documented deletion command immediately creates and deploys a Worker version, the qualification and postcondition checks prove that code, ordinary configuration, Durable Object `exports`, selected Container image, and every retained binding remain identical to the approved pre-deletion bundle while Jobs and Containers converge separately. If deletion succeeds but any postcondition is failed or indeterminate, Cron remains absent, Queue delivery remains paused, and the scheduled gate remains closed while the exact retained bundle re-adds the binding from the operator Secret source or an authorized forward-fix is applied. Triggers are never restored into the ambiguous deployment. Without the initial proof, automation retains the binding and reports least-privilege drift. Standalone immediate-deploy Secret commands and unqualified versioned-Secret or deletion commands are forbidden in production automation.

Alternative: serve Untrusted-content from the App Worker because both are Workers. Rejected because runtime type does not satisfy the required registrable-site, credential, route, and capability boundary.

Alternative: retain the Node API or Rust Worker in Kubernetes behind Cloudflare. Rejected as the Cloudflare target because it would require both runtime compositions; that arrangement remains Kubernetes with an optional edge.

### 11. Preserve thumbnail security as a platform-neutral outcome

Kubernetes can express the existing controls directly: non-root, all capabilities dropped, no privilege escalation, and runtime-default seccomp. The current Cloudflare Container manual documents per-instance VM isolation, bounded instance types, ephemeral disk, and outbound policy, but does not expose Kubernetes-equivalent `runAsNonRoot`, capability-drop, `allowPrivilegeEscalation`, or seccomp configuration fields. The design therefore does not infer those controls from the word "Container." It retains the concrete controls for operator-managed runtimes and defines the non-negotiable outcome for managed runtimes: no root or host authority, no privilege escalation or effective extra capabilities, a provider-enforced system-call and process boundary, bounded resources, and no public-network access from Artifact-controlled Chromium.

Because Cloudflare outbound controls apply to the whole Container rather than separately to the trusted Rust parent and Chromium child, the thumbnail Container does not receive the trusted processing Container's direct database capability. It is secretless and communicates only with the job-scoped execution broker described above. This removes the unsupported assumption that per-process network isolation can be derived from `allowedHosts`.

The Cloudflare target is not considered thumbnail-capable until a feasibility gate proves the broker scope, browser request boundary, and managed runtime isolation equal or stronger than the product outcome. Production and thumbnail Containers explicitly set `ssh.enabled = false`, provide no authorized keys, and verify that no SSH listener or injected access path is available. If equivalence cannot be evidenced, thumbnail processing is reported unavailable; the implementation does not weaken the requirement. Version readiness remains independent under the existing non-blocking thumbnail contract.

Alternative: waive controls that Cloudflare does not expose. Rejected because choosing a deployment target cannot lower the security contract for untrusted Artifact execution.

### 12. Use staged, compatibility-aware release phases

Every `apply` is an ordered, resumable release saga:

```text
doctor
  → render and verify artifact digests
  → observe and plan
  → authorize the exact plan digest and observed-state revision
  → acquire installation deployment lock
  → re-observe and reject drift from the authorized plan
  → validate schema and component compatibility
  → run expand-compatible migrations
  → activate backward-compatible downstream runtimes
  → activate public entry runtime
  → black-box verify
  → mark release active
```

For Kubernetes direct ownership, the migration Job completes before Deployments advance. Content, maintenance, and resident Rust Runner workloads can overlap the previous API version, so every committed migration prefix plus cross-runtime and database contracts support N/N-1. Public API and Web activation is last; optional CDN cutover is after origin verification. GitOps ownership receives the same ordered bundles but relies on explicit external promotion and returns `external_reconciler_required` until the requested phase evidence is observed. A GitOps rollback handoff selects the compatible prior runtime, configuration, ingress, and observation bundles against the current schema; it does not emit or rerun the prior release's migration Job.

For Cloudflare, before the first provider mutation the authorized plan proves that every proposed long-lived infrastructure field remains compatible with the active release and its rollback candidate when either exists; a first installation records that no predecessor exists. An incompatible route, Queue-consumer, trigger, Hyperdrive, or binding-resource transition is refused by ordinary apply and requires a separately reviewed maintenance procedure.

The first Terraform phase creates or updates private prerequisites without attaching Worker custom domains, public routes, or scheduled triggers; a DNS or TLS prerequisite is allowed only when it does not bind a Worker or expose a serving address, and any Jobs Queue consumer remains delivery-paused. Before the first Jobs bootstrap, its qualified Container image is available and verified. On first installation, each final Worker script name is then bootstrapped through immediate deployment in that no-ingress state; Jobs selects that qualified image and declares every stable Container class before later version upload is attempted. The bootstrap bundle only establishes the stable script and Durable Object identity and is never treated as the release Jobs bundle. Existing or bootstrapped App and Content scripts then use version upload followed by a zero-percent deployment. The two-version deployment limit is validated before staging.

This design chooses Durable Object `exports` for the Jobs Worker's Container classes. The qualified default path does not use `wrangler versions upload`, and the initial no-trigger bootstrap declares every stable Container Durable Object class. The actual release Jobs bundle is a separate immediate deployment after bootstrap and remains trigger-isolated until the release completes.

Exact-version and route-free functional verification use a release-only harness rather than a hidden public probe endpoint. The Deployment Module creates a positively owned verifier Worker with `workers_dev` and preview URLs disabled, an isolated temporary Queue and initially delivery-paused consumer, fetch-based Service Bindings to the final App, Content, and Jobs script names, and a release-and-fence-scoped private evidence prefix. It publishes exactly one nonce plus release, fence, expected App/Content versions, expected Jobs deployment/bundle/configuration identity, and expected Container image build identity and provider reference, resumes only the temporary Queue for that bounded probe, and handles duplicate delivery as the same idempotent fenced operation. The verifier calls App and Content with the documented version-override header over `fetch()` Service Bindings and calls the route-free Jobs `fetch` probe through a checked private verification contract over a Service Binding. App and Content evidence identifies the actual versions. Jobs evidence identifies the executing Worker version or deployment, embedded release bundle, ordinary configuration and `exports` digest, configured image reference, migration head, database access, and execution-broker scope; the controller compares all identities with the authorized release before accepting functional evidence. RPC Service Bindings are not used for version overrides, and the harness never uses production Queue, Cron, public routes, `workers.dev`, or preview URLs. The private harness protects the verification trigger and evidence; it does not make an upgrade candidate unreachable through an already attached production route.

Each Container image embeds an immutable build identity, release ID, and job or broker contract revision known before image publication. The release manifest maps that build identity to the recorded image content digest and qualified provider reference; the Container does not claim to self-measure its registry digest. Verification sequentially or within the configured concurrency bound addresses every stable trusted-processing and thumbnail slot that can receive production work. Each exercised instance returns its embedded identities plus release, fence, nonce, class, slot, and provider instance identity. The controller correlates those values with the selected provider reference and provider rollout state and accepts convergence only when every production-capable stable slot has exercised the expected build and no previous-image instance remains selectable. A configured image, Container listing, or one compatible exercise is insufficient evidence.

Synthetic database rows, broker attempts, Container invocations, and R2 objects use a dedicated non-product namespace positively owned by release, fence, and nonce; they never select or mutate a real account, delivery, Artifact, Version, Publication, or job. Before cleanup, the controller atomically records the evidence digest, marks the nonce terminal, and revokes or advances its probe sub-fence in the authoritative PostgreSQL journal. Every verifier, Jobs, broker, and Container synthetic mutation rechecks the live nonce and sub-fence at its authoritative database write or commit boundary, so work that has not crossed an external side-effect boundary becomes a no-op or rejected stale write after the nonce is terminal.

After the nonce is terminal, the controller immediately pauses and detaches the consumer, then drains or fences every nonce-scoped active invocation lease and waits the pinned maximum in-flight Worker, Container, broker, database, and object-write interval plus its safety margin. This bounded quiescence is required because a PostgreSQL pre-check cannot atomically prevent an R2 write that already crossed its external side-effect boundary. Only after quiescence does an idempotent final inventory and cleanup delete positively owned synthetic state, temporary harness resources, and raw evidence and confirm none can be recreated by an already-started invocation.

The small terminal nonce tombstone remains separately through a bound computed from observed configuration: at least the maximum of Queue message retention, send/retry delay and retry schedule, active-invocation lease, interrupted-recovery window, and the maximum cross-storage side-effect interval, plus the pinned clock/transport safety margin. Queue pause is not reported as draining an invocation already in flight. Expected tombstone retention is completed control state, is not a cleanup orphan, and does not by itself block activation. It is garbage-collected only after that bound and another no-owned-state check. The same terminal-state, quiescence, and cleanup/reconciliation contract runs after success, failure, or interruption. A fresh instance may be created for a later release phase; an instance is never reused after its assigned evidence is finalized. Unconfirmed quiescence or cleanup leaves an isolated non-public orphan in status and cannot activate product traffic or triggers. This harness is release tooling, not a third product runtime or a public verification API.

For each later release, the qualified Container image is available before the Deployment Module closes a PostgreSQL-backed scheduled-execution gate, pauses Queue delivery, detaches Cron, confirms the expected control-plane absence, waits the full maximum propagation interval recorded in the pinned platform baseline, and drains, expires, or fences in-flight work. Cloudflare does not expose global propagation completion, so the scheduled gate remains closed and every late invocation becomes a fenced no-op. The module then uses immediate `wrangler deploy` while the script still has no public route and observes both Jobs Worker and Container rollout. On first installation, the product gate does not need to predate its creating migration because the bootstrap Jobs script has no Queue delivery, Cron, public route, `workers.dev`, or preview URL; the migration creates the gate closed before any trigger attaches. Queue, Cron, and the scheduled-execution gate remain isolated until every migration, staged probe, candidate activation, and applicable public-route verification passes.

A Durable Object class lifecycle change is forbidden in ordinary apply and requires a separately authorized maintenance procedure; rollback cannot cross such a change. A future pinned Wrangler path may replace the immediate-deploy path only after the disposable-account gate proves equivalent staging and rollback behavior.

The Deployment Module runs the packaged migration through one checked-out direct PostgreSQL connection, then uses the release-only harness to reverify the exact staged App and Content version IDs, the exact Jobs identity, and every production-capable stable Container slot against the observed migration head. Provider deployment metadata, a selected image reference, a Container list, or one old but compatible Container exercise is insufficient functional or convergence evidence. Messages already in flight remain safe through PostgreSQL claims and fences.

Activation then branches by installation state. On a first installation, Content and App candidates are promoted to 100 percent and reverified through the release-only harness while no public ingress exists. The module then replaces each current deployment with the candidate alone, rereads provider state until it observes exact candidate-only membership, and proves that an override naming the bootstrap version no longer selects it. After the harness is safely detached, the qualified ingress owner attaches Content ingress and then the App custom domain and public routes; black-box verification runs while Cron is absent, Queue delivery is paused, and the scheduled gate is closed. Only after that verification succeeds does the single qualified trigger owner attach Cron, re-read the expected control-plane state, and wait the full pinned maximum propagation interval; the module then resumes Queue delivery and opens the scheduled gate last. A first-install pre-traffic failure removes positively owned new ingress and Cron through those same owners, pauses Queue delivery, keeps the gate closed, restores and observes bootstrap-only no-ingress current deployments so the failed release candidates are absent, and reports any unconfirmed candidate or verifier cleanup as an isolated blocked state.

On an upgrade, existing entry resources continue serving the previous deployments while Content shifts first and App/Static Assets shift last. Black-box verification completes before Cron is restored through the same control-plane read and full safety window, Queue delivery resumes, and the scheduled gate opens last. Failed staged, migration, post-migration, candidate-reverification, or traffic work replaces the App and Content current deployments with retained previous-only versions and observes the failed candidates absent before compensation succeeds; Jobs triggers remain isolated until rollback verification succeeds. If candidate removal fails or is indeterminate, status is degraded and blocked, explicitly reports that the candidate remains externally selectable through the existing route, and never claims that only the previous release is serving. Retained version artifacts may remain outside the current deployment for evidence or recovery. Attaching a custom domain never selects a version, so no first-install route is attached until the candidate is active, reverified, and the bootstrap is absent from current deployment membership.

Cloudflare updates Worker code at deployment activation while Container instances roll separately. The Jobs Worker controller, previous Container image, and new Container image must therefore accept both previous and new job contracts until the Container rollout and active drains complete. The initial implementation uses a staged 100-percent switch per verified public Worker rather than gradual traffic splitting; gradual rollout remains deferred until Static Assets version affinity and cross-Worker version skew are proven.

`rollback` reverses application activation to a recorded previous release only when the current schema and durable resources are in its compatibility range. App and Content rollback reactivate retained Worker versions with their recorded code, Static Assets, bindings, and version-scoped Secrets. Before mutation, it proves those exact versions remain provider-addressable, accounting for Cloudflare's current 100-published-version retention limit and bootstrap/verifier churn, and proves that every required binding resource and retained Container image still exists. A local release bundle alone cannot recover a provider-evicted Worker version or deleted image.

Jobs rollback closes the scheduled-execution gate, pauses Queue delivery, detaches Cron, confirms the control-plane absence, waits the full maximum propagation interval from the pinned platform baseline, and immediately redeploys the retained Jobs bundle that selects the previous image and configuration. That deploy starts a separate rolling replacement of Container instances; Jobs Worker activation is not evidence that Container rollback has converged. After rollout and black-box verification, Cron restoration is confirmed in the control plane and held behind the same full safety window, Queue delivery resumes, and the scheduled-execution gate opens last.

The release gate must prove the previous Jobs bundle and image are retained, selectable through the pinned provider interface, and compatible during the mixed rollout, or automatic rollback refuses.

Long-lived routes, domains, Cron triggers, Queue consumers, R2, Queues, and Hyperdrive remain at current state under the ownership matrix's single qualified owner and must satisfy the previous Worker and Container contracts. Otherwise rollback refuses and points to a separately reviewed IaC or Worker-configuration recovery or forward-fix. Rollback never runs a down migration, deletes R2/S3 objects, removes Queues, rewinds IaC, or claims to restore an externally revoked credential or side effect.

Alternative: deploy all components concurrently. Rejected because Cloudflare changes are not atomic across Workers and Kubernetes naturally overlaps versions.

Alternative: make every schema change automatically reversible. Rejected because destructive reversal cannot restore lost data or external effects safely.

### 13. Execute one route, cache, isolation, and smoke contract locally and on both production targets

`deploy/contract/` contains machine-readable deployment projections. Route rows reference an OpenAPI operation ID or a documented non-HTTP route family; policy rows reference the implemented OpenSpec requirement that owns authorization, status, header, or cache behavior. These files do not become a second product or wire-contract authority: generation and validation fail when the projection drifts from OpenAPI, implemented specs, or the runtime executable schema. The projections drive local Compose regression tests, Kubernetes ingress render tests, optional-CDN parity, Cloudflare Worker routing and Static Assets tests, content-runtime isolation, and post-deployment verification. Compose executes only provider-neutral rows and records every provider-only row as `not_applicable` with a stable reason; a production target cannot consume that local result as qualification evidence.

Verification has three explicit levels:

- **core verification** is read-only and checks release identity, health, route ownership, forbidden management exposure, redirects, cookies, cache headers, private-object non-exposure, registrable-site separation, and observed component versions;
- **pre-traffic qualification** is an explicitly authorized apply phase that may create only isolated release-owned probes needed to prove CNI enforcement, workload egress, Cloudflare Container database reachability, broker isolation, or another runtime path that read-only discovery cannot prove; it records redacted expiring evidence and removes those probes before activation;
- **deep verification** uses explicitly supplied isolated credentials and recipients to exercise Upload, processing, Preview, Publish, Viewer, Unpublish, Gallery fail-closed or eligible behavior, SMTP or Resend delivery, and immediate state visibility, then removes only its own test data.

`status` distinguishes core application health from SMTP/Resend, processing, thumbnail, CDN, and Gallery readiness. It also reports operation-lease/fence state, migration head, job backlog and lease health, Queue/DLQ depth, trigger delay, Container startup and runtime, database connection headroom, storage and request quota headroom when observable, and stable cost-risk warnings. Healthy Pods or active Worker versions do not imply Gallery eligibility. Gallery is ready only when its existing live capability gate and external topology probes pass.

Alternative: maintain separate target smoke suites. Rejected because each target would be tested only against itself rather than one observable product contract.

### 14. Keep Secret, recovery, and destructive-action handling explicit

Deployment configuration stores Secret references and operator-controlled non-secret revisions, never checked Secret values or value-derived fingerprints. Kubernetes references existing or externally synchronized Secrets and stamps only the revision onto consuming Pod templates so in-place rotation triggers the required rollout. Cloudflare uses staged version Secrets for App and Content, and trigger-isolated immediate deploy with preserved or explicitly supplied Secrets for Jobs; Terraform state never owns those values. Resend uses a sending-access key scoped to the verified sending domain; broader provider administration is unnecessary. Release records contain resource identifiers, Secret revisions, and redacted configuration digests, not credentials, Session material, database URLs, email tokens, raw Share slugs, or object keys.

Credential rotation is compatibility-aware. For a shared signing or verification key, consumers first accept both old and new keys, producers then issue only with the new key, and the old key is removed only after the maximum token, grant, and mixed-runtime lifetime expires. Provider credentials use an operator-declared overlap window when dual keys are supported. If safe overlap is impossible, online rotation is refused and requires an explicitly planned maintenance procedure. Application rollback never claims that it can resurrect a revoked external credential.

Plans classify deletion, replacement, public-address changes, registrable-site changes, bucket changes, and database changes as destructive or security-sensitive. Every plan contains its desired-state digest and the observed target revision on which it was based. `apply` must consume that exact authorized plan, re-observe after acquiring the operation lease, and refuse when drift invalidates the plan. Ordinary `apply` refuses deletion or replacement of durable prerequisites. It may perform ordered retirement of positively identified release-owned workloads only after traffic and schedules are removed, inactivity is verified, and rollback retention is preserved. Unknown or unowned resources require a separately reviewed operator procedure; `rollback` cannot authorize their deletion.

The operator owns backup products and recovery objectives, but a production configuration declares evidence for PostgreSQL, S3/R2, Terraform state, immutable release bundles, and the deployment journal: responsible owner, encrypted location, retention, maximum evidence age, and intended RPO/RTO. `doctor` validates references and freshness without creating backups. Periodic deep recovery drills restore into an isolated environment in dependency order, reconcile database and object-storage restore points, and fail closed when their shared consistency marker cannot prove a compatible snapshot. Disaster recovery is never represented as application rollback.

Alternative: generate placeholder Kubernetes Secrets. Rejected because placeholders can be deployed accidentally and make a plan look complete when credentials are unusable.

Alternative: store target credentials in workflow YAML. Rejected because workflows are callers, not Secret or deployment-policy owners.

## Risks / Trade-offs

- [The Node dependency graph may not run completely in Workers] → Add an early compatibility gate for Better Auth, Drizzle, PostgreSQL drivers, streaming Upload/export, Web Streams, R2 multipart behavior, and Hono error mapping. Do not declare the Cloudflare target supported until the existing HTTP contract passes.
- [Hyperdrive can cache stale reads and does not support every PostgreSQL session feature] → Disable caching initially, route unsupported operations through a direct connection, test each database responsibility, and enforce a connection budget.
- [Cloudflare Workers and Container versions cannot switch atomically] → Use downstream-first staged rollout, N/N-1 fixtures, version-specific smoke requests, recorded component IDs, and App Worker activation last.
- [A zero-percent Worker candidate can still be selected through an existing public route by a version-override header] → Treat every candidate as externally addressable before staging, require the complete production authorization and response-security contract with no preview-only authority, verify override requests cannot bypass policy, and never describe zero percent as non-serving or access control.
- [Queue delivery is at least once and publication can fail after database commit] → Keep PostgreSQL authoritative, use recoverable dispatch records, preserve fenced claims, tolerate duplicates, and schedule backlog recovery.
- [Containers add cold starts and can increase cost during a wake storm] → Keep user operations asynchronous, cap concurrent drains, coalesce signals, stop after bounded idle time, and expose wake-to-claim metrics.
- [Managed Container isolation may not prove equivalent to the existing thumbnail contract] → Make isolation evidence an early feasibility gate and report the capability unavailable instead of relaxing the contract.
- [Container egress applies to both trusted Rust and its Chromium child] → Split thumbnail execution into a secretless Container and a narrow Worker-side broker; never give the browser Container the trusted processing database path.
- [A CDN or edge default can violate `no-store` or let stale Viewer bytes bypass revocation] → Render from source-linked route/cache projections, require authorization before optional byte-cache lookup, keep R2 private, and probe the actual edge. Fail readiness when observed caching, statuses, cookies, headers, or post-Unpublish behavior differ.
- [A Cache API implementation can accidentally store the outward no-store response or reject Range responses] → Separate the cacheable internal full-body representation from the outward response, bypass Range/206, bound cacheable size, and test R2-read behavior rather than trusting `CF-Cache-Status` alone.
- [Gallery can appear configured while its browser-site boundary is unsafe] → Validate registrable sites, cookies, routes, headers, and live runtime behavior; remain fail-closed on uncertainty.
- [Resend quota, rate limits, finite idempotency retention, tracking, provider retention, account switching, or an account issue can interrupt or alter authentication email] → Preserve durable retries and circuit breaking, pin every attempted delivery to one team/sender/payload identity, distinguish provider acceptance from delivery, keep authentication tracking disabled, stop blind resend after the idempotency window, surface email capability degradation separately, and document live plan/privacy facts without hard-coding them as product guarantees.
- [Enterprise SMTP varies in TLS and authentication behavior and has no general idempotency contract] → Make the operator declare the accepted TLS mode and relay namespace; let ordinary `doctor` check DNS, TLS and authentication capability, credential reference, and sender syntax without `MAIL FROM` or recipient acceptance; freeze one relay/sender/message identity per attempted delivery; prove envelope acceptance and the server's final success response after the complete `DATA` transaction only in authorized qualification or deep verification; record transport acceptance only after that final response; route a lost post-submission response to manual reconciliation without automatic resend; and keep SMTP health independent from API readiness.
- [Manual reconciliation can race a dispatcher or authentication-material consumer, or accept a forged operator identity] → Require a signed single-use maintenance envelope, lock delivery and related authentication material in one transaction, reject active leases and stale fences, serialize against code verification and grant issuance, and close only the ambiguous delivery record without expiring, extending, invalidating, or recreating its verification code or reset grant.
- [IaC and Wrangler can compete over Cloudflare fields] → Maintain an ownership table, consume IaC outputs as immutable Wrangler inputs, and reject overlapping ownership in drift tests.
- [A browser-visible thumbnail grant can be replayed or become mutation authority] → Atomically exchange a single-use bootstrap grant for a short-lived path-scoped read session, split read and controller/output authority by audience and operation, and never place mutation authority in an Artifact-visible surface.
- [A previous runtime may not understand a later or partially applied schema] → Require expand/contract migrations, per-prefix N/N-1 tests, one checked-out migration client, checksums, and declared ranges; refuse unsafe rollback.
- [A deployment process can lose its database session or a first installation can lack its control schema] → Bootstrap the fixed PostgreSQL control schema atomically before provider mutation, then use a durable lease, heartbeat, monotonically increasing fencing token, and revalidation before every mutation instead of relying on a session advisory lock or R2 availability.
- [Secrets can rotate under a stable name without rolling consumers, while omitted Jobs Secrets remain bound] → Require a non-secret revision, stage App/Content Secrets into new Worker versions, rotate Jobs Secrets only inside its trigger-isolated immediate deployment, retire a Jobs binding only after rollback retention through a separately qualified isolated procedure, annotate Kubernetes Pod templates, and keep revoked external credentials outside rollback claims.
- [A successful replacement can leave an old route, schedule, or workload live] → Inventory and mark owned resources, detach ingress and scheduling first, verify inactivity, and retire only positively identified resources outside the rollback window.
- [Backup availability can be assumed but never exercised] → Require current operator evidence and isolated restore drills for database, objects, IaC state, bundles, and the deployment journal, including mismatch fail-closed behavior.
- [A common deployment layer can become a lowest-common-denominator abstraction] → Share only lifecycle, release, configuration, and verification contracts; retain topology inside target Adapters.
- [Moving Compose inputs or ambient Docker/Compose controls changes paths, interpolation, the model, Engine, or cleanup identity] → Pin the topology-specific ordered files, repository project directory, explicit project name, frozen endpoint/TLS snapshot, and observed Docker Engine server ID on every call; launch test children from a hermetic allowlist; preserve existing developer named-volume identity; and migrate only through the canonical controller.
- [A fixed Compose project can be mutated concurrently or Web E2E can reach developer data] → Hold endpoint/project and Engine/project OS locks from first mutation through cleanup, bracket every mutation with Engine identity checks, allocate and freeze dynamic loopback endpoints before starting application roles, reject test resources that escape project scoping, parameterize distinct-site endpoints, and never let tests use developer defaults, a remote daemon, or global Docker cleanup. A future multi-client remote developer profile requires one controller host or a daemon-side or distributed lease.
- [A green local Compose run can be mistaken for provider qualification] → Emit explicit `not_applicable` evidence for provider-only checks and keep production release status dependent on observations from the selected Kubernetes or Cloudflare target.
- [Direct Kubernetes apply and GitOps can overwrite each other or violate migration ordering] → Require one declared writer, expose ordered phase bundles, return `external_reconciler_required`, and report desired, handed-off, blocked, and observed state explicitly.
- [Cloudflare capabilities and constraints change] → Pin Wrangler, IaC provider, compatibility date, and required account capabilities in the release; revalidate with `doctor` rather than relying on static documentation.

## Migration Plan

The phases below are dependency order for implementation, not a prohibition on
earlier isolated research. Disposable provider prototypes that neither move
Compose ownership nor depend on the canonical local harness may run early, but
their evidence cannot qualify a production target or bypass a later phase.

1. **Establish executable deployment contracts.**
   - Add deployment and release schemas, target discriminator, command result model, source-linked route/cache projections, Secret revision/redaction rules, operation lease/fencing, release inventory, and deterministic fixtures.
   - Turn current Kubernetes defects into failing render and route-contract tests.
   - Freeze the canonical Compose command, origin, loopback, data-retention, and test-isolation contract before moving its implementation.

2. **Consolidate the canonical local and test topology.**
   - Move checked Compose inputs, Caddy configuration, lifecycle implementation, and isolated test fixtures under `deploy/` while pinning the repository project directory, preserving the developer project and volume identities, constructing a hermetic test environment, and updating every repository caller.
   - Keep the four canonical `mise` lifecycle tasks, update the Compose graph as runtime roles are separated, retain Mailpit SMTP and local-only credentials, and add meaningful health, one-shot completion, dynamically discovered test-port, host-reachability, dual-lock, and exact-project-cleanup checks.
   - Run cold and repeated development starts, status, logs, data-preserving shutdown, isolated API tests alongside the healthy developer stack, provider-neutral black-box verification, and destructive-scope assertions before production target work depends on the harness.

3. **Run feasibility gates before promising Cloudflare support.**
   - Build disposable platform prototypes for Worker runtime compatibility, bounded streaming and private R2, direct-PostgreSQL trusted Containers, secretless Chromium plus split-capability broker, versioned Secrets, unreachable first-deployment and Durable Object bootstrap, zero-percent version verification, exact Jobs identity, candidate removal from current deployments, verifier synthetic-state cleanup, and separate Worker/Container rollback.
   - Contract-test Resend sending-access credentials, verified-domain and disabled-tracking configuration, provider acceptance, same-team key rotation and cross-team retry refusal, 24-hour idempotency behavior, error-type classification, and payload redaction.
   - A failed prototype blocks only the Cloudflare target. Kubernetes implementation can continue without introducing a Cloudflare-specific product workaround.
   - A failed gate still blocks this combined change from being archived as fully implemented. If Kubernetes must ship first, move the unimplemented Cloudflare capability and tasks into a validated follow-up change.

4. **Extract runtime composition seams.**
   - Split HTTP serving from Node maintenance execution.
   - Add role-specific configuration and dependency composition.
   - Add Node HTTP entrypoints over the same Hono builders first, then accept
     the local Compose role graph and Kubernetes resident composition without
     waiting for Cloudflare-only runtime work.
   - Add Worker HTTP, Queue, and scheduled entrypoints only after their
     database, storage, email, ingress-metadata, and bounded-processing Adapters
     exist; then prove Node/Worker parity. Cloudflare-only entrypoints and
     parity evidence do not gate the alternative Kubernetes target.
   - Add S3/R2, SMTP/Resend, Hyperdrive/direct PostgreSQL, and trusted-request-metadata Adapters.
   - Add resident and bounded Rust Runners over current processing Modules.
   - Move Web public configuration to deployment-provided runtime bootstrap data.

5. **Make Kubernetes the first automated target.**
   - Replace example overlays with deterministic Kustomize sources and generated target bundles.
   - Remove fixed addresses, placeholder Secret data, per-Pod migration, mutable tags, and incomplete routes.
   - Add migration, API, maintenance with enterprise SMTP, content, Web, and resident Runner phases with security baselines.
   - Implement direct apply and direct-ingress verification, then enable provider-neutral external-CDN mode and prove parity.
   - Expose GitOps only as ordered immutable phase bundles with `external_reconciler_required` until an external owner promotes and the Deployment Module observes each gate.
   - Publish migration instructions for operators of the old examples.

6. **Add the Cloudflare target.**
   - Add IaC for ShareSlices-owned durable resources inside existing accounts and zones.
   - Package App, content, and jobs Workers, Static Assets, and trusted
     processing images from immutable release artifacts. Qualify the trusted
     processing Container independently from thumbnail generation because the
     former is required for the target's background work even when thumbnail
     readiness is reported unavailable.
   - Package and qualify the secretless thumbnail image and split-capability
     broker as a separate capability milestone. Free-compatible prototype work
     may continue while this milestone is deferred, but the target cannot be
     called release-qualified until it passes.
   - Wire external PostgreSQL, private R2, Queues, schedules, and the Resend Adapter.
   - Re-run production composition qualification, then implement phased private prerequisites, unreachable bootstrap when required, staged versioned-Secret upload, access-controlled candidate verification, candidate-only first-install activation, failed-candidate removal, trigger and route activation, release recording, status, separate Worker/Container rollback, and owned-resource retirement.

7. **Complete release and operator automation.**
   - Add thin build and deployment workflows that call checked `mise` tasks.
   - Produce artifact digests, compatibility evidence, target bundles, and deployment records.
   - Run lease-loss/resume, drift, intermediate migration failure, Secret and email-provider-namespace rotation, manual-reconciliation races, failed-candidate removal, verifier-orphan retirement, email-provider outage, CDN misconfiguration, Queue duplication, Container termination, rollback, and isolated disaster-recovery drills.
   - Update `PRODUCT.md`, `CONTEXT.md`, module architecture, and operations documentation before archival; let `/opsx:archive` apply the completed delta specs to the implemented-spec store.

The old Kubernetes example interface is removed only after the new renderer, migration guide, and direct target pass deep verification. Database changes and every committed migration prefix remain expand-compatible through the N/N-1 window, so source rollback never requires a down migration.

## Resolved Defaults

- Kubernetes and Cloudflare are mutually exclusive production targets; there is no hybrid target.
- Kubernetes uses Kustomize, an existing cluster, external PostgreSQL/private S3-compatible storage, and enterprise SMTP.
- Kubernetes direct application is first-party; GitOps receives ordered deterministic phase bundles, remains externally reconciled, and returns `external_reconciler_required` until observed.
- Kubernetes external CDN support is provider-neutral initially and does not provision a CDN account.
- Cloudflare uses separate App, content, and jobs Workers plus on-demand trusted processing Containers and secretless Rust/Chromium thumbnail Containers.
- Cloudflare uses external PostgreSQL, private R2, cache-disabled Hyperdrive, and Resend through a sending-access API key.
- Workers Free plus a separately enabled R2 subscription is only a disposable
  prototype execution profile. It is not a production Deployment target or a
  reduced Cloudflare target, and production lifecycle operations reject it.
- The content Worker uses a separate registrable site; a sibling management subdomain is insufficient.
- PostgreSQL remains authoritative; D1 and Queue-owned business state are excluded.
- Pinned Terraform owns the declared long-lived Cloudflare fields; pinned Wrangler owns Worker versions, version bindings, Durable Object migrations, Container configuration, and deployments; the Deployment Module owns its private release-state object.
- Cloudflare App/Content Secret values enter staged Wrangler version uploads; Jobs Secrets are preserved or supplied only during its trigger-isolated immediate deploy. Kubernetes Secret changes require an operator-controlled revision on consuming Pod templates.
- Cloudflare rollout is staged but not gradual by default.
- Rollback changes compatible application versions only; Terraform-owned long-lived resources stay current and must remain compatible, and rollback never applies down migrations or destructive infrastructure changes.
- Viewer Cache API reuse is authorization-first, full-body only, and internal; Range responses and all outward stable Viewer responses remain direct/private and `no-store`.
- Production automation uses durable operation fencing, release inventories, explicit resource retirement, recoverability evidence, and quota/cost-risk reporting.
- Compose remains the single non-production development and integration-test topology; it is not accepted by the production target discriminator or deployment lifecycle.
- `deploy/` owns Compose inputs and automation, while `mise run dev`, `dev-status`, `dev-logs`, and `dev-down` remain the only supported interactive lifecycle and preserve the canonical local origins and developer data by default.
- Local email uses Mailpit through the SMTP Adapter. The endpoint-and-Engine-locked `shareslices-test` project owns and removes only its test state, API and Web E2E use its dynamically discovered parameterized endpoints, and local verification reports provider-only checks as `not_applicable` rather than qualifying Kubernetes or Cloudflare.
- Live provider prototypes remove or disable public routes, triggers, consumers,
  Workers, and other continuously invocable resources after evidence capture.
  Any private prerequisite retained for the next bounded prototype has an
  explicit owner and expiry and is included in a final provider-state inventory.

## Open Questions

None.
