# Module Architecture

Target module architecture for ShareSlices. This document is **evolving design, not current state**: each section carries a status marker, and each OpenSpec change declares in its `design.md` which subset it realizes.

- `Status: target` — designed, not yet built. Interfaces here are directional; the implementing change may adjust them, then updates this file.
- `Status: current` — built. Code is the source of truth; this file records the shape and the reasoning.

Engineering rules that constrain all designs live in `AGENTS.md`. Product behavior lives in `PRODUCT.md` and `openspec/specs/`.

## Top-level seams

Status: current for the 0.0.1 runtime seams, CLI authentication, Artifact listing, Upload, thumbnail generation and reads, Publish, Unpublish, Share-link management, and Delete; Skill entry remains target.

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
| Agent entry | current for authentication, Artifact listing, Upload, Publish, Unpublish, Share-link management, and Delete | `cli/` command Interface | Rust CLI with operating-system credential store | In-memory credential and fake HTTP Adapters |

## CLI authentication Modules

Status: current

- `cli/src/auth_commands.rs` owns the `auth login`, `auth status`, and `auth logout` command behavior behind `AuthApi` and `CredentialStore` Interfaces; `cli/src/lib.rs` is the public facade. The production Adapters use the checked HTTP API and the operating-system credential store; tests use fake HTTP and in-memory credentials.
- `api/src/http/cli-auth-routes.ts` is the product-owned HTTP Adapter over Better Auth Device Authorization and Bearer Sessions. It validates the fixed CLI client and transient version/operating-system compatibility metadata without persisting device identity.
- `web/src/screens/DeviceAuthorizationPage.tsx` owns the Cookie-authenticated `/device?user_code=...` approval flow. It preserves the verification code through login, exposes no account switch, and replaces approval with the terminal-return success state.
- JSON management routes accept Cookie or Bearer Sessions through the existing `getSession` seam. Preview content remains Cookie-only and Viewer content remains public according to Publication state.

## CLI Artifact Modules

Status: current for Artifact listing, Upload, Publish, Unpublish, Share-link management, ready-Version Export, and Delete; other management commands remain target.

- `cli/src/artifact_commands.rs` owns bounded Artifact list presentation, selectable JSON formatting, shared interactive Artifact and ready-Version selection, Upload orchestration through ready Version commit, atomic Publish and Unpublish commands, Share-link management, atomic local Export, and confirmed permanent Delete. `cli/src/packaging.rs` expands selected local inputs, applies the active Server policy, and deterministically streams safe effective paths into a temporary ZIP; a single prepared ZIP bypasses repackaging. `ApiClient` follows opaque Server pages, transfers ZIP input with safe idempotent retries, downloads normalized Version ZIPs, never retries an indeterminate Delete, and supplies transient CLI compatibility metadata; production credentials still come only from the operating-system credential store.
- `ArtifactManagementService` owns list filtering, opaque pagination, and the owner-scoped ready-Version collection used by interactive CLI selection. Hono routes validate DTOs and map application errors without deriving Artifact state or Publication behavior.

## Hono runtime Modules

Status: mixed. Account entry remains a thin current HTTP/Auth/DB path. Artifact, Viewer, and Reconciliation behavior is current; Administration remains target.

- `ArtifactIntakeService`, `ArtifactManagementService`, and `ArtifactRecoveryService` are the current Artifact application modules. Together they own raw upload acceptance, Artifact state projection, name changes, permanent deletion, Share-link expiration, Retry, Replace file, idempotency, and ready-Version gates.
- `PublicationViewerService` is the current Publication and Viewer application module. It owns owner Preview and Version export checks, atomic Publish and Unpublish behavior, Share-slug lifecycle resolution, normalized manifest lookup, and immutable Version selection for each request.
- `ReconciliationModule` is current. It owns bounded expired-lease recovery, raw/staging object cleanup while preserving the current retryable input, and completion of durable Artifact-deletion cleanup intents after interrupted requests. Content bundle candidate and unreferenced-bundle cleanup are target responsibilities defined by [Content bundle reuse](content-bundle-reuse.md).
- Version thumbnail reads and internal capture routing are current thin HTTP paths over `ArtifactThumbnailRepository`. The repository owns Owner-scoped immutable thumbnail lookup, one-time capture-grant consumption, capture-session validation, and manifest asset lookup. The target repository resolves a Version's pinned renderer revision through its Content bundle without changing the Version-shaped HTTP Interface; a separate application Module remains deferred until a second caller or Adapter appears.
- `UserModule` remains target. Current account entry intentionally stays in `api/src/http/account-routes.ts`, Better Auth, and focused account queries until another caller or implementation requires extraction.
- `AdministrationModule` is a roadmap Module for user search, deactivation, reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit. It stays separate because the actor and permissions differ from user-managed flows.
- `AuthenticationEmailDelivery` is current. Account routes persist encrypted delivery payloads and return without contacting SMTP; the API-runtime dispatcher leases pending rows, renders fixed authentication templates, sends through `api/src/email/`, records bounded retry outcomes, and removes terminal payloads. SMTP outages do not affect API readiness.

## Rust worker Modules

Status: current for Upload processing and Version-scoped thumbnails; [Content bundle reuse](content-bundle-reuse.md) is target.

- `ArtifactProcessingModule` owns one processing attempt from claimed job to ready version or failed terminal result. It hides archive reading, normalization, structured validation reporting, manifest generation, staging writes, concurrency limits, and commit ordering.
- `ArchiveModule` is an internal Module for safe archive traversal and normalization. It validates raw paths before filtering supported system metadata, removes at most one common wrapper directory, resolves a dynamic root HTML entry, and retains each immutable `sourcePath` beside its normalized `effectivePath`.
- `ManifestModule` is an internal Module for manifest creation. It records the resolved dynamic entry file and path-sorted assets with their effective paths, object keys, sizes, content types, and hashes.
- `ProcessingJobModule` owns claim, heartbeat, retry, completion, and failure transitions for processing jobs. Its external Interface is the durable job state shared with the Hono runtime.
- `ThumbnailRenderingModule` is current in `worker/src/thumbnail.rs`. It owns the non-blocking thumbnail attempt after Version commit, including the bounded Chromium child process, fixed `1440x900` capture, animation suppression, render timeout, WebP encoding, and private object writes. The target implementation writes attempt-unique output for one Content bundle and renderer revision. It never changes Version readiness or Publication state.
- `ThumbnailJobModule` is current in the same focused Worker module. It owns independent claim, lease, heartbeat, bounded retry, completion, and terminal failure transitions for thumbnail jobs; thumbnail work does not extend or reopen a processing job. The target job identity is one Content bundle and renderer revision, while each capture still selects a live referencing Version.
- `ContentBundleModule` is target inside the Worker processing implementation. It owns same-User raw-input lookup, canonical bundle identity, creating-bundle Leases, uniqueness-conflict resolution, ownership-safe ready-bundle references, and losing-candidate cleanup behind the existing processing Interface. It does not expose fingerprints or create a second API-runtime commit path.

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
- Chromium loads the internal entry route with a `1440x900` viewport, reduced motion, disabled animation and transition, and no external network. Capture waits for `load`, `document.fonts.ready`, and two animation frames within one 10-second deadline, then writes an approximately `480x300` WebP.

## Adapter test surfaces

Status: current for the 0.0.1 Artifact flow; future User and Administration surfaces remain target.

- Test `UserModule` through `ensureUserAccount`, `resolveCurrentUser`, and `recordAuthEvent`; use fake authenticated requests and fake auth sessions.
- Test Artifact services through create, list, get, rename, Retry, Replace file, Publish, Unpublish, Share-link management, and Delete; assert idempotency, state transitions, `owner_user_id` checks, object cleanup targets, and Publication pointer behavior.
- Test `PublicationViewerService` through Preview and Viewer resolution; assert Share-slug lifecycle resolution, committed-only reads, path rejection, and headers.
- Test Worker processing through `process_attempt`; assert validation failure, staged writes, manifest output, concurrency limits, ready Version commit, and retry after lease expiry.
- Test `ReconciliationModule` through `run`; assert non-destructive repair ordering and retry-safe reports.
- Add cross-runtime tests for migration compatibility, processing job lifecycle, object key layout, manifest schema, and upload-to-ready integration.
