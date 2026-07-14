# Reuse Artifact Content Bundles Design

<!-- cspell:words cutover HMAC -->

## Context

Artifact files, Manifests, and thumbnails are currently owned directly by Version records. The Worker expands every accepted ZIP into Version-scoped objects and creates one Version-scoped thumbnail job. This repeats CPU, object writes, and Chromium work when one User uploads equivalent content more than once.

The target architecture is owned by [Content bundle reuse](../../../docs/design/content-bundle-reuse.md) and [ADR 0005](../../../docs/adr/0005-reuse-content-bundles-within-user-ownership.md). This change realizes that target without changing public resource shapes. It also removes the stale implemented requirement that rejects additional ready Versions.

## Goals / Non-Goals

**Goals:**

- Make two equivalent Uploads owned by one User create distinct Versions that reference one Content bundle.
- Avoid repeat expansion on an exact raw-input hit and avoid duplicate committed objects after normalized-content identity matches.
- Share thumbnail output by Content bundle and renderer revision.
- Preserve Version-scoped authorization, Upload idempotency, validation evidence, Publication behavior, and permanent deletion.
- Make concurrency, failed attempts, integrity isolation, and cleanup recoverable through durable state.

**Non-Goals:**

- Cross-User, organization, file-level, region-level, or deployment-level reuse.
- Public Content bundle, fingerprint, reuse-state, or object-storage fields.
- Client-authoritative hashes or Upload transfer avoidance.
- Backfill, dual reads, or compatibility with the old Artifact object layout.
- Mobile, tablet, CLI command-shape, or Web management changes.

## Decisions

### Use one destructive schema transition

Add a checked migration that replaces Version-owned asset and thumbnail relationships with Content bundle relationships. Before applying it, the pre-production transition stops API, Worker, and Reconciliation and clears all Artifact-domain rows and raw, staging, committed, and thumbnail objects. Editing historical migrations or maintaining dual-read code was rejected because no production Artifact data must survive.

### Keep identity and lookup evidence private

The API computes current and previous raw-input HMAC candidates while streaming to object storage. The Worker computes a versioned canonical identity from the normalized Entry file and path-sorted asset metadata and digests, then creates current and previous private bundle aliases. PostgreSQL stores keyed aliases, not plain raw or asset digests; SHA-256 integrity values remain in the private Manifest and object metadata.

Upload idempotency uses a separate randomized authenticated-encryption key ring. A completed idempotency record stores encrypted canonical request evidence and its key revision so records can be re-encrypted before an old key retires. Reusing the expiring deduplication key was rejected because it would break long-lived replay comparison.

### Put bundle state transitions behind one Worker interface

Introduce one production-and-test `ContentBundleStore` interface at the existing processing seam. It performs raw evidence lookup, creating-bundle reservation or takeover, normalized winner resolution, Version reference commit, alias retirement, and integrity transitions. SQL and object-storage details remain behind the PostgreSQL and storage Adapters; the API cannot create ready Versions.

The normalized pipeline becomes validate and stage, calculate canonical identity, reserve or reuse, promote attempt-specific objects, then atomically commit the Version reference. A raw hit enters the same final commit state machine with copied immutable validation evidence.

### Fence metadata and isolate every object-writing attempt

Processing and thumbnail attempts register an attempt-specific prefix, Lease, write deadline, terminal state, and cleanup state before writing. Workers check their Lease before writes and can publish winner metadata only under the active Lease. Attempt-unique object keys prevent a stale process from overwriting winner bytes; retained tombstones and bounded prefix scans clean writes that arrive after an earlier cleanup pass.

### Resolve all content through Version authorization

Preview, Viewer, export, and internal capture continue to authorize a Version, then resolve its Content bundle and private Manifest. Owner thumbnail reads resolve the Version's pinned renderer revision to one bundle thumbnail. Public OpenAPI schemas and Version-shaped URLs remain unchanged.

### Share thumbnail work without sharing authorization

One job and immutable output exist per `(content_bundle_id, renderer_revision)`. Each Version pins the active renderer revision when it becomes ready. A render attempt selects a live referencing Version and obtains the existing single-use Version capture grant; deletion or authorization races retry with another live reference.

### Derive liveness from Version references

No mutable reference count authorizes deletion. Artifact deletion locks the Artifact, then affected bundles in sorted ID order. Removing a non-final Version reference leaves the bundle intact. Removing the final reference retires active aliases, cancels bundle work, records cleanup intent, and marks the bundle deleting. Reconciliation deletes objects only after active Leases and the writer-quiescence interval end.

## Testing Decisions

- Use Worker PostgreSQL integration tests as the highest seam that can prove one physical bundle backs multiple logical Versions.
- Use processing unit tests for canonical identity vectors, raw-hit bypass, normalized-hit cleanup, revision mismatch, and Lease loss.
- Use API repository integration tests for composite ownership, Version-shaped resolution, final-reference deletion, and Reconciliation.
- Use thumbnail Worker integration tests for shared jobs, pinned revisions, live Version selection, and stale-writer exclusion.
- Extend the YAML/Python Artifact flow for externally visible multi-Version, cross-User, Preview, export, and deletion behavior; keep physical reuse assertions out of public HTTP contracts.
- Add negative OpenAPI assertions so Content bundle IDs, fingerprints, and hit state cannot enter public schemas.

## Risks / Trade-offs

- **[Risk] Concurrent equivalent attempts still repeat validation and expansion before one winner is selected.** → Accept bounded duplicate compute; uniqueness prevents duplicate committed storage and later raw hits avoid the work.
- **[Risk] Key rotation can remove a raw fast path for old Uploads whose raw objects are gone.** → Allow old raw aliases to expire and fall back to normalized reuse; require every reusable bundle and retained idempotency record to migrate before its old key retires.
- **[Risk] A stale process can write after its Lease expires.** → Use attempt-unique prefixes, conditional metadata commit, write deadlines, quiescence, tombstones, and recurring orphan scans.
- **[Risk] Undetected object corruption can be reused without rereading every asset.** → Trust ready healthy state, quarantine on confirmed missing objects or checksum mismatch, retire aliases atomically, and never redirect existing Versions silently.
- **[Trade-off] Same content owned by different Users remains duplicated.** → Preserve account isolation and avoid a cross-User content-existence side channel and shared deletion boundary.

## Migration Plan

This is a destructive pre-production cutover. It preserves account data but preserves no Artifact, Upload, Version, Publication, Share-link, validation, thumbnail, or object data. The operator records each checkpoint and does not reopen external traffic until every smoke assertion passes.

### Preconditions

1. Stop management and Viewer traffic, API processes, Workers, thumbnail work, and Reconciliation. Direct operator traffic used later for smoke tests remains inaccessible to ordinary users.
2. Confirm no API or Worker process can create a job or write an object. Record the database migration version and the deployed API and Worker image identifiers.
3. Create a restorable database snapshot after writes stop. This is the rollback point for account data and the pre-change schema; Artifact data is intentionally discarded.
4. Configure the following values in the deployment secret and configuration store without printing secret bytes:
   - `CONTENT_FINGERPRINT_KEY_CURRENT` and its non-empty revision on both API and Worker;
   - `IDEMPOTENCY_ENCRYPTION_KEY_CURRENT` and its non-empty revision on API;
   - `CONTENT_IDENTITY_REVISION`, `ARTIFACT_PROCESSING_REVISION`, and `ARTIFACT_RENDERER_REVISION` with identical values on API and Worker.
5. For this first destructive launch, leave both previous-key pairs absent. During a later rotation, a previous key and its revision must either both be present or both be absent; the previous key cannot be removed until its alias or evidence migration is complete.

### Destructive transition

1. Delete every object under the Artifact-owned `raw/`, `staging/`, `versions/`, and `content-bundles/` prefixes. Do not delete unrelated bucket prefixes.
2. Run `truncate table artifact cascade` and verify that Artifact-domain tables contain no live Artifact, Upload, Version, Publication, Share-link, processing, asset, Manifest, thumbnail, or cleanup rows. Migration `0012_content_bundle_foundation.sql` repeats the Artifact truncation defensively.
3. Verify the four Artifact-owned object prefixes are empty. A partially cleared database or bucket is a failed checkpoint; do not apply the migration.
4. Apply the checked migrations through `0012_content_bundle_foundation.sql` exactly once using the normal migration entry point.
5. Verify the migration record is current, all new Content bundle tables and constraints exist, and the Artifact-domain tables remain empty.

### Deployment and readiness order

1. Keep external traffic closed and start PostgreSQL and object storage.
2. Start the API with the new schema and key configuration. Startup must fail for a missing current key, a key shorter than 32 bytes, a missing revision, or a half-configured previous-key pair. Require a passing `/ready` response before proceeding.
3. Start the Worker with the same fingerprint key revision and the same content, processing, and renderer revisions. Its container readiness must pass before smoke testing; startup failure is a failed cutover, not permission to omit a key.
4. Start Reconciliation only after API and Worker readiness passes. Keep ordinary Upload intake closed while smoke traffic uses the operator-only route to the API.

Revision strings are identifiers, not secrets. Secret values are compared through secret-manager version metadata or a keyed deployment check; they are never copied into logs, tickets, or smoke output.

### Smoke verification

Use unique test Users and Artifacts so each assertion can be tied to one database and object-storage observation.

1. Upload one valid Artifact, wait for a ready Version and thumbnail, and verify Preview and export through the Version-shaped routes.
2. Upload the exact ZIP again under the same User with a different idempotency key. Verify a distinct Version, one shared Content bundle, no second bundle file set, and no second thumbnail for the pinned renderer revision.
3. Upload a ZIP with different container bytes but the same normalized Entry file and assets. Verify another distinct Version references the same bundle after full validation.
4. Upload equivalent content as a second User. Verify a separately owned bundle and confirm neither public response exposes a bundle ID, fingerprint, object key, or reuse outcome.
5. Publish one Version, then upload equivalent content again. Verify the existing Publication and Share link still select the previously published Version until an explicit Publish.
6. Delete one of two Artifacts that reference the same bundle. Verify the surviving Version can still Preview, export, publish, and read its thumbnail, and verify no bundle cleanup intent exists yet.
7. Delete the final reference. Run or wait for Reconciliation, then verify aliases and bundle metadata are removed and every registered bundle and thumbnail object prefix is empty.
8. Run the checked OpenAPI contract test and the YAML/Python Artifact flow. Record their results with the database and object-count assertions above before opening traffic.

### Destructive rollback

Rollback is allowed only while traffic remains closed. It preserves no smoke-test Artifact data and does not attempt to make old binaries read the new object layout.

1. Stop Reconciliation, Worker, and API, and verify object writers are quiescent.
2. Delete all post-migration objects under the four Artifact-owned prefixes.
3. Restore the pre-cutover database snapshot. Verify the schema is at the recorded pre-`0012` migration and the Artifact domain is empty while account data matches the snapshot.
4. Deploy the recorded previous API and Worker images with their previous configuration. Do not run `0012` or retain new-only key configuration as an implied compatibility path.
5. Start the previous API and then Worker, verify their health and readiness, and verify Artifact listing is empty before reopening traffic.

If writes escaped the closed window, stop: restoring the snapshot would also discard those non-Artifact writes and requires a separate operator decision. Forward repair after traffic opens is a new migration, not this rollback procedure.

## Open Questions

None. Exact key values, operation timeouts, and cleanup batch sizes remain deployment configuration rather than product decisions.
