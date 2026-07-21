# Module Architecture

Target module architecture for ShareSlices. This document is **evolving design, not current state**: each section carries a status marker, and each OpenSpec change declares in its `design.md` which subset it realizes.

- `Status: target` — designed, not yet built. Interfaces here are directional; the implementing change may adjust them, then updates this file.
- `Status: current` — built. Code is the source of truth; this file records the shape and the reasoning.

Engineering rules that constrain all designs live in `AGENTS.md`. Product behavior lives in `PRODUCT.md` and `openspec/specs/`.

## Top-level seams

Status: current for the runtime seams, CLI authentication and Artifact commands, Agent protocol v1, official Skill entry, thumbnail generation and reads, Publication management, and Gallery.

| Seam | Status | Interface owner | Production Adapter | Test Adapter |
| --- | --- | --- | --- | --- |
| User and Artifact requests into API | current | `api/src/http/` | Hono route handlers | HTTP and YAML/Python contract tests |
| Hono HTTP into business behavior | current | `api/src/application/` | Hono handler mapping | Direct Module tests |
| Authenticated request into user account | current | `api/src/http/` | Better Auth Cookie, Device Authorization, and Bearer Adapters | Fake auth Adapter plus YAML/Python contracts |
| Authentication email delivery | current | `api/src/application/accounts/` | Durable PostgreSQL queue and Nodemailer SMTP Adapter | In-process SMTP server and Mailpit YAML/Python flow |
| Application data persistence | current | `api/src/application/*` | Drizzle Adapter | Local PostgreSQL or in-memory Adapter |
| Raw and processed object access | current | Application and worker Modules | S3-compatible Adapter | In-memory object Adapter |
| Processing job handoff | current | `db/migrations/` schema plus job Interfaces | Drizzle enqueue Adapter and SQLx claim Adapter | Local PostgreSQL and fake Adapters |
| Thumbnail job handoff | current | `db/migrations/` schema plus thumbnail job Interfaces | ready-Version enqueue and SQLx claim Adapter | Local PostgreSQL and fake Adapters |
| Agent intent into CLI | current | `skill/shareslices/` invocation contract | Official ShareSlices Skill | Fake CLI plus behavior, contract, and trigger evaluations |
| CLI commands into ShareSlices | current for human and Agent protocol v1 surfaces | `cli/` command Interface | Rust CLI with operating-system credential and continuation stores | In-memory credential/continuation and fake HTTP Adapters |
| Gallery trusted API and isolated content | current | `api/src/application/gallery/` and `api/src/content/` | PostgreSQL, private object storage, and content-only Hono runtime | Focused application, route, migration, and content-runtime tests |
| Gallery safety, cover, and copy jobs | current | checked contracts in `db/contracts/` | Rust Worker with fenced PostgreSQL leases | N/N-1 fixtures and focused Worker tests |
| Deployment lifecycle and target composition | mixed | `deploy/` Deployment Module | Kubernetes or Cloudflare target Adapter | Deterministic render, lifecycle, provider-spike, and black-box contract tests |

## Deployment Module

Status: mixed. Local Compose inputs and lifecycle policy are current under this
Module, and the target-neutral contracts plus part of the shared lifecycle core
are implemented. Kubernetes now has deterministic Kustomize composition, a
Secret-free release renderer, route and cache projection, role-scoped runtime
configuration, security and network-policy baselines, and an Adapter surface
for prerequisite discovery, server-side-dry-run planning, direct phased apply,
read-only observation, and release-bound verification. The shared
production entrypoint can consume a digest-bound authorized plan, fence and
journal its phases in PostgreSQL, and drive Kubernetes direct server-side apply
through migration and Deployment rollout gates. GitOps mode emits an immutable
external-reconciler handoff without writing the cluster. Release-bound core
verification can now record active and previous releases after exact rendered
resource convergence. Compatibility-aware direct rollback now restores the
recorded prior configuration and runtime without applying its migration, verifies
the result, and swaps active/previous records under a fenced operation; GitOps
rollback emits an immutable migration-free handoff without writing the cluster.
Safe retirement execution, deep verification, optional-CDN acceptance, real-cluster
acceptance, and release qualification remain target work. The Cloudflare
production Adapter and its mutating lifecycle remain target work; the checked
Cloudflare files currently provide provider-contract evidence and bounded
prototypes, not a supported Deployment target.

- `PRODUCT.md` owns the mutually exclusive target choice, cross-target product
  invariants, email-provider policy, caching boundary, and rollback limits.
  `CONTEXT.md` owns the accepted deployment vocabulary.
- `deploy/contract/` owns checked, provider-neutral deployment configuration,
  release, route, cache, verification-scenario, and evidence schemas. It contains
  no Secret values and does not duplicate public OpenAPI behavior.
- `deploy/automation/` owns the non-interactive `doctor`, `render`, `plan`,
  `apply`, `status`, `verify`, and `rollback` lifecycle, including redaction,
  operation leasing and fencing, immutable release evidence, inventory, and
  compatible retirement. CI workflows remain thin callers of this interface.
- `deploy/kubernetes/` owns deterministic composition for an existing conforming
  cluster. Its Adapter supplies Kubernetes, direct PostgreSQL, private
  S3-compatible storage, trusted-ingress, optional external-CDN, and enterprise
  SMTP mechanics without changing application policy. Its current lifecycle
  validates declared prerequisites, renders ordered phase bundles, applies
  authorized direct phases behind the shared PostgreSQL lease and fence, or
  emits a non-mutating GitOps handoff, and projects release records, operation
  phases, workload generations and image IDs, migration state, configuration
  and route digests, ownership drift, and optional-CDN readiness from read-only
  control and cluster observations. Status also reads the authoritative
  PostgreSQL migration head and projects Pod Ready/ContainersReady counts,
  container readiness and restart evidence instead of treating Deployment
  availability or migration Job annotations as sufficient. Its current `verify`
  path also runs the
  shared credential-free core HTTP checks against trusted and content origins;
  with an explicit release it also requires exact rendered-resource convergence
  and verification-contract identity before a separately fenced operation
  records active and previous releases. Authorized deep verification, network
  probes, retirement, and target qualification are not yet current. Direct
  rollback now requires a separately
  generated rollback plan bound to the exact observed revision, revalidates it
  after acquiring the PostgreSQL lease, proves retained image pulls and current
  Secret revisions, applies no migration Job, verifies convergence against the
  current schema head, and atomically swaps active and previous release records.
  GitOps rollback returns ordered prior configuration/runtime and ingress bundles
  with compatibility evidence, but does not claim external reconciliation.
  Direct and GitOps ownership are schema-exclusive; each GitOps phase carries
  the declared external owner, predecessor digest, and expected completion
  evidence. Status blocks a candidate runtime observed before its required
  migration evidence. The external operator still owns actual promotion and
  convergence.
  Direct and external-CDN delivery are mutually validated compositions. The
  external-CDN render adds only a provider-neutral contract containing origin
  access strategy, trusted-proxy source ranges and client-address header,
  evidence revisions, and the immutable route/cache contract digests. It does
  not provision a CDN account or add a Cloudflare-target runtime. Live
  origin-versus-edge parity and CDN qualification remain open.
- `deploy/cloudflare/` owns Cloudflare Workers, Edge/CDN, Static Assets, private
  R2, Hyperdrive, Queue, scheduled, Container, and Resend composition. Provider
  feasibility evidence gates only this Adapter; failure does not weaken shared
  policy or block the Kubernetes Adapter.
- `api/src/db/connection.ts` currently distinguishes direct Node, migration,
  processing-Container, and cache-disabled Hyperdrive modes. Only a typed direct
  connection exposes the checked-out-client operation used by migrations,
  advisory-lock paths, and long-lived authentication-email lease heartbeats;
  Hyperdrive TLS and compatibility qualification remain target work.
- `deploy/compose/` owns the canonical non-production local and isolated test
  topology. `.mise.toml` remains the public local lifecycle entrypoint. Compose
  is not accepted by the production target discriminator and cannot provide
  Kubernetes or Cloudflare qualification evidence.
- `deploy/compose/feature-baseline.json` records Docker Compose `5.1.2` as the
  currently exercised baseline and requires bounded `up --wait` with
  `--wait-timeout`, long-form healthy/completed dependency conditions, and JSON
  `ps`. The controller admits another Compose version only after capability
  probes and quiet validation of the selected checked model pass before its
  first mutation; post-start machine state and host HTTP/SMTP probes remain
  separate gates.
- `docs/operations/` owns operator procedures and prerequisite responsibilities.
  It does not become an executable second deployment implementation.

The lifecycle core depends only on a narrow target Adapter for observation,
rendering, mutation, verification, and rollback. Provider objects do not leak
into lifecycle policy, and application/domain Modules do not branch on target.
Both target Adapters consume the same immutable release, PostgreSQL authority,
private object layout, route/cache projection, compatibility metadata, and
verification scenarios.

Runtime composition is role-specific. Trusted API HTTP, maintenance and
authentication-email dispatch, content-only serving, one-shot migration,
background processing, thumbnail capture, and Web delivery receive only their
required configuration and authority. Node/Kubernetes and Cloudflare entrypoints
adapt the same application builders; they do not duplicate account,
authorization, Artifact, Publication, Viewer, Gallery, or email-delivery policy.

```text
                         Deployment lifecycle core
                                   |
                    +--------------+--------------+
                    |                             |
          Kubernetes target Adapter    Cloudflare target Adapter
                    |                             |
     cluster workloads + optional CDN     edge + bounded runtimes
                    +--------------+--------------+
                                   |
             shared application and durable contracts

        deploy/compose = local/test contract harness only
```

## Official Skill entry

Status: current

- `PRODUCT.md` owns intent, authorization, ambiguity, retry, resumption, and activation policy for the Skill and Agent mode. This section describes only the implementation seam.
- The official Skill is an intent Adapter over the installed `shareslices` CLI, not a second ShareSlices client. It may compose capability discovery, authentication, state inspection, and one explicit business operation, then summarize the durable result.
- Capability discovery and every operational invocation cross the same CLI process boundary. The Skill consumes the versioned Agent protocol and never imports CLI implementation modules or calls ShareSlices HTTP routes directly.
- The CLI owns package and execution mechanics behind its command Interface. It maps Server evidence into the common Agent envelope; the Skill adds only current user intent and authorized workspace evidence.
- Authentication continuation storage is a private CLI Adapter behind a versioned Interface. The Skill sees only the opaque identifier returned in the envelope and never persists CLI authorization state.
- Skill-to-CLI contract fixtures use a fake CLI Adapter. Behavioral and trigger evaluations exercise the intent Adapter without a live Server; generated evaluation output is not durable repository documentation.

## CLI authentication Modules

Status: current

- `cli/src/auth_commands.rs` owns the `auth login`, `auth status`, and `auth logout` command behavior behind `AuthApi` and `CredentialStore` Interfaces; `cli/src/lib.rs` is the public facade. The production Adapters use the checked HTTP API and the operating-system credential store; tests use fake HTTP and in-memory credentials.
- `cli/src/auth_continuation.rs` owns the versioned Agent authorization continuation Interface and its in-memory and private atomic filesystem Adapters. `cli/src/agent_protocol.rs` owns the checked protocol registry and typed envelope; `cli/src/cli_runner.rs` keeps Agent rendering separate from unchanged human dispatch.
- `api/src/http/cli-auth-routes.ts` is the product-owned HTTP Adapter over Better Auth Device Authorization and Bearer Sessions. It validates the fixed CLI client and transient version/operating-system compatibility metadata without persisting device identity.
- `web/src/screens/DeviceAuthorizationPage.tsx` owns the Cookie-authenticated `/device?user_code=...` approval flow. It preserves the verification code through login, exposes no account switch, and replaces approval with the terminal-return success state.
- JSON management routes accept Cookie or Bearer Sessions through the existing `getSession` seam. Preview content remains Cookie-only and Viewer content remains public according to Publication state.

## CLI Artifact Modules

Status: current for Artifact listing, Upload, high-level and stepwise Publish, Unpublish, Publication view/edit, ready-Version Export, and Delete in both human and Agent modes.

- `cli/src/artifact_commands.rs` owns bounded Artifact list presentation, selectable JSON formatting, shared interactive Artifact and ready-Version selection, Upload orchestration through ready Version commit, atomic Publish and Unpublish commands, Share-link management, atomic local Export, and confirmed permanent Delete. `cli/src/packaging.rs` expands selected local inputs, applies the active Server policy, and deterministically streams safe effective paths into a temporary ZIP; a single prepared ZIP bypasses repackaging. `ApiClient` follows opaque Server pages, transfers ZIP input with safe idempotent retries, downloads normalized Version ZIPs, never retries an indeterminate Delete, and supplies transient CLI compatibility metadata; production credentials still come only from the operating-system credential store.
- `ArtifactManagementService` owns list filtering, opaque pagination, and the owner-scoped ready-Version collection used by interactive CLI selection. Hono routes validate DTOs and map application errors without deriving Artifact state or Publication behavior.

## Hono runtime Modules

Status: mixed. Account entry remains a thin current HTTP/Auth/DB path. Artifact, Viewer, and Reconciliation behavior is current; Administration remains target.

- `ArtifactIntakeService`, `ArtifactManagementService`, and `ArtifactRecoveryService` are the current Artifact application modules. Together they own raw upload acceptance, Artifact state projection, name changes, permanent deletion, Share-link expiration, Retry, Replace file, idempotency, and ready-Version gates.
- `PublicationViewerService` is the current Publication and Viewer application module. It owns owner Preview and Version export checks, atomic Publish and Unpublish behavior, Share-slug lifecycle resolution, normalized manifest lookup, and immutable Version selection for each request.
- `api/src/http/publication-viewer-routes.ts` is the Viewer HTTP Adapter. For an active Publication entry request it serves a fixed trusted player that owns the Viewer full-screen controls and embeds the resolved Artifact entry through the reserved content-mode request; status pages remain plain responses, and the application Module still owns every Publication and asset-resolution decision.
- `ReconciliationModule` is current. It owns bounded expired-lease recovery, raw/staging object cleanup while preserving the current retryable input, completion of durable Artifact-deletion cleanup intents after interrupted requests, stale creating-bundle recovery, and unreferenced-bundle cleanup defined by [Content bundle reuse](content-bundle-reuse.md).
- Version thumbnail reads and internal capture routing are current thin HTTP paths over `ArtifactThumbnailRepository`. The repository owns Owner-scoped immutable thumbnail lookup through a Version's pinned Content bundle and renderer revision, one-time capture-grant consumption, capture-session validation, and manifest asset lookup; a separate application Module remains deferred until a second caller or Adapter appears.
- `UserModule` remains target. Current account entry intentionally stays in `api/src/http/account-routes.ts`, Better Auth, and focused account queries until another caller or implementation requires extraction.
- `AdministrationModule` is a roadmap Module for user search, deactivation, reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit. It stays separate because the actor and permissions differ from user-managed flows.
- `AuthenticationEmailDelivery` is current for durable PostgreSQL queuing and the
  SMTP Adapter. Account routes persist encrypted delivery payloads and return
  without contacting a provider; the separate maintenance composition leases
  pending rows, renders fixed authentication templates, invokes the current SMTP
  Adapter, records bounded provider-acceptance outcomes, and removes terminal
  payloads. Kubernetes manifests now compose the SMTP-backed maintenance role,
  but live enterprise-relay qualification remains target work. Cloudflare
  Resend HTTPS composition also remains target work. Neither transport affects
  API readiness or owns account-entry policy.

## Gallery Modules

Status: current, disabled by default until every deployment and live-readiness gate passes.

- `api/src/application/gallery/` owns independent listing/proposal transitions, Creator profiles, permission evidence, discovery, Download, Save-a-copy admission, reports, governance, provenance, retention, and reconciliation. Publication remains a separate aggregate.
- `api/src/http/gallery-routes.ts` is the trusted owner, discovery, interaction, and Administrator HTTP Adapter. `api/src/content/` is a separate content-only Hono application with only credential-bound manifest reads and private-object streaming; it has no management auth or mutation dependency.
- `web/src/screens/HomePage.tsx`, `BrowsePage.tsx`, `GalleryListingPage.tsx`, and `CreatorPage.tsx` are public trusted pages. Home owns resilient product content plus bounded Featured-to-Newest discovery; Browse owns the full Gallery collection query surface. `ArtifactGalleryDialog.tsx` owns owner share/update/withdraw interaction, while `GalleryAdministrationPage.tsx` owns the minimal authorized governance queue and notification surface outside Console.
- `worker/src/gallery_safety_job.rs`, `gallery_cover_job.rs`, and `gallery_copy_job.rs` consume the checked language-neutral contracts. API policy owns admission and terminal state; Worker results cannot mutate policy directly.
- `cli/src/gallery_commands.rs` exposes the four owner operations through the same checked HTTP client and Agent protocol used by the official Skill. It never implements Gallery policy locally.

## Trusted Web surfaces

Status: current

- `web/src/routing.ts` owns canonical route classification, typed destination generation, route-owned query parsing, safe authentication returns, and pure legacy-location resolution. `web/src/main.tsx` applies that resolution synchronously before React, Session lookup, or page selection begins.
- `PublicSiteShell` owns public Website navigation and non-blocking Session projection. `ConsoleShell` owns ordinary personal-management navigation, while `AdministrationShell` remains a distinct permission surface. `App.tsx` lazy-loads Website, account-entry, Console, owner Preview, and administration page groups without adding a second application or routing framework.
- `web/src/document-metadata.ts` is the single hydrated-document metadata controller. Every route begins from `noindex,nofollow` with no canonical link; only a typed eligible public resolution upgrades indexing and canonical metadata. The client document does not claim route-specific HTTP status.
- `/console` renders the existing `ArtifactsPage`; owned detail and Preview use `/console/artifacts/{artifactId}` descendants, Gallery profile settings use `/console/settings/gallery-profile`, and API adapters retain their resource-owned `/api/artifacts` and Gallery paths.

## Web Artifact player

Status: current

- `web/src/components/ArtifactPlayer.tsx` is the reusable owner player for the ordinary Preview page and Card full-screen mode. It owns the content iframe, accessible enter and exit controls, Fullscreen API event synchronization, and local failure feedback; it does not own Artifact, Version, or Publication policy.
- The canonical `/console/artifacts/{artifactId}/preview` route renders the player outside Console chrome. The legacy `/artifacts/{artifactId}/preview` document retains `no-store` only for replace-style migration. `ArtifactsPage` keeps Card eligibility and management-state preservation local, while `ArtifactPage` and Card thumbnail navigation open the canonical trusted Preview route.

## Rust worker Modules

Status: current for Upload processing, Content bundle reuse, bundle-scoped
thumbnails, bundle-alias index rebuilding, Gallery background jobs, resident
and bounded Runner composition, and Kubernetes resident-workload rendering.
Live Kubernetes workload qualification and Cloudflare Queue/Container
composition remain target work.

- `Runner` in `worker/src/runner.rs` is the shared scheduling core for resident
  and bounded execution. A `BackgroundLane` claims at most one authoritative
  unit, retains its lane-owned PostgreSQL lease, heartbeat, fence, retry, and
  terminal-outcome semantics, and exposes a read-only remaining-work check.
  The resident Worker currently runs Artifact processing, thumbnail, bundle
  alias, Gallery safety, Gallery cover, and Gallery copy lanes through this
  interface. The private `drain` command selects an explicit enabled lane set,
  requires maximum claims, idle observations, and wall time, and emits a
  machine-readable outcome with conservative remaining-work evidence. Resident
  shutdown and bounded wall expiry stop new claims and bound the current future;
  unfinished durable attempts remain recoverable through lane-owned leases and
  fences. This shared runtime behavior alone is not Cloudflare qualification.

- `ArtifactProcessingModule` owns one processing attempt from claimed job to ready version or failed terminal result. It hides archive reading, normalization, structured validation reporting, manifest generation, staging writes, concurrency limits, and commit ordering.
- `ArchiveModule` is an internal Module for safe archive traversal and normalization. It validates raw paths before filtering supported system metadata, removes at most one common wrapper directory, resolves a dynamic root HTML entry, and retains each immutable `sourcePath` beside its normalized `effectivePath`.
- `ManifestModule` is an internal Module for manifest creation. It records the resolved dynamic entry file and path-sorted assets with their effective paths, object keys, sizes, content types, and hashes.
- `ProcessingJobModule` owns claim, heartbeat, retry, completion, and failure transitions for processing jobs. Its external Interface is the durable job state shared with the Hono runtime.
- `ThumbnailRenderingModule` is current in `worker/src/thumbnail.rs`. It owns the non-blocking thumbnail attempt after Version commit, including the bounded Chromium child process, fixed `1440x810` capture, animation suppression, render timeout, `800x450` WebP encoding, private attempt-unique output for one Content bundle and renderer revision, and losing-attempt cleanup. It never changes Version readiness or Publication state.
- `ThumbnailJobModule` is current in the same focused Worker module. It owns independent claim, lease, heartbeat, bounded retry, completion, and terminal failure transitions for one Content bundle and renderer revision; each capture selects a live referencing Version, and thumbnail work does not extend or reopen a processing job.
- `ContentBundleModule` is current inside the Worker processing implementation. It owns same-User raw-input lookup, canonical bundle identity, creating-bundle Leases, uniqueness-conflict resolution, ownership-safe ready-bundle references, and losing-candidate cleanup behind the existing processing Interface. It does not expose fingerprints or create a second API-runtime commit path.

## Cross-runtime Interfaces

Status: current

- The Hono runtime and Rust worker do not import each other.
- They coordinate through PostgreSQL migration files, processing and thumbnail job states, upload session states including the structured validation report, object key layout, dynamic manifest entry paths, manifest JSON shape, version commit fields, and Version thumbnail metadata.
- Thumbnail rendering uses a non-public internal content route authorized by a short-lived, single-use grant scoped to one Version. The route serves only manifest-listed objects, and the Chromium process blocks every external network request.
- Changing any cross-runtime Interface requires tests that exercise both Adapters.

## Core Module Interfaces

Status: current for Artifact, Publication, Viewer, and Reconciliation behavior.

```typescript
type UserModule = {
  ensureUserAccount(input: EnsureUserAccountInput): Promise<CurrentUser>;
  resolveCurrentUser(input: ResolveCurrentUserInput): Promise<CurrentUser | null>;
  recordAuthEvent(input: RecordAuthEventInput): Promise<RecordedAuthEvent>;
};

type ArtifactIntakeService = {
  create(input: CreateArtifactInput): Promise<ArtifactAccepted>;
};

type ArtifactManagementService = {
  list(ownerUserId: string): Promise<ArtifactManagementState[]>;
  get(ownerUserId: string, artifactId: string): Promise<ArtifactManagementState>;
  listReadyVersions(ownerUserId: string, artifactId: string): Promise<ReadyVersionSummary[]>;
  rename(ownerUserId: string, artifactId: string, name: string): Promise<ArtifactManagementState>;
  setShareExpiration(ownerUserId: string, artifactId: string, expiresAt: string | null): Promise<ArtifactManagementState>;
  delete(ownerUserId: string, artifactId: string): Promise<void>;
};

type ArtifactRecoveryService = {
  retry(input: RetryUploadInput): Promise<ArtifactAccepted>;
  replace(input: ReplaceUploadInput): Promise<ArtifactAccepted>;
};

type PublicationViewerService = {
  preview(ownerUserId: string, versionId: string, path: string): Promise<ContentAsset>;
  exportVersion(ownerUserId: string, versionId: string, artifactId?: string): Promise<VersionExport>;
  publish(input: PublishInput): Promise<PublicationView>;
  unpublish(ownerUserId: string, artifactId: string, publicationId: string): Promise<void>;
  resolveViewer(shareSlug: string, path: string): Promise<ViewerResolution>;
};

type ReconciliationModule = {
  run(input: ReconciliationInput): Promise<ReconciliationReport>;
};
```

Interface rules:

- `UserModule.ensureUserAccount` ensures the authenticated request has a valid ShareSlices user account.
- `UserModule.resolveCurrentUser` returns ShareSlices current-user state, not Better Auth library internals.
- Intake, Retry, Replace file, and Publish are idempotent by user, operation, target resource, and caller key.
- Artifact intake commits database state only after the raw ZIP is durably written.
- Publish updates the current Publication only for a ready Version owned by the target Artifact.
- Delete locks the owned Artifact and active Upload rows while it checks state, persists object cleanup targets, and removes the database graph in one transaction. The application layer then removes recorded objects and clears the durable cleanup intent; an interrupted or failed cleanup remains safe to continue through the same explicit Delete request.
- Preview and Viewer serve only committed Version objects referenced by a manifest.
- Thumbnail reads require Artifact ownership and stream private immutable Version objects. Successful responses may use private immutable caching because a new Version receives a new URL.
- Capture grants are service credentials, not Preview Sessions. Each grant is short-lived, single-use, scoped to one Version, unavailable through public ingress, and unable to call management APIs.
- `ReconciliationModule.run` is bounded by work type, time window, and row limit.

## Rust worker Interfaces

Status: current

```rust
pub async fn process_attempt(
    storage: &dyn ObjectStorage,
    ready_versions: &dyn ReadyVersionStore,
    input: ProcessingAttemptInput,
) -> Result<AttemptCompletion, ProcessingError>;

pub trait JobStore {
    async fn claim_next(&self, worker_id: &str, lease: Duration) -> Result<Option<ClaimedJob>, JobStoreError>;
    async fn heartbeat(&self, job_id: &str, worker_id: &str, lease: Duration) -> Result<bool, JobStoreError>;
    async fn fail(&self, job_id: &str, worker_id: &str, failure: &JobFailure) -> Result<bool, JobStoreError>;
    async fn recover_expired_leases(&self, limit: i64) -> Result<u64, JobStoreError>;
}

pub trait ReadyVersionStore {
    async fn commit_ready_version(&self, commit: &ReadyVersionCommit) -> Result<CommitOutcome, JobStoreError>;
}

pub trait ObjectStorage {
    async fn read_raw_archive(&self, key: &str) -> Result<ObjectReader, ObjectStorageError>;
    async fn write_staging_object(&self, input: StagingWrite) -> Result<(), ObjectStorageError>;
    async fn promote_staging_object(&self, input: Promotion) -> Result<(), ObjectStorageError>;
    async fn remove_staging_prefix(&self, prefix: &str) -> Result<u64, ObjectStorageError>;
}

pub trait ThumbnailJobStore {
    async fn claim_next(&self, worker_id: &str, lease: Duration) -> Result<Option<ClaimedThumbnailJob>, JobStoreError>;
    async fn heartbeat(&self, job_id: &str, worker_id: &str, lease: Duration) -> Result<bool, JobStoreError>;
    async fn complete(&self, job_id: &str, worker_id: &str, thumbnail: &ThumbnailObject) -> Result<bool, JobStoreError>;
    async fn fail(&self, job_id: &str, worker_id: &str, failure: &ThumbnailFailure) -> Result<bool, JobStoreError>;
}
```

Interface rules:

- The Worker runtime claims at most one job per iteration and remains alive while idle.
- Each attempt uses a unique processing attempt ID and staging prefix.
- Successful completion atomically inserts a ready Version and its dynamic manifest entry before the Upload session is marked committed, and persists any normalization warnings with that session.
- Deterministic validation failures persist a bounded structured report; scalar failure fields remain for state transitions, operational search, and legacy or infrastructure failures.
- Archive extraction reads immutable `sourcePath` values, while staging, manifests, validation details, Preview, and Viewer routing use normalized `effectivePath` values.
- Crash recovery is handled by lease expiry and a later retry.
- A ready-Version commit enqueues one thumbnail job without delaying the ready transition. Thumbnail attempts allow at most three retries for classified transient failures; deterministic render failures become terminal.
- Chromium loads the internal entry route with a `1440x810` viewport, reduced motion, disabled animation and transition, and no external network. Capture waits for `load`, `document.fonts.ready`, and two animation frames within one 10-second deadline, then writes an `800x450` WebP. The management Web UI continues to use `1440x900` as its default design and screenshot viewport.

## Adapter test surfaces

Status: current for the 0.0.1 Artifact flow; future User and Administration surfaces remain target.

- Test `UserModule` through `ensureUserAccount`, `resolveCurrentUser`, and `recordAuthEvent`; use fake authenticated requests and fake auth sessions.
- Test Artifact services through create, list, get, rename, Retry, Replace file, Publish, Unpublish, Share-link management, and Delete; assert idempotency, state transitions, `owner_user_id` checks, object cleanup targets, and Publication pointer behavior.
- Test `PublicationViewerService` through Preview and Viewer resolution; assert Share-slug lifecycle resolution, committed-only reads, path rejection, and headers.
- Test Worker processing through `process_attempt`; assert validation failure, staged writes, manifest output, concurrency limits, ready Version commit, and retry after lease expiry.
- Test `ReconciliationModule` through `run`; assert non-destructive repair ordering and retry-safe reports.
- Add cross-runtime tests for migration compatibility, processing job lifecycle, object key layout, manifest schema, and upload-to-ready integration.
