# ShareSlices 0.0.1 first share flow tasks

## 1. Contracts and project foundations

- [x] 1.1 Extend `api/openapi/openapi.yaml` with the exact management and Viewer route table from `design.md`, including upload-policy, Artifact rename, Upload session, Retry action, API-Origin Preview content, Publication, Viewer asset, and state-page contracts.
- [x] 1.2 Add `api/tests/artifact-flow.yaml` plus a Python contract runner covering authentication, name validation, relative assets, caching, idempotency, processing states, Preview, Publication, and Viewer responses before implementing the routes.
- [x] 1.3 Add checked SQL migrations for upload policy, Artifact, Share link, Upload session, processing job and attempt, Version, manifest metadata, Publication, and idempotency records with required ownership and uniqueness constraints.
- [x] 1.4 Mirror the new migration schema in Drizzle and add database tests for defaults, Artifact 1:N Version relationships, one-active-link enforcement, and atomic Publication transitions without a one-ready-Version database constraint.
- [x] 1.5 Seed the exact default extension, content-type, signature-validation, and numeric policy table from `PRODUCT.md`, and verify later policy rows do not mutate existing Upload session snapshots.
- [x] 1.6 Add validated API configuration for Web, API, Viewer, object storage, and Worker job settings without hardcoding Docker Compose, Kubernetes, IP, port, or domain values.
- [x] 1.7 Create the root Cargo workspace and `worker/` Tokio package, then add `cargo fmt`, Clippy, worker tests, and SQLx checks to the existing `mise` and workspace quality gates.

## 2. Structured logging and local infrastructure

- [x] 2.1 Implement the OpenTelemetry-compatible TypeScript log-record builder and API JSON-lines adapter, then replace direct API `console.*` calls with stable events and request correlation.
- [x] 2.2 Implement the matching Web logger adapter so browser diagnostics use the same severity, resource, event, attribute, and exception field contract.
- [x] 2.3 Implement the matching Rust Worker subscriber and event helpers with service identity, job and attempt correlation, reason codes, and exception redaction.
- [x] 2.4 Add S3-compatible private object storage and bucket initialization to Docker Compose, with health checks and persistent local data.
- [x] 2.5 Add the Worker service to Docker Compose with PostgreSQL and object-storage configuration, health reporting, and restart-safe job processing.

## 3. Artifact intake and management API

- [x] 3.1 Add an API object-storage Interface with AWS SDK v3 and in-memory test Adapters for streaming raw ZIP writes, committed reads, and staging cleanup.
- [x] 3.2 Implement Artifact, Share-link, Upload-session, processing-job, Version, Publication, and idempotency query modules behind application-facing repository Interfaces.
- [x] 3.3 Implement the authenticated upload-policy endpoint with the complete active policy and opaque revision, plus authorization and response-contract tests.
- [x] 3.4 Implement initial Artifact creation with trimmed 1-to-120-character name validation, multipart ZIP streaming, SHA-256 input identity, archive-size enforcement, durable raw storage before database creation, Share-slug generation, and complete pending, replay, conflict, and interrupted idempotency behavior.
- [x] 3.5 Implement owner-only Artifact list, detail, and name update with duplicate labels allowed, stable Artifact ID, processing state, ready Version, publication state, active Share link, allowed actions, and user-actionable failure summaries.
- [x] 3.6 Implement idempotent owner Retry against the retained raw ZIP and idempotent Replace file with a new Upload session snapshot, retaining only current retryable input and rejecting either operation after the first ready Version in `ArtifactModule`.
- [x] 3.7 Add focused API module and HTTP tests for interrupted and oversized uploads, name updates, ownership, state transitions, pending and completed idempotency replay, conflicts, policy snapshots, Retry, Replace file, raw retention, and application-level one-ready-Version enforcement.
- [x] 3.8 Implement the Hono `ReconciliationModule` for expired leases, orphan and superseded raw ZIPs, committed-input ZIPs, abandoned staging objects, and retry-safe bounded cleanup that preserves current retryable input.

## 4. Rust processing Worker

- [x] 4.1 Implement durable job claim, lease, heartbeat, completion, failure, and expired-lease recovery with SQLx and idempotent state transitions.
- [x] 4.2 Implement streaming raw-archive reads and bounded staging-object writes through an AWS SDK for Rust object-storage Adapter and an in-memory test Adapter.
- [x] 4.3 Implement ZIP traversal and path normalization that rejects missing root `index.html`, parent traversal, absolute paths, links, special files, and nested archives.
- [x] 4.4 Implement the centralized format-rule table and policy-snapshot validation for enabled extensions, checked signatures, expanded total size, file count, and single-file size.
- [x] 4.5 Implement bounded-concurrency expanded-file writes, SHA-256 and content-type metadata, and deterministic manifest generation without loading the full archive or expanded Artifact into memory.
- [x] 4.6 Implement retry classification and policy decisions for initial transient reason codes, the 1-second and 5-second jittered schedule, one unclassified retry, deterministic validation failure, and structured retry logs.
- [x] 4.7 Implement atomic ready-Version commit, isolated attempt staging prefixes, cleanup after failed attempts, and exactly-once effective completion under repeated processing.
- [x] 4.8 Add Worker unit and PostgreSQL/S3 integration tests for every archive rejection, snapshotted limit, retry path, crash recovery, manifest, committed Version, and cleanup handoff invariant.

## 5. Publication, Preview, and Viewer API

- [x] 5.1 Implement resource-oriented Publish and Unpublish management endpoints with owner checks, ready-Version eligibility, idempotency, and atomic Publication updates.
- [x] 5.2 Implement authenticated API-Origin Preview entry and asset routes with trailing-slash relative resolution that reuse the current management session and verify ownership, ready state, manifest membership, and normalized paths on every request.
- [x] 5.3 Implement `ViewerModule` Share-slug lifecycle resolution for active published, active unpublished, known expired, known retired, and unknown links.
- [x] 5.4 Implement trailing-slash Viewer entry and relative asset streaming from committed manifest objects with recorded content types, `Cache-Control: no-store`, and no raw or signed object-storage URLs.
- [x] 5.5 Implement non-content Viewer state pages with the required `200`, `410`, and `404` behavior, generic management route, no Artifact metadata, and search exclusion.
- [x] 5.6 Add API and module tests for ownership denial, API-Origin Preview, relative and root-absolute references, no-store caching, atomic and idempotent Publish, idempotent Unpublish, republish, stable Share links, state pages, invalid assets, traversal attempts, and Publication changes during asset resolution.

## 6. Web management experience

- [x] 6.1 Extend the Web API client and authenticated navigation for Artifact list, create, and detail views while preserving the existing account-entry flow.
- [x] 6.2 Build the quiet Artifact list and detail management surfaces with editable Artifact name, processing, failure, ready, published, and unpublished states and only valid actions for each state.
- [x] 6.3 Build initial Artifact creation with Artifact name, ZIP selection, upload progress and error states, optional policy preflight, and navigation to the accepted Artifact detail.
- [x] 6.4 Build processing refresh, user-actionable validation failure, manual Retry, and Replace file interactions with stable layout during state changes.
- [x] 6.5 Build Preview, Publish, Unpublish, republish, and copy-Share-link actions with clear pending, success, and failure states.
- [x] 6.6 Add Web unit and interaction tests for authenticated routing, Artifact rename, upload, state rendering, ownership errors, Retry, Replace file, Preview, Publication, and Share actions.
- [x] 6.7 Add a Playwright smoke flow for create-to-ready-to-Preview-to-Publish-to-Viewer and verify desktop and mobile screenshots without overlapping or clipped controls.

## 7. Deployment profiles and end-to-end verification

- [x] 7.1 Complete Docker Compose for local Web, API, Worker, PostgreSQL, and S3-compatible storage with mapped ports, health checks, migrations, seeded policy, and one-command startup.
- [x] 7.2 Add production container builds for Web, API, and Worker using project `mise` tool versions and non-root runtime users where supported.
- [x] 7.3 Add minimal Kubernetes Deployment, Service, ConfigMap, and Secret templates for shared testing and intranet production using configurable IP and port addresses without DNS assumptions.
- [x] 7.4 Add a public-production Kubernetes ingress overlay that supplies configured public Web, API, and Viewer domain names without changing application images.
- [x] 7.5 Run the complete flow against Docker Compose from a clean database and empty object store, then restart API and Worker processes during processing to verify lease recovery and one effective ready Version.
- [x] 7.6 Run API YAML/Python contracts, TypeScript typechecks and tests, Rust formatting, Clippy, SQLx checks and tests, Web tests, Playwright smoke tests, documentation checks, and `mise run check`.
- [x] 7.7 Update checked OpenAPI examples and `docs/design/modules.md` to the implemented interfaces and statuses, recording any verified deviation from this design before review.
