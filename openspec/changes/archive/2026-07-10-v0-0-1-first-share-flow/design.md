# ShareSlices 0.0.1 first share flow design

## Context

ShareSlices 0.0.1 introduces the first Artifact data path across the Web, Hono API, PostgreSQL, private object storage, Rust Worker, and Viewer origin. Artifact content is untrusted, processing is asynchronous and at-least-once, and the management and Viewer origins stay separate. The product rules and limits are owned by `PRODUCT.md`; this document records how this change realizes them.

## Goals / Non-Goals

**Goals:**

- Complete the first Web-driven upload, processing, Preview, Publish, and Viewer flow.
- Make upload acceptance and processing deterministic under one snapshotted upload policy.
- Preserve origin isolation while allowing an owner to Preview a ready Version.
- Make request, upload, job, attempt, and retry failures traceable across the Web, API, and Worker.
- Keep asynchronous processing idempotent and recoverable after transient failures.

**Non-Goals:**

- CLI and Skill upload integration.
- Additional ready Versions for an Artifact.
- Share-link rotation, expiration controls, private sharing, deletion, or version pruning.
- A log collector, frontend log-ingestion endpoint, general distributed tracing platform, or administration UI for configuration.

## Decisions

### Snapshot the active upload policy

The API reads the active database-backed upload policy when it accepts an upload and stores an immutable policy snapshot plus an opaque policy revision on the Upload session. The API and Worker enforce that snapshot rather than rereading live configuration while the upload is in flight. This follows `docs/adr/0001-snapshot-artifact-limits-per-upload-session.md` and prevents one upload from changing meaning after acceptance.

The optional limits-discovery endpoint reports the currently active policy for client preflight. Its response is advisory; the accepted Upload session snapshot remains authoritative.

The database policy contains the enabled extension list. The Worker keeps one centralized format-rule table keyed by extension; each rule supplies the served media type and the applicable content or signature validator. `PRODUCT.md` owns the seeded extension, content-type, and validation table. Adding a format extends the Worker table and enables the extension in database policy. The design does not introduce a generated catalog or a configurable validation DSL. A policy cannot successfully process an extension for which the deployed Worker has no rule.

### Keep the durable model broader than the first UI

The database keeps the durable Artifact-to-Version relationship as one-to-many. Version 0.0.1 enforces its one-ready-Version limit in `ArtifactModule` before accepting Retry, Replace file, or another upload after Ready; it does not add a database uniqueness constraint that prevents future Versions.

Artifact names are trimmed to 1 through 120 characters, can be duplicated by one Owner, and can be changed with a normal Artifact update. Artifact ID remains the stable identity and Share slug remains the Share-link identity.

### Keep Viewer access separate from Owner Preview

Owner and Viewer are contextual roles. Public Share-link requests never reveal unpublished content. This remains true when the Viewer happens to own the Artifact: a published link serves published content, and an unpublished link serves the same unpublished status page shown to every Viewer.

The management and Viewer HTTP route groups remain separate so the Viewer cannot invoke management operations through its own route group. Their concrete IP addresses, ports, and domain names belong to deployment configuration.

Preview begins only when an Owner explicitly selects Preview from the signed-in Artifact controls. Preview content is served from the API Origin so each Preview page or asset request receives the current management session and can verify that the user owns the Artifact and that the selected Version is ready. Version 0.0.1 creates no separate Preview session, one-time grant, expiry policy, or shareable Preview URL.

Uploaded JavaScript executes in Preview and published Viewer pages. Separate-site Cookie isolation, strict CSP and Permissions Policy, opener isolation, and navigation restrictions are explicitly deferred beyond 0.0.1. The minimum retained controls are ownership checks for Preview, publication checks for public content, private object storage, manifest-only asset resolution, and normalized path validation.

### Preserve relative Artifact URLs without rewriting content

Both entry routes end with `/`: `/api/versions/{versionId}/content/` for Preview and `/a/{shareSlug}/` for Viewer. Browser URL resolution therefore maps `assets/app.js` and `./assets/app.js` to the corresponding content route, and CSS `url(...)` plus JavaScript relative imports resolve from the containing file URL. Backend wildcard routes normalize the remaining asset path and look it up in the manifest.

For each matched asset, the backend reads the manifest object key, streams that private object to the browser, and applies the manifest content type. The browser never receives an object-storage URL and does not need to know where the bytes are stored. Artifact build tools must emit relative base paths so generated assets stay under the entry route.

Version 0.0.1 does not rewrite HTML and does not support root-absolute references such as `/assets/app.js`, bare JavaScript module specifiers, or comprehensive static discovery of dynamically constructed URLs. Ready means the archive and files passed validation, not that every application-level reference can be proven before execution.

### Fix the management and Viewer HTTP resources

The checked OpenAPI contract uses this route table:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/artifact-upload-policies/current` | Read the active optional preflight policy |
| `GET` | `/api/artifacts` | List owned Artifacts |
| `POST` | `/api/artifacts` | Create an Artifact from name and ZIP multipart data |
| `GET` | `/api/artifacts/{artifactId}` | Read owned Artifact detail |
| `PATCH` | `/api/artifacts/{artifactId}` | Change the mutable Artifact name |
| `POST` | `/api/artifacts/{artifactId}/upload-sessions` | Replace file before the first ready Version |
| `POST` | `/api/upload-sessions/{uploadSessionId}:retry` | Retry retained input without exposing Processing Jobs |
| `GET` | `/api/versions/{versionId}/content/` | Preview the ready entry file on the API Origin |
| `GET` | `/api/versions/{versionId}/content/{assetPath}` | Preview one normalized manifest asset |
| `POST` | `/api/artifacts/{artifactId}/publications` | Publish a ready Version |
| `DELETE` | `/api/artifacts/{artifactId}/publications/{publicationId}` | Unpublish the current Publication as an idempotent operation |
| `GET` | `/a/{shareSlug}/` | View the current published entry or known-link state |
| `GET` | `/a/{shareSlug}/{assetPath}` | View one normalized published manifest asset |

Create and Replace file use multipart bodies. Retry is the only custom mutation action because Processing Jobs remain internal resources.

### Make every retried mutation idempotent

Create, Replace file, Retry, and Publish require `Idempotency-Key`. The scope is Owner, operation type, target resource when present, and key. The API computes raw ZIP SHA-256 while streaming. Create compares the trimmed Artifact name plus ZIP SHA-256 as request input; Replace file identifies the target by stable Artifact ID and compares the ZIP SHA-256 as replacement input.

A completed same-key, same-input request returns its original result. A same-key request still in progress returns `operation_in_progress` without starting another transfer, Upload session, or Job. Reusing a completed key with different input returns `idempotency_conflict`. An interrupted transfer that created no Artifact or Upload session releases its pending key for a later retry. Repeated Retry and Publish calls return the original operation result, while Unpublish uses idempotent `DELETE` semantics.

### Retain only raw input needed for recovery

While an Artifact has no ready Version, the raw ZIP referenced by its current failed Upload session is retained without a time-based expiry so manual Retry remains available. Accepting Replace file makes the replaced raw ZIP eligible for deletion. Committing the first ready Version makes every raw ZIP for that Artifact and all attempt staging objects eligible for deletion.

The Hono `ReconciliationModule` removes orphan raw objects with no database reference, superseded raw ZIPs, committed-input ZIPs, abandoned staging objects, and expired leases in bounded passes. It never removes raw input referenced by the current retryable failed Upload session.

### Separate code configuration from deployment topology

Application behavior consumes configured Web, API, and Viewer addresses instead of hardcoded hosts. Docker Compose and Kubernetes supply those values without changing domain or application modules.

Version 0.0.1 uses three deployment profiles:

- Local development and local automated testing use Docker Compose with mapped ports.
- Shared testing and intranet production use Kubernetes addresses and ports without requiring DNS names.
- Public production uses Kubernetes ingress with configured public domain names.

This change does not require production topology to be reproduced locally. It requires only that each deployment provide reachable Web, API, and Viewer addresses.

### Generate opaque Share slugs

Each Share link receives a cryptographically secure random Share slug with at least 128 bits of entropy, encoded as a URL-safe value without padding of about 22 characters. A database uniqueness constraint detects the unlikely collision and generation retries with a new value. The slug contains neither the Artifact name nor an Artifact identifier and is not treated as an authentication credential.

### Centralize processing retry decisions

The Worker separates retry classification from retry scheduling. A focused classifier maps a typed processing error to a stable reason code and retry class; a focused policy receives the operation, retry class, and attempt count, then returns either a terminal outcome or the next retry delay. Callers do not infer retry eligibility from error-message text, and adding a newly understood error extends the classifier without changing job orchestration.

Transient storage, database, lease, and worker-infrastructure failures receive at most three automatic processing attempts under the initial policy: the initial attempt followed by delays of 1 second and 5 seconds with jitter. Exhaustion leaves a recoverable failed state that the owner can manually Retry using the retained raw ZIP. Deterministic archive or content validation failures are terminal for that file and require Replace file instead of automatic retry. Application-level automatic Retry is limited to Worker processing; the API does not replay streamed upload requests or mutations.

Every attempt has its own attempt identifier and durable attempt number. An error not yet covered by the classifier receives one conservative automatic retry after 1 second and is recorded as `unclassified_error` rather than silently assigned to an unrelated reason. A second failure becomes recoverable failure. The log preserves sanitized exception type, message, stack trace, cause chain, operation, and attempt context so later versions can add an evidence-based classification. Reprocessing remains idempotent: attempts write to isolated staging prefixes, and only a successful ready-Version commit can complete the Upload session.

### Use one structured diagnostic contract

Web, API, and Worker diagnostics use the same OpenTelemetry-compatible logical record: `timestamp`, `severityText`, `severityNumber`, `body`, `eventName`, optional `traceId` and `spanId`, `resource`, and `attributes`. Server processes emit one JSON object per line; the Web logger passes the same structured object to the matching browser console level. Application code does not call `console.*` directly. This change standardizes emission format only and does not send browser logs to the API.

Severity uses the first OpenTelemetry number in each range: `TRACE=1`, `DEBUG=5`, `INFO=9`, `WARN=13`, `ERROR=17`, and `FATAL=21`. Resource attributes identify `shareslices-web`, `shareslices-api`, or `shareslices-worker`, service version, and deployment environment. Application event and attribute names use stable dot-delimited namespaces with lower snake case inside multi-word components.

Correlation includes request, Artifact, Upload session, processing job, and attempt identifiers when available, plus W3C Trace Context fields when present. Retry events include the stable reason code, attempt, maximum attempts, next delay, and sanitized exception evidence; retry exhaustion and terminal validation use distinct events.

Logs never contain credentials, session cookies, Share slugs, raw artifact content, or archive contents without redaction. Human-readable error details are sanitized supporting context; automation and searches depend on event names and reason codes, not message text.

### Disable caching for the first Viewer contract

All Preview entry, Preview asset, Viewer entry, Viewer asset, and known-link state responses use `Cache-Control: no-store` in version 0.0.1. This avoids stale published content after Unpublish and avoids mixing assets when Publication changes. Version-aware immutable asset URLs and more efficient caching are later work.

## Risks / Trade-offs

- [Database configuration enables a format that the Worker cannot safely validate or serve] -> Keep one centralized Worker format-rule table and fail policy validation for extensions without a deployed rule.
- [Automatic retries amplify an object-storage or database outage] -> Cap attempts, use delayed backoff with jitter, and log each scheduling decision.
- [A retry abstraction becomes a generic framework before a second use exists] -> Scope the first policy to Artifact processing operations and expose only typed reason classification plus scheduling decisions.
- [Preview reuses the management session while running uploaded JavaScript] -> Accept this explicitly for the functional 0.0.1 release, keep Preview owner-only, and schedule dedicated Preview credentials plus Viewer isolation as later hardening.
- [Viewer deployment without DNS has weaker browser isolation] -> Keep Viewer and management route groups separate and retain authorization, publication, storage, manifest, and path checks; defer stronger host and Cookie boundaries.
- [Browser console logs are not remotely available after the page closes] -> Accept local-only frontend emission in 0.0.1; remote collection is a later observability decision.
- [Failed raw ZIPs consume storage indefinitely] -> Retain only the current retryable input in 0.0.1 and add time-based retention after product cleanup policy is defined.

## Migration Plan

This is the first Artifact persistence and processing flow, so no existing Artifact data requires migration. Add checked SQL migrations and seeded upload-policy defaults, deploy the API and Worker against the same schema, then enable the Web flow. Rollback disables new upload intake before stopping the Worker; committed Viewer content remains readable from immutable Version metadata.

## Verified implementation deviations

- The planned single `ArtifactModule` is implemented as focused Intake, Management, Recovery, and Publication/Viewer services. This keeps upload streaming, state projection, recovery, and content access behind separate narrow interfaces while preserving the planned HTTP and persistence contracts.
- Worker orchestration uses a `process_attempt` function plus `JobStore`, `ReadyVersionStore`, and `ObjectStorage` traits instead of one `ArtifactProcessingWorker` trait. The runtime binary owns polling and heartbeat behavior; the processing function remains directly testable.
- Preview and Viewer are separate Hono route modules and deployment route groups inside the same API process for version 0.0.1. Stronger process or site isolation remains deferred as already scoped.
- Unknown-length raw ZIP streams use the AWS multipart Upload helper rather than a single `PutObject`, because the Node S3 client cannot reliably send an unknown decoded content length to the configured S3-compatible service.
