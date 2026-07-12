# Module Architecture

Target module architecture for ShareSlices. This document is **evolving design, not current state**: each section carries a status marker, and each OpenSpec change declares in its `design.md` which subset it realizes.

- `Status: target` — designed, not yet built. Interfaces here are directional; the implementing change may adjust them, then updates this file.
- `Status: current` — built. Code is the source of truth; this file records the shape and the reasoning.

Engineering rules that constrain all designs live in `AGENTS.md`. Product behavior lives in `PRODUCT.md` and `openspec/specs/`.

## Top-level seams

Status: current for the 0.0.1 runtime seams, CLI authentication, Artifact listing, and local-input or prepared-ZIP Upload; Skill entry remains target.

| Seam | Status | Interface owner | Production Adapter | Test Adapter |
| --- | --- | --- | --- | --- |
| User and Artifact requests into API | current | `api/src/http/` | Hono route handlers | HTTP and YAML/Python contract tests |
| Hono HTTP into business behavior | current | `api/src/application/` | Hono handler mapping | Direct Module tests |
| Authenticated request into user account | current | `api/src/http/` | Better Auth Cookie, Device Authorization, and Bearer Adapters | Fake auth Adapter plus YAML/Python contracts |
| Authentication email delivery | current | `api/src/application/accounts/` | Durable PostgreSQL queue and Nodemailer SMTP Adapter | In-process SMTP server and Mailpit YAML/Python flow |
| Application data persistence | current | `api/src/application/*` | Drizzle Adapter | Local PostgreSQL or in-memory Adapter |
| Raw and processed object access | current | Application and worker Modules | S3-compatible Adapter | In-memory object Adapter |
| Processing job handoff | current | `db/migrations/` schema plus job Interfaces | Drizzle enqueue Adapter and SQLx claim Adapter | Local PostgreSQL and fake Adapters |
| Agent entry | current for authentication, Artifact listing, and local-input or prepared-ZIP Upload | `cli/` command Interface | Rust CLI with operating-system credential store | In-memory credential and fake HTTP Adapters |

## CLI authentication Modules

Status: current

- `cli/src/auth_commands.rs` owns the `auth login`, `auth status`, and `auth logout` command behavior behind `AuthApi` and `CredentialStore` Interfaces; `cli/src/lib.rs` is the public facade. The production Adapters use the checked HTTP API and the operating-system credential store; tests use fake HTTP and in-memory credentials.
- `api/src/http/cli-auth-routes.ts` is the product-owned HTTP Adapter over Better Auth Device Authorization and Bearer Sessions. It validates the fixed CLI client and transient version/operating-system compatibility metadata without persisting device identity.
- `web/src/screens/DeviceAuthorizationPage.tsx` owns the Cookie-authenticated `/device?user_code=...` approval flow. It preserves the verification code through login, exposes no account switch, and replaces approval with the terminal-return success state.
- JSON management routes accept Cookie or Bearer Sessions through the existing `getSession` seam. Preview content remains Cookie-only and Viewer content remains public according to Publication state.

## CLI Artifact Modules

Status: current for Artifact listing and local-input or prepared-ZIP Upload to new or existing Artifacts; other management commands remain target.

- `cli/src/artifact_commands.rs` owns bounded Artifact list presentation, selectable JSON formatting, the shared interactive selector, explicit new-Artifact versus existing-Artifact targeting, and Upload orchestration through ready Version commit. `cli/src/packaging.rs` expands selected local inputs, applies the active Server policy, and deterministically streams safe effective paths into a temporary ZIP; a single prepared ZIP bypasses repackaging. `ApiClient` follows opaque Server pages, transfers ZIP input with safe idempotent retries to either the Artifact collection or an existing Artifact's Upload-session collection, and supplies transient CLI compatibility metadata; production credentials still come only from the operating-system credential store.
- `ArtifactManagementService` owns list filtering and opaque pagination semantics. The Hono route validates query DTOs and maps application errors without deriving Artifact state or page behavior.

## Hono runtime Modules

Status: mixed. Account entry remains a thin current HTTP/Auth/DB path. Artifact, Viewer, and Reconciliation behavior is current; Administration remains target.

- `ArtifactIntakeService`, `ArtifactManagementService`, and `ArtifactRecoveryService` are the current Artifact application modules. Together they own raw upload acceptance, Artifact state projection, name changes, permanent deletion, Share-link expiration, retained-input Retry, failed-input replacement, new immutable Version Upload sessions, idempotency, and ready-Version gates. A Version Upload does not mutate the Artifact name, Share link, Publication, or prior ready Versions.
- `PublicationViewerService` is the current Publication and Viewer application module. It owns owner Preview and Version export checks, atomic Publish and Unpublish behavior, Share-slug lifecycle resolution, normalized manifest lookup, and immutable Version selection for each request.
- `ReconciliationModule` is current. It owns bounded expired-lease recovery and raw/staging object cleanup while preserving the current retryable input.
- `UserModule` remains target. Current account entry intentionally stays in `api/src/http/account-routes.ts`, Better Auth, and focused account queries until another caller or implementation requires extraction.
- `AdministrationModule` is a roadmap Module for user search, deactivation, reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit. It stays separate because the actor and permissions differ from user-managed flows.
- `AuthenticationEmailDelivery` is current. Account routes persist encrypted delivery payloads and return without contacting SMTP; the API-runtime dispatcher leases pending rows, renders fixed authentication templates, sends through `api/src/email/`, records bounded retry outcomes, and removes terminal payloads. SMTP outages do not affect API readiness.

## Rust worker Modules

Status: current

- `ArtifactProcessingModule` owns one processing attempt from claimed job to ready version or failed terminal result. It hides archive reading, normalization, structured validation reporting, manifest generation, staging writes, concurrency limits, and commit ordering.
- `ArchiveModule` is an internal Module for safe archive traversal and normalization. It validates raw paths before filtering supported system metadata, removes at most one common wrapper directory, resolves a dynamic root HTML entry, and retains each immutable `sourcePath` beside its normalized `effectivePath`.
- `ManifestModule` is an internal Module for manifest creation. It records the resolved dynamic entry file and path-sorted assets with their effective paths, object keys, sizes, content types, and hashes.
- `ProcessingJobModule` owns claim, heartbeat, retry, completion, and failure transitions for processing jobs. Its external Interface is the durable job state shared with the Hono runtime.

## Cross-runtime Interfaces

Status: current

- The Hono runtime and Rust worker do not import each other.
- They coordinate through PostgreSQL migration files, processing job states, upload session states including the structured validation report, object key layout, dynamic manifest entry paths, manifest JSON shape, and version commit fields.
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
  exportVersion(ownerUserId: string, versionId: string): Promise<VersionExport>;
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
- Preview and Viewer serve only committed Version objects referenced by a manifest.
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
```

Interface rules:

- The Worker runtime claims at most one job per iteration and remains alive while idle.
- Each attempt uses a unique processing attempt ID and staging prefix.
- Successful completion atomically inserts a ready Version and its dynamic manifest entry before the Upload session is marked committed, and persists any normalization warnings with that session.
- Deterministic validation failures persist a bounded structured report; scalar failure fields remain for state transitions, operational search, and legacy or infrastructure failures.
- Archive extraction reads immutable `sourcePath` values, while staging, manifests, validation details, Preview, and Viewer routing use normalized `effectivePath` values.
- Crash recovery is handled by lease expiry and a later retry.

## Adapter test surfaces

Status: current for the 0.0.1 Artifact flow; future User and Administration surfaces remain target.

- Test `UserModule` through `ensureUserAccount`, `resolveCurrentUser`, and `recordAuthEvent`; use fake authenticated requests and fake auth sessions.
- Test Artifact services through create, list, get, rename, Retry, Replace file, Publish, and Unpublish; assert idempotency, state transitions, `owner_user_id` checks, and Publication pointer behavior.
- Test `PublicationViewerService` through Preview and Viewer resolution; assert Share-slug lifecycle resolution, committed-only reads, path rejection, and headers.
- Test Worker processing through `process_attempt`; assert validation failure, staged writes, manifest output, concurrency limits, ready Version commit, and retry after lease expiry.
- Test `ReconciliationModule` through `run`; assert non-destructive repair ordering and retry-safe reports.
- Add cross-runtime tests for migration compatibility, processing job lifecycle, object key layout, manifest schema, and upload-to-ready integration.
