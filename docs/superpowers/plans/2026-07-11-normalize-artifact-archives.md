<!-- cspell:ignore AAUAAA hcnk nocapture retryability serde Serde viewports -->

# Normalize Artifact Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept deterministic macOS and single-entry HTML ZIP variants safely, while returning precise structured validation information through Web and API surfaces.

**Architecture:** The Rust Worker derives an effective archive from immutable raw ZIP source paths, produces a bounded validation report, and remains the authoritative validator. PostgreSQL stores that report on the Upload session; the Hono API projects it through checked OpenAPI contracts; Web uses `fflate` in a Web Worker for early policy-aligned preflight but always accepts server authority.

**Tech Stack:** Rust 1.96, `zip`, Serde, SQLx, PostgreSQL 17, TypeScript, Hono, Drizzle, React 19, Vite 7, `fflate`, Vitest, Playwright, YAML contract cases with the existing Python runner.

## Global Constraints

- Ignore only top-level `__MACOSX/**`, files whose basename begins `._`, and files whose basename is `.DS_Store`.
- Validate path safety before classifying an entry as ignored metadata.
- Raw metadata bytes still count toward the 50 MiB default archive limit; ignored entries do not count toward effective expanded-size, file-count, or single-file limits.
- Remove at most one common wrapper directory, and only when every effective file is below it and the effective paths remain non-empty and unique.
- Prefer root `index.html`; otherwise accept exactly one root `.html`; reject zero or multiple root HTML candidates.
- Never rewrite user HTML or create a synthetic `index.html`.
- Preserve raw `sourcePath` for ZIP reads and use normalized `effectivePath` for storage, manifests, validation details, Preview, and Viewer routing.
- Return at most 20 blocking issues and at most 20 sampled paths per warning category.
- Preserve the public synchronous code `archive_too_large`; do not expose raw exceptions, stack traces, object keys, credentials, or Share slugs.
- Web supports desktop viewports only; visually verify at 1440×900 and use existing shadcn Base UI components.
- Every API behavior added here must have YAML cases executed by the existing Python contract runner.

---

### Task 1: Freeze the report contract and database shape

**Files:**

- Create: `db/migrations/0003_artifact_validation_report.sql`
- Modify: `api/src/db/schema.ts`
- Modify: `api/src/db/artifact-repositories.ts`
- Modify: `api/src/application/artifacts/repositories.ts`
- Modify: `api/openapi/openapi.yaml`
- Test: `api/tests/database-foundation.test.ts`
- Test: `api/tests/test_openapi_contract.py`
- Test: `api/tests/publication-content-repository.test.ts`

**Interfaces:**

- Produces: `ValidationNotice`, `ValidationReport`, nullable `artifact_upload_session.validation_report`, and a manifest entry constraint that accepts any committed safe Artifact path.
- Preserves: existing scalar `failure_reason_code`, `failure_summary`, and `retryable` fields for state transitions, operational search, and legacy fallback.

- [ ] **Step 1: Add failing schema assertions**

Extend `api/tests/database-foundation.test.ts` to assert the new column and JSON-object constraint:

```ts
expect(columns).toContainEqual(expect.objectContaining({
  table_name: "artifact_upload_session",
  column_name: "validation_report",
  data_type: "jsonb",
  is_nullable: "YES"
}));
expect(constraints).toContain("artifact_upload_session_validation_report_check");
expect(constraints).toContain("artifact_manifest_entry_path_check");
expect(constraints).toContain("artifact_manifest_entry_asset_fk");
```

Run: `pnpm --dir api test -- database-foundation.test.ts`

Expected: FAIL because `validation_report` does not exist.

- [ ] **Step 2: Add the migration and Drizzle field**

Create `db/migrations/0003_artifact_validation_report.sql`:

```sql
alter table artifact_upload_session
  add column validation_report jsonb;

alter table artifact_upload_session
  add constraint artifact_upload_session_validation_report_check
  check (validation_report is null or jsonb_typeof(validation_report) = 'object');

alter table artifact_manifest
  drop constraint artifact_manifest_entry_path_check;

alter table artifact_manifest
  add constraint artifact_manifest_entry_path_check
  check (entry_path <> '' and entry_path !~ '(^/|(^|/)\.\.(/|$))');

alter table artifact_manifest
  add constraint artifact_manifest_entry_asset_fk
  foreign key (version_id, entry_path)
  references artifact_asset(version_id, path)
  deferrable initially deferred;
```

Add these TypeScript contract types to `api/src/application/artifacts/repositories.ts`:

```ts
export type ValidationDetails = {
  path?: string;
  paths?: string[];
  candidates?: string[];
  extension?: string;
  validationKind?: string;
  actualBytes?: number;
  limitBytes?: number;
  actualCount?: number;
  limitCount?: number;
  ignoredCount?: number;
  directory?: string;
  entryFile?: string;
};

export type ValidationNotice = {
  code: string;
  message: string;
  action: string | null;
  details: ValidationDetails;
};

export type ValidationReport = {
  primaryIssue: ValidationNotice | null;
  issues: ValidationNotice[];
  warnings: ValidationNotice[];
};
```

Add `validationReport: jsonb("validation_report").$type<ValidationReport>()` to `artifactUploadSession`, expose `validationReport: ValidationReport | null` on `UploadSessionRecord`, and map the field in `uploadSessionRecord`. Reorder the Drizzle `artifactAsset` declaration before `artifactManifest`, replace the hardcoded entry check with the safe/non-empty path check, and declare `artifact_manifest_entry_asset_fk` over `(versionId, entryPath)` to `(artifactAsset.versionId, artifactAsset.path)`. The SQL constraint is initially deferred so the current Worker transaction remains valid until Task 3 reorders inserts; update autocommit API test fixtures to insert the entry asset before its manifest.

- [ ] **Step 3: Define checked OpenAPI schemas**

Add `ValidationDetails`, `ValidationNotice`, and `ValidationReport` schemas to `api/openapi/openapi.yaml`. Keep `ValidationDetails` closed and model all initial fields explicitly. Add nullable `validationReport` to the Artifact management schema and add optional `action` and `details` to the existing HTTP error item so synchronous `archive_too_large` can return:

```yaml
error:
  code: archive_too_large
  message: ZIP exceeds the upload limit.
  action: Reduce the ZIP below the upload limit and try again.
  details:
    limitBytes: 52428800
```

Do not require `actualBytes` for streaming rejection.

- [ ] **Step 4: Verify contract and migration tests**

Run:

```bash
pnpm --dir api test -- database-foundation.test.ts
uv run pytest api/tests/test_openapi_contract.py -v
pnpm run specs:check
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add db/migrations/0003_artifact_validation_report.sql api/src/db/schema.ts api/src/db/artifact-repositories.ts api/src/application/artifacts/repositories.ts api/openapi/openapi.yaml api/tests/database-foundation.test.ts api/tests/publication-content-repository.test.ts api/tests/test_openapi_contract.py
git commit -m "feat: define artifact validation reports"
```

---

### Task 2: Normalize archives and produce deterministic reports in Rust

**Files:**

- Create: `worker/src/validation_report.rs`
- Modify: `worker/src/lib.rs`
- Modify: `worker/src/archive_validation.rs`
- Modify: `worker/src/format_rules.rs`
- Modify: `worker/src/processing.rs`
- Modify: `worker/src/runtime.rs`
- Modify: `worker/src/validation_report.rs`
- Test: `worker/tests/archive_validation.rs`
- Test: `worker/tests/format_rules.rs`

**Interfaces:**

- Produces: `ValidationNotice`, `ValidationReport`, `ArchiveValidationFailure`, `ValidatedArchive::entry_path()`, `ValidatedArchive::warnings()`, and `ValidatedEntry::{source_path,effective_path}`.
- Consumes: `PolicySnapshot` and the existing bounded ZIP reader.

- [ ] **Step 1: Add red archive fixtures**

Add focused tests to `worker/tests/archive_validation.rs` for these exact cases:

```rust
#[test]
fn ignores_macos_metadata_and_infers_the_only_root_html() {
    let bytes = archive(&[
        ("腾讯文档盘点分析报告.html", b"<html></html>"),
        ("__MACOSX/._腾讯文档盘点分析报告.html", b"\0\x05binary metadata"),
        (".DS_Store", b"binary metadata"),
    ]);
    let result = validate_zip(Cursor::new(bytes), &PolicySnapshot::product_defaults())
        .expect("deterministic compatibility");
    assert_eq!(result.entry_path(), "腾讯文档盘点分析报告.html");
    assert_eq!(result.entries().len(), 1);
    assert_eq!(result.warnings()[0].code, "ignored_system_metadata");
    assert_eq!(result.warnings()[1].code, "entry_file_inferred");
}

#[test]
fn preserves_source_and_effective_paths_after_one_wrapper_is_removed() {
    let bytes = archive(&[
        ("report/report.html", b"<html></html>"),
        ("report/assets/app.js", b"document.body.dataset.ready='true'"),
    ]);
    let result = validate_zip(Cursor::new(bytes), &PolicySnapshot::product_defaults())
        .expect("wrapper normalization");
    assert_eq!(result.entry_path(), "report.html");
    assert_eq!(result.entries()[0].source_path(), "report/assets/app.js");
    assert_eq!(result.entries()[0].effective_path(), "assets/app.js");
}
```

Also add red tests for metadata-shaped traversal, metadata-only ZIP, missing root HTML with nested candidates, multiple root HTML files, duplicate effective paths, and all byte/count details.

Run: `cargo test --test archive_validation -- --nocapture`

Expected: FAIL because the current validator treats metadata as content and requires `index.html`.

- [ ] **Step 2: Add serializable report types**

Implement in `worker/src/validation_report.rs`:

```rust
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignored_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_file: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationNotice {
    pub code: String,
    pub message: String,
    pub action: Option<String>,
    pub details: ValidationDetails,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub primary_issue: Option<ValidationNotice>,
    pub issues: Vec<ValidationNotice>,
    pub warnings: Vec<ValidationNotice>,
}
```

Add constructors that cap additional issues and sampled paths at 20. Do not accept arbitrary caller-supplied user copy; centralize message/action copy by stable code. Add serialization tests for every notice code so the Rust JSON is accepted by the closed OpenAPI `ValidationDetails` shape.

Add a failure wrapper so callers keep the typed operational classification and the complete safe report:

```rust
#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("{error}")]
pub struct ArchiveValidationFailure {
    pub error: ArchiveError,
    pub report: ValidationReport,
}
```

- [ ] **Step 3: Refactor archive validation around effective entries**

Change `ValidatedEntry` to retain both paths:

```rust
pub struct ValidatedEntry {
    source_path: String,
    effective_path: String,
    size_bytes: u64,
    content_type: &'static str,
}
```

Change `ValidatedArchive` to contain:

```rust
pub struct ValidatedArchive {
    entry_path: String,
    entries: Vec<ValidatedEntry>,
    warnings: Vec<ValidationNotice>,
}
```

Keep `ArchiveError` as the typed reason enum, but let path/format/limit variants carry the values needed for reporting. Change `validate_zip` to return `Result<ValidatedArchive, ArchiveValidationFailure>`. Maintain two explicit duplicate sets: reject duplicate normalized raw paths before metadata classification, then reject duplicate effective paths after optional wrapper removal. Perform safe path, raw duplicate, and file-type checks first; only then skip known metadata before format validation. Calculate a single shared wrapper prefix, derive unique effective paths, resolve the entry, then validate effective files. Convert deterministic failures to a `ValidationReport` whose first issue contains the affected effective path and the relevant actual/limit fields.

Update `ProcessingError::Archive` to wrap `ArchiveValidationFailure`. Update runtime classification to inspect `failure.error` so the Worker compiles and retains its existing retry classification before Task 4 starts persisting `failure.report`.

- [ ] **Step 4: Keep resource limits bounded**

Ensure raw ZIP size is checked before archive allocation. Count metadata only in raw ZIP size. Stream content validation through the existing `BoundedReader`; never collect all expanded bytes. Sort accepted entries by `effectivePath` before returning `ValidatedArchive` so report ordering, tests, staging, and manifests are deterministic. Bound candidate lists and metadata path samples before inserting into `details`.

- [ ] **Step 5: Run the Worker validation suite**

Run:

```bash
cargo test --test archive_validation --test format_rules
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

Expected: all tests PASS and Clippy emits no warnings.

- [ ] **Step 6: Commit normalization**

```bash
git add worker/src/validation_report.rs worker/src/lib.rs worker/src/archive_validation.rs worker/src/format_rules.rs worker/src/processing.rs worker/src/runtime.rs worker/tests/archive_validation.rs worker/tests/format_rules.rs
git commit -m "feat: normalize uploaded artifact archives"
```

---

### Task 3: Carry effective paths into manifests and Viewer resolution

**Files:**

- Modify: `worker/src/manifest.rs`
- Modify: `worker/src/processing.rs`
- Modify: `worker/src/job_store.rs`
- Modify: `api/src/db/publication-content-repository.ts`
- Modify: `api/src/application/artifacts/publication-viewer.ts`
- Modify: `api/src/http/publication-viewer-routes.ts`
- Test: `worker/tests/manifest.rs`
- Test: `worker/tests/processing.rs`
- Test: `worker/tests/job_store.rs`
- Test: `api/tests/publication-content-repository.test.ts`
- Test: `api/tests/publication-viewer.test.ts`
- Test: `api/tests/publication-viewer-routes.test.ts`

**Interfaces:**

- Consumes: `ValidatedArchive::entry_path()` and `ValidatedEntry::{source_path,effective_path}` from Task 2.
- Produces: manifests whose dynamic `entry_path` is used by authenticated Preview and public Viewer root routes.

- [ ] **Step 1: Add failing named-entry and wrapper tests**

Add a Worker processing test that processes:

```text
report/腾讯文档盘点分析报告.html
report/assets/app.js
report/__MACOSX/._腾讯文档盘点分析报告.html
```

Assert:

```rust
assert_eq!(completion.manifest.entry_path, "腾讯文档盘点分析报告.html");
assert_eq!(completion.manifest.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
           ["assets/app.js", "腾讯文档盘点分析报告.html"]);
assert_eq!(storage.committed_object_for_test(
    "versions/by-upload/upload-1/腾讯文档盘点分析报告.html"
).await.unwrap(), b"<html></html>");
```

Run: `cargo test --test processing named_entry -- --nocapture`

Expected: FAIL at the processing seam because extraction still looks up the effective path in the immutable ZIP and `ReadyManifest::new` still hardcodes `index.html`; Task 1 has already removed the unrelated database constraint so it cannot mask this red signal.

- [ ] **Step 2: Make manifest entry explicit**

Change the constructor to:

```rust
pub fn new(entry_path: String, mut files: Vec<ManifestAsset>) -> Self {
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Self { entry_path, files }
}
```

Update all test fixtures and call sites to pass an explicit entry path. In `insert_manifest`, validate that `entry_path` appears exactly once in `manifest.files`, insert assets before the manifest row, and rely on `artifact_manifest_entry_asset_fk` as the database backstop. Add a rollback test for a manifest whose entry path is absent from its assets.

- [ ] **Step 3: Separate extraction and storage paths**

Update `stage_entry` so ZIP extraction uses `entry.source_path()` while staging keys, committed keys, `ManifestAsset.path`, and error details use `entry.effective_path()`. Pass `validated.entry_path()` into the manifest. Add `validation_report: ValidationReport` to `ReadyVersionCommit` and populate it with the successful normalization warnings; Task 4 will persist that already-carried field atomically.

- [ ] **Step 4: Resolve dynamic root entries**

Update `PublicationContentRepository` with `findEntryAsset(versionId)` that joins `artifact_manifest.entry_path` to `artifact_asset.path`. Extend the application interface and service with explicit root-entry resolution. Update both authenticated Preview and public Viewer HTTP routes so an empty/root request calls `findEntryAsset`; explicit asset paths still call `findAsset(versionId, path)`. Remove every HTTP-layer fallback that substitutes `index.html`.

Add API repository assertions that a manifest entry of `腾讯文档盘点分析报告.html` resolves at the root while `/assets/app.js` resolves by its effective path.

- [ ] **Step 5: Verify processing and content resolution**

Run:

```bash
cargo test --test manifest --test processing --test job_store
pnpm --dir api test -- publication-content-repository.test.ts publication-viewer.test.ts publication-viewer-routes.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit manifest routing**

```bash
git add worker/src/manifest.rs worker/src/processing.rs worker/src/job_store.rs worker/tests/manifest.rs worker/tests/processing.rs worker/tests/job_store.rs api/src/db/publication-content-repository.ts api/src/application/artifacts/publication-viewer.ts api/src/http/publication-viewer-routes.ts api/tests/publication-content-repository.test.ts api/tests/publication-viewer.test.ts api/tests/publication-viewer-routes.test.ts
git commit -m "feat: serve inferred artifact entries"
```

---

### Task 4: Persist validation failures and successful warnings

**Files:**

- Modify: `worker/src/job_store.rs`
- Modify: `worker/src/retry_policy.rs`
- Modify: `worker/src/runtime.rs`
- Modify: `api/src/db/artifact-repositories.ts`
- Test: `worker/tests/job_store.rs`
- Test: `worker/tests/retry_policy.rs`
- Test: `worker/tests/archive_validation.rs`
- Test: `api/tests/artifact-repositories.test.ts`

**Interfaces:**

- Consumes: Worker `ValidationReport` from Task 2 and database column from Task 1.
- Produces: current `UploadSessionRecord.validationReport` for management projection.

- [ ] **Step 1: Add failing persistence tests**

Add tests proving:

- failed deterministic validation writes the same report to `artifact_upload_session.validation_report` and keeps the scalar reason code aligned;
- successful normalization writes warnings with `primaryIssue: null` during ready-Version commit;
- manual Retry clears the old report before reprocessing;
- Replace file exposes only the new Upload session report.

Example assertion:

```rust
let report: serde_json::Value = sqlx::query_scalar(
    "select validation_report from artifact_upload_session where id = 'upload-1'"
).fetch_one(&pool).await.unwrap();
assert_eq!(report["primaryIssue"]["code"], "invalid_file_content");
assert_eq!(report["primaryIssue"]["details"]["path"], "assets/chart.png");
```

Run: `cargo test --test job_store --test retry_policy`

Expected: FAIL because `JobFailure` and ready commits do not carry reports.

- [ ] **Step 2: Extend Worker transition inputs**

Add `validation_report: Option<ValidationReport>` to `JobFailure`. Use the `ReadyVersionCommit.validation_report` added in Task 3, with `primaryIssue` required to be null for successful commit. Change runtime classification to return both retry classification and the optional safe report: extract `ArchiveValidationFailure.report` before reducing `failure.error` to retry policy, carry it through `record_failure`, and populate `JobFailure.validation_report`. Serialize both failure and success forms with `serde_json::to_value` at the SQL boundary.

- [ ] **Step 3: Persist both terminal outcomes atomically**

In `PostgresJobStore::fail`, update `validation_report` in the same transaction that closes the attempt and changes Upload-session state. Require a deterministic failure report to have `primaryIssue` and validate its structured code against the legacy scalar code using the migration table in the design; reject inconsistent pairs transactionally. In `commit_ready_version`, write successful warnings in the same transaction that creates the Version and manifest. Keep operational exception evidence only on `artifact_processing_attempt.exception`.

- [ ] **Step 4: Clear stale reports on recovery**

Update `queueManualRetry` and replacement transitions to clear or supersede the previous current report. Extend `uploadSessionRecord` in `api/src/db/artifact-repositories.ts` with a strict runtime parser for the JSONB report. Accept only the checked report/notice/details shape and field types; reject malformed or legacy objects as inconsistent database state rather than casting them into the management contract.

- [ ] **Step 5: Verify persistence and retry behavior**

Run:

```bash
cargo test --test job_store --test retry_policy
pnpm --dir api test -- artifact-repositories.test.ts artifact-recovery.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit persistence**

```bash
git add worker/src/job_store.rs worker/src/retry_policy.rs worker/src/runtime.rs worker/tests/job_store.rs worker/tests/retry_policy.rs api/src/db/artifact-repositories.ts api/tests/artifact-repositories.test.ts
git commit -m "feat: persist artifact validation reports"
```

---

### Task 5: Project precise API errors and add YAML contract coverage

**Files:**

- Modify: `api/src/application/artifacts/artifact-management.ts`
- Modify: `api/src/http/http-error.ts`
- Modify: `api/src/http/artifact-routes.ts`
- Modify: `api/tests/artifact-management.test.ts`
- Modify: `api/tests/artifact-routes.test.ts`
- Modify: `api/tests/artifact-flow.yaml`
- Modify: `api/tests/artifact_flow_contract.py`

**Interfaces:**

- Consumes: `UploadSessionRecord.validationReport` from Task 4.
- Produces: `artifact.validationReport` and structured synchronous HTTP errors used by Web.

- [ ] **Step 1: Add failing application and route tests**

Add an Artifact-management fixture with:

```ts
validationReport: {
  primaryIssue: {
    code: "single_file_too_large",
    message: "The file exceeds the allowed size.",
    action: "Reduce or split the file, then upload a new ZIP.",
    details: { path: "data/report.json", actualBytes: 66479718, limitBytes: 52428800 }
  },
  issues: [],
  warnings: []
}
```

Assert the service returns the object unchanged and no longer substitutes the generic `invalid_content` copy. Add a route test asserting synchronous `archive_too_large` contains `action` and `details.limitBytes` but does not invent `actualBytes`.

Run: `pnpm --dir api test -- artifact-management.test.ts artifact-routes.test.ts`

Expected: FAIL because current management state exposes only scalar `failure`.

- [ ] **Step 2: Project reports with legacy fallback**

Add `validationReport: ValidationReport | null` to `ArtifactManagementState`. Prefer the stored report when present. Preserve existing `failure` for retryability and for infrastructure/legacy failures; deterministic validation UI must read the report first.

- [ ] **Step 3: Extend the HTTP error seam**

Allow `errorJson` to receive safe optional `action` and `details`. For `archive_too_large`, pass the active policy's `archiveSizeBytes` as `limitBytes`. Do not expose multipart parser internals.

- [ ] **Step 4: Add YAML-defined end-to-end cases**

Extend `api/tests/artifact-flow.yaml` archives with:

```yaml
  macos_named_entry:
    腾讯文档盘点分析报告.html: "<!doctype html><title>Report</title>"
    __MACOSX/._腾讯文档盘点分析报告.html:
      base64: AAUAAAJiaW5hcnk=
  ambiguous_entry:
    report.html: "<!doctype html><title>Report</title>"
    slides.html: "<!doctype html><title>Slides</title>"
```

Add cases that wait for the named-entry Artifact to become ready and assert warning codes, then wait for the ambiguous Artifact to fail and assert:

```yaml
artifact.validationReport.primaryIssue.code: ambiguous_entry_file
artifact.validationReport.primaryIssue.details.candidates.0: report.html
artifact.validationReport.primaryIssue.details.candidates.1: slides.html
```

Extend the Python runner only where needed to support binary fixture values and deterministic list-path assertions; keep all cases declared in YAML.

- [ ] **Step 5: Run API unit and contract suites**

Start the full local stack, wait for readiness, run the YAML contract, and always stop the launcher:

```bash
pnpm --dir api run typecheck
pnpm --dir api run test
mise run dev >/tmp/shareslices-validation-contract.log 2>&1 &
DEV_PID=$!
trap 'kill -INT "$DEV_PID" 2>/dev/null || true; wait "$DEV_PID" 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  curl --fail --silent http://127.0.0.1:7456/ready >/dev/null && break
  test "$attempt" -lt 60 || exit 1
  sleep 1
done
uv run pytest api/tests/artifact_flow_contract.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit API projection**

```bash
git add api/src/application/artifacts/artifact-management.ts api/src/http/http-error.ts api/src/http/artifact-routes.ts api/tests/artifact-management.test.ts api/tests/artifact-routes.test.ts api/tests/artifact-flow.yaml api/tests/artifact_flow_contract.py
git commit -m "feat: return actionable artifact validation errors"
```

---

### Task 6: Add Web ZIP preflight in a Web Worker

**Files:**

- Create: `web/src/artifacts/archive-preflight.ts`
- Create: `web/src/artifacts/archive-preflight.worker.ts`
- Create: `web/src/artifacts/archive-preflight-client.ts`
- Create: `web/src/artifacts/archive-preflight.test.ts`
- Modify: `web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `web/src/screens/CreateArtifactDialog.tsx`
- Modify: `web/src/screens/ArtifactDetailScreen.tsx`
- Modify: `web/src/screens/artifact-management.test.tsx`

**Interfaces:**

- Consumes: `UploadPolicy` and the stable issue/detail semantics from Task 1.
- Produces: `preflightArtifactZip(file, policy): Promise<ValidationReport>` used before Create and Replace upload.

- [ ] **Step 1: Move `fflate` to production dependencies**

Run: `pnpm --dir web add fflate@^0.8.3`

Expected: `fflate` moves from `devDependencies` to `dependencies`; no second ZIP library is added.

- [ ] **Step 2: Write failing pure preflight tests**

Use `fflate.zipSync` to cover:

- macOS metadata ignored;
- one named root HTML inferred;
- one wrapper removed;
- multiple root HTML candidates rejected;
- no root HTML rejected with nested candidates;
- unsupported extension includes `path` and `extension`;
- archive, expanded, single-file, and file-count failures include actual and limit fields;
- issue and warning samples stop at 20.

Example:

```ts
expect(preflightEntries(entries, policy)).toMatchObject({
  primaryIssue: null,
  warnings: [
    { code: "ignored_system_metadata" },
    { code: "entry_file_inferred", details: { entryFile: "腾讯文档盘点分析报告.html" } }
  ]
});
```

Run: `pnpm --dir web test -- archive-preflight.test.ts`

Expected: FAIL because the preflight module does not exist.

- [ ] **Step 3: Implement bounded client preflight**

Put deterministic path classification and entry resolution in `archive-preflight.ts`. Put ZIP parsing and byte/count accumulation in `archive-preflight.worker.ts` using `fflate.Unzip` with synchronous `UnzipInflate` inside the dedicated Web Worker; do not use `unzipSync` or one asynchronous inflater per entry. Feed the raw ZIP to `Unzip` in bounded chunks, enforce declared and observed limits before and during inflation, and terminate the current stream plus remaining input on the first terminal issue. Stream UTF-8 validation, retain only fixed signature prefixes for binary formats, and buffer JSON only up to the already-enforced single-file limit for complete parsing. SVG preflight validates UTF-8 plus the first root local name without enforcing namespace, entity, or complete XML well-formedness; the authoritative Rust Worker performs the full `quick_xml` validation so Web never blocks a Worker-accepted SVG because of parser-library differences. Transfer each input `ArrayBuffer` into the Worker rather than cloning it:

```ts
worker.postMessage({ id, bytes, policy }, [bytes]);
```

Return only the report, never expanded file bytes. Terminate the Worker on result, error, or component cancellation.

- [ ] **Step 4: Integrate Create and Replace flows**

Before setting upload progress, run `preflightArtifactZip`. If `primaryIssue` exists, render its message, affected path/values, and action and do not call the upload API. If preflight itself cannot run, show the existing neutral warning and continue to server validation. Apply the same behavior to Replace file.

- [ ] **Step 5: Verify Web preflight behavior**

Run:

```bash
pnpm --dir web run typecheck
pnpm --dir web run test
pnpm --dir web run build
```

Expected: all commands PASS and the production build includes the Worker chunk.

- [ ] **Step 6: Commit Web preflight**

```bash
git add web/package.json pnpm-lock.yaml web/src/artifacts web/src/screens/CreateArtifactDialog.tsx web/src/screens/ArtifactDetailScreen.tsx web/src/screens/artifact-management.test.tsx
git commit -m "feat: preflight artifact archives in web"
```

---

### Task 7: Present detailed server reports and normalization warnings

**Files:**

- Modify: `web/src/api/artifacts.ts`
- Create: `web/src/components/ArtifactValidationReport.tsx`
- Modify: `web/src/screens/ArtifactDetailScreen.tsx`
- Modify: `web/src/screens/artifact-management.test.tsx`
- Modify: `web/e2e/first-share-flow.spec.ts`

**Interfaces:**

- Consumes: `artifact.validationReport` from Task 5.
- Produces: one reusable presentation for Web preflight issues and asynchronous server reports.

- [ ] **Step 1: Write failing component tests**

Add tests asserting the failed detail page visibly includes:

```text
data/report.json
63.4 MiB
50 MiB
Reduce or split the file, then upload a new ZIP.
```

Add a ready-state test asserting `ignored_system_metadata` and `entry_file_inferred` are presented as non-destructive warnings and do not remove Preview, Publish, or Share actions.

Run: `pnpm --dir web test -- artifact-management.test.tsx`

Expected: FAIL because the current alert shows only generic message/action/code.

- [ ] **Step 2: Type the API report**

Mirror the checked OpenAPI shape in `web/src/api/artifacts.ts` and extend `ArtifactApiError` with optional `action` and `details` so synchronous upload rejections use the same renderer.

- [ ] **Step 3: Build the reusable report component**

Create `ArtifactValidationReport.tsx` using existing shadcn Base UI `Alert`. Render user-facing message and action first. Render only known structured fields; never dump `details` with `JSON.stringify`. Format bytes and counts in plain language and show candidate/path lists with bounded wrapping.

- [ ] **Step 4: Add end-to-end coverage**

Extend `web/e2e/first-share-flow.spec.ts` to upload a named HTML ZIP containing macOS metadata, wait for Ready, Preview it, and assert the warning copy. Add an ambiguous ZIP case and assert the candidate names and correction appear after processing fails.

- [ ] **Step 5: Verify at the supported viewport**

Start the app with `mise run dev`, set Playwright to 1440×900, and capture:

```text
output/playwright/artifact-normalized-warning-1440x900.png
output/playwright/artifact-validation-error-1440x900.png
```

Assert zero browser console errors and warnings, then stop the browser and development processes.

- [ ] **Step 6: Commit Web feedback**

```bash
git add web/src/api/artifacts.ts web/src/components/ArtifactValidationReport.tsx web/src/screens/ArtifactDetailScreen.tsx web/src/screens/artifact-management.test.tsx web/e2e/first-share-flow.spec.ts
git commit -m "feat: explain artifact validation results"
```

---

### Task 8: Complete conformance and quality gates

**Files:**

- Modify: `openspec/changes/normalize-artifact-archives/tasks.md`
- Modify: `docs/design/modules.md` only if implemented interfaces differ from its current sketches

**Interfaces:**

- Consumes: every preceding task.
- Produces: a reviewable, fully verified change with no temporary instrumentation or fixtures.

- [ ] **Step 1: Run focused cross-runtime fixtures**

Run the named-entry, metadata, ambiguity, path, format, and limit fixtures through Worker tests and Web preflight tests. Compare stable codes and detail-field meanings; Web may omit signature checks it cannot safely perform, but it must not assign a conflicting code.

- [ ] **Step 2: Run the complete local gate**

Run:

```bash
git diff --check
mise run check
pnpm --dir web run build
```

Expected: all commands exit 0. Do not weaken Markdown, spellcheck, TypeScript, Rust, OpenSpec, or test configuration to obtain a pass.

- [ ] **Step 3: Clean diagnostics and update task state**

Run:

```bash
rg -n '\[DEBUG-|problem-artifact|prototype-qa' api worker web tools
```

Expected: no temporary diagnostic instrumentation or local QA fixture remains in source. Mark completed OpenSpec tasks only after their corresponding verification command passes.

- [ ] **Step 4: Commit verification metadata**

```bash
git add openspec/changes/normalize-artifact-archives/tasks.md docs/design/modules.md
git commit -m "docs: complete archive normalization change"
```
