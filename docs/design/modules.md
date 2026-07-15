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
| Agent intent into CLI | target | `skill/shareslices/` invocation contract | Official ShareSlices Skill | Skill-to-CLI contract fixtures |
| CLI commands into ShareSlices | current for authentication, Artifact listing, Upload, Publish, Unpublish, Share-link management, and Delete | `cli/` command Interface | Rust CLI with operating-system credential store | In-memory credential and fake HTTP Adapters |

## Official Skill entry

Status: target

- The official Skill is an intent Adapter, not a second ShareSlices client or a copy of the CLI manual. Each non-interactive CLI invocation executes one explicit operation; the Skill may compose separate capability discovery, authentication, state-inspection, and business invocations into the authorized workflow, consumes each structured outcome, and summarizes the durable result.
- Intent routing preserves the user's requested operation. A request to Publish local content uses the high-level Publish command; a request to Upload without external access remains Upload; explicit management requests use the corresponding resource command. The Skill never upgrades Upload into Publish merely because the user did not request an intermediate review.
- The Skill owns workspace context: it identifies the user-authorized local inputs and relevant built output. When uncertainty would materially change the selected content, Artifact target, Entry file, publication intent, or irreversible action, it asks the user before invoking the CLI.
- The CLI owns package mechanics and execution policy after input selection: deterministic root and Entry-file handling, packaging, validation, authentication, transfer, retries, lifecycle defaults, Server calls, and result rendering. The Server remains the source of truth for account, authorization, Artifact, Version, Publication, and validation state.
- The Skill calls only the installed `shareslices` CLI and does not duplicate command flags, selectable output fields, lifecycle rules, REST calls, or Server validation. Exact command syntax and fields come from the installed CLI contract.
- The installed CLI exposes an explicit global Agent mode for the official Skill. Agent mode disables stdin prompts, suppresses transient progress, and emits exactly one versioned JSON outcome envelope per process invocation. Existing human-readable output and field-selected JSON remain separate compatibility surfaces.
- A local `shareslices --agent capabilities` probe requires no credential or network access and advertises supported integer Agent protocol versions, operations, and the bounded processing-wait budget independently of CLI semantic version. The Skill explicitly selects a mutually supported version on every operational Agent invocation and fails closed when no supported version or operation exists; it does not parse human output or selected-field JSON as a fallback.
- The Agent-mode envelope identifies the operation and outcome, preserves every known durable resource, carries command-specific data, and optionally carries a structured error and next action. Outcomes distinguish completed, in-progress, partial, action-required, failed, indeterminate, and cancelled work; process exit codes remain an additional coarse signal rather than the source of outcome semantics.
- A browser authorization that needs user approval is a resumable two-stage operation. The first invocation returns the verification instructions and a non-sensitive continuation identifier, while sensitive authorization state remains under CLI control. A later invocation completes or checks that continuation before the Skill issues a new invocation for the still-authorized original operation. Authentication is the only resumable Agent operation in protocol version 1; the continuation stores no business command, local path, content, or irreversible confirmation.
- The Server supplies authoritative error codes, request identifiers, field errors, limits, validation reports, recoverability, allowed actions, retry timing, and resource state. The CLI preserves those facts and maps them into command-aware next actions; the Skill combines them only with user intent and local workspace evidence.
- Next actions distinguish authorization, material ambiguity, irreversible confirmation, installation or upgrade, local-input changes, state inspection, delayed retry, and support escalation. The Skill tells the user the exact required action and resumes the original operation when the action completes.
- The surrounding agent may inspect, build, and make a deterministic local repair when that work is already authorized by the original artifact-creation task and does not materially change the user's intended content. The Skill itself does not edit Artifact content. Material content changes, multiple plausible inputs or targets, secrets risk, and irreversible operations require user direction; read-only state inspection and contract-declared safe retries do not.
- The revised Skill activates only after Agent mode covers every command it advertises. Skill-to-CLI contract fixtures and versioned behavioral and trigger eval definitions guard intent routing, destructive boundaries, compatibility handling, and evidence-based reporting; generated evaluation output is not a durable repository artifact.
- The implementing change defines the concrete result, error, continuation, and next-action schemas and may update CLI or Server Interfaces when the current boundary cannot provide the required evidence.

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
- `api/src/http/publication-viewer-routes.ts` is the Viewer HTTP Adapter. For an active Publication entry request it serves a fixed trusted player that owns the Viewer full-screen controls and embeds the resolved Artifact entry through the reserved content-mode request; status pages remain plain responses, and the application Module still owns every Publication and asset-resolution decision.
- `ReconciliationModule` is current. It owns bounded expired-lease recovery, raw/staging object cleanup while preserving the current retryable input, completion of durable Artifact-deletion cleanup intents after interrupted requests, stale creating-bundle recovery, and unreferenced-bundle cleanup defined by [Content bundle reuse](content-bundle-reuse.md).
- Version thumbnail reads and internal capture routing are current thin HTTP paths over `ArtifactThumbnailRepository`. The repository owns Owner-scoped immutable thumbnail lookup through a Version's pinned Content bundle and renderer revision, one-time capture-grant consumption, capture-session validation, and manifest asset lookup; a separate application Module remains deferred until a second caller or Adapter appears.
- `UserModule` remains target. Current account entry intentionally stays in `api/src/http/account-routes.ts`, Better Auth, and focused account queries until another caller or implementation requires extraction.
- `AdministrationModule` is a roadmap Module for user search, deactivation, reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit. It stays separate because the actor and permissions differ from user-managed flows.
- `AuthenticationEmailDelivery` is current. Account routes persist encrypted delivery payloads and return without contacting SMTP; the API-runtime dispatcher leases pending rows, renders fixed authentication templates, sends through `api/src/email/`, records bounded retry outcomes, and removes terminal payloads. SMTP outages do not affect API readiness.

## Web Artifact player

Status: current

- `web/src/components/ArtifactPlayer.tsx` is the reusable owner player for the ordinary Preview page and Card full-screen mode. It owns the content iframe, accessible enter and exit controls, Fullscreen API event synchronization, and local failure feedback; it does not own Artifact, Version, or Publication policy.
- The `/artifacts/{artifactId}/preview` route renders the player outside the management shell. `ArtifactsPage` keeps Card eligibility and management-state preservation local, while `ArtifactPage` and Card thumbnail navigation open the same trusted Preview route.

## Rust worker Modules

Status: current for Upload processing, Content bundle reuse, and bundle-scoped thumbnails.

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
