# Module Architecture

Target module architecture for ShareSlices. This document is **evolving design, not current state**: each section carries a status marker, and each OpenSpec change declares in its `design.md` which subset it realizes.

- `Status: target` — designed, not yet built. Interfaces here are directional; the implementing change may adjust them, then updates this file.
- `Status: current` — built. Code is the source of truth; this file records the shape and the reasoning.

Engineering rules that constrain all designs live in `AGENTS.md`. Product behavior lives in `PRODUCT.md` and `openspec/specs/`.

## Top-level seams

Status: target

| Seam | Interface owner | Production Adapter | Test Adapter |
| --- | --- | --- | --- |
| User, artifact, and CLI requests into API | `api/src/http/` | Hono route handlers | HTTP contract tests |
| Hono HTTP into business behavior | `api/src/application/` | Hono handler mapping | Direct Module tests |
| Authenticated request into user account | `api/src/application/user/` | Better Auth Adapter | Fake auth Adapter |
| Application data persistence | `api/src/application/*` | Drizzle Adapter | Local PostgreSQL or in-memory Adapter |
| Raw and processed object access | Application and worker Modules | S3-compatible Adapter | In-memory object Adapter |
| Processing job handoff | `db/migrations/` schema plus job Interfaces | Drizzle enqueue Adapter and sqlx claim Adapter | Local PostgreSQL or in-memory Adapter |
| Agent entry | `cli/` command Interface | Skill shell Adapter | CLI fixture Adapter |

## Hono runtime Modules

Status: target. The `account-entry` change deliberately starts without an application layer (`api/src/http/ + auth/ + db/`); a responsibility is extracted into one of these Modules when it gains a second caller or a second implementation (rule in `AGENTS.md`).

- `UserModule` owns ShareSlices user account resolution, current-user state, account status gates, and auth event recording. Better Auth is the library used for credential, provider, password reset, email verification, and session cookie mechanics.
- `ArtifactModule` owns artifact target resolution, upload session creation, raw upload acceptance, upload result reading, owner cleanup, and publish decisions. It hides idempotency, publication pointer transitions, version eligibility checks, and `owner_user_id` checks.
- `ViewerModule` owns public artifact slug resolution and committed asset lookup. It hides publication pointer reads, manifest cache behavior, path validation, and object streaming decisions.
- `ReconciliationModule` owns stale challenge cleanup, expired upload sessions, expired processing leases, abandoned staging objects, and dirty-state repair. It hides scan windows, retry eligibility, and non-destructive repair ordering.
- `AdministrationModule` is a roadmap Module for user search, deactivation, reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit. It stays separate because the actor and permissions differ from user-managed flows.

## Rust worker Modules

Status: target

- `ArtifactProcessingModule` owns one processing attempt from claimed job to ready version or failed terminal result. It hides archive reading, path validation, entry file validation, manifest generation, staging writes, concurrency limits, and commit ordering.
- `ArchiveModule` is an internal Module for archive traversal and normalized file entries. It keeps path traversal, unsupported file type, size, count, and entry-file validation local to the worker.
- `ManifestModule` is an internal Module for manifest creation. It produces stable metadata for viewer resolution: entry file, paths, object keys, sizes, content types, and hashes.
- `ProcessingJobModule` owns claim, heartbeat, retry, completion, and failure transitions for processing jobs. Its external Interface is the durable job state shared with the Hono runtime.

## Cross-runtime Interfaces

Status: target

- The Hono runtime and Rust worker do not import each other.
- They coordinate through PostgreSQL migration files, processing job states, upload session states, object key layout, manifest JSON shape, and version commit fields.
- Changing any cross-runtime Interface requires tests that exercise both Adapters.

## Core Module Interfaces

Status: target

```typescript
type UserModule = {
  ensureUserAccount(input: EnsureUserAccountInput): Promise<CurrentUser>;
  resolveCurrentUser(input: ResolveCurrentUserInput): Promise<CurrentUser | null>;
  recordAuthEvent(input: RecordAuthEventInput): Promise<RecordedAuthEvent>;
};

type ArtifactModule = {
  prepareUpload(input: PrepareUploadInput): Promise<PreparedUpload>;
  recordRawUpload(input: RecordRawUploadInput): Promise<UploadAccepted>;
  readUploadResult(input: ReadUploadResultInput): Promise<UploadResult>;
  publishVersion(input: PublishVersionInput): Promise<PublishedArtifact>;
  cleanupUserArtifactState(input: CleanupUserArtifactStateInput): Promise<ArtifactManagementState>;
};

type ViewerModule = {
  resolveArtifactPage(input: ResolveArtifactPageInput): Promise<ViewerPageResult>;
  resolveAsset(input: ResolveAssetInput): Promise<ViewerAssetResult>;
};

type ReconciliationModule = {
  run(input: ReconciliationInput): Promise<ReconciliationReport>;
};
```

Interface rules:

- `UserModule.ensureUserAccount` ensures the authenticated request has a valid ShareSlices user account.
- `UserModule.resolveCurrentUser` returns ShareSlices current-user state, not Better Auth library internals.
- `ArtifactModule.prepareUpload` is idempotent by user, command type, target artifact, and idempotency key.
- `ArtifactModule.recordRawUpload` is called only after the raw object key is durably written or recovered.
- `ArtifactModule.publishVersion` updates the publication pointer only for ready versions owned by the target artifact.
- `ViewerModule.resolveAsset` serves only committed version objects referenced by a manifest.
- `ReconciliationModule.run` is bounded by work type, time window, and row limit.

## Rust worker Interfaces

Status: target

```rust
pub trait ArtifactProcessingWorker {
    async fn process_one(&self, input: ProcessOneInput) -> ProcessOneResult;
}

pub trait ProcessingJobStore {
    async fn claim_next(&self, worker_id: WorkerId) -> ClaimResult;
    async fn heartbeat(&self, lease: ProcessingLease) -> HeartbeatResult;
    async fn complete(&self, result: ReadyVersionCommit) -> CommitResult;
    async fn fail(&self, result: ProcessingFailure) -> FailureResult;
}

pub trait WorkerObjectStore {
    async fn read_raw_archive(&self, key: RawObjectKey) -> RawArchiveReader;
    async fn write_staging_file(&self, file: StagingFileWrite) -> StoredFile;
    async fn write_manifest(&self, manifest: ManifestWrite) -> StoredManifest;
    async fn remove_staging_prefix(&self, prefix: StagingPrefix) -> RemovalResult;
}
```

Interface rules:

- `ArtifactProcessingWorker.process_one` claims at most one job or returns `NoWork`.
- Each attempt uses a unique processing attempt ID and staging prefix.
- Successful completion inserts a ready version before the upload session is marked committed.
- Failed validation returns a user-actionable failure summary.
- Crash recovery is handled by lease expiry and a later retry.

## Adapter test surfaces

Status: target

- Test `UserModule` through `ensureUserAccount`, `resolveCurrentUser`, and `recordAuthEvent`; use fake authenticated requests and fake auth sessions.
- Test `ArtifactModule` through `prepareUpload`, `recordRawUpload`, `readUploadResult`, `publishVersion`, and `cleanupUserArtifactState`; assert idempotency, state transitions, `owner_user_id` checks, and publication pointer behavior.
- Test `ViewerModule` through `resolveArtifactPage` and `resolveAsset`; assert slug resolution, committed-only reads, path rejection, and headers.
- Test `ArtifactProcessingModule` through `process_one`; assert validation failure, staged writes, manifest output, concurrency limits, ready version commit, and retry after lease expiry.
- Test `ReconciliationModule` through `run`; assert non-destructive repair ordering and retry-safe reports.
- Add cross-runtime tests for migration compatibility, processing job lifecycle, object key layout, manifest schema, and upload-to-ready integration.
