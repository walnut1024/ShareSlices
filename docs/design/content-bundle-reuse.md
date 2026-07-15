# Content bundle reuse

<!-- cspell:words dedup HMAC idempotently repoint -->

Status: current

This design describes how Versions reference reusable internal content under the Artifact rules owned by [`PRODUCT.md`](../../PRODUCT.md). It realizes [ADR 0005](../adr/0005-reuse-content-bundles-within-user-ownership.md), while [the Module architecture](modules.md) owns Module placement and Interfaces.

## Goals

- Reuse identical validated and normalized Artifact content owned by one User.
- Avoid repeated archive expansion, committed-object writes, and Chromium rendering when reuse is safe.
- Treat byte-identical ZIP input as a fast path without making ZIP bytes the final content identity.
- Preserve Version history, Upload idempotency, authorization, Publication behavior, and permanent deletion.
- Fall back to the existing processing path whenever reuse cannot be proven.

## Non-goals

- Reuse content across Users, organizations, deployments, regions, or independent object stores.
- Deduplicate individual files shared by otherwise different Content bundles.
- Skip receipt of the complete Upload based on a client-provided hash.
- Expose hashes, reuse state, or Content bundle identity through product or HTTP contracts.
- Automatically invalidate existing ready Versions after an ordinary processing-rule change.

## Version-to-content relationship

Each persisted Version records one Content bundle reference. Reuse never merges Version records, Upload session histories, or their validation evidence.

```text
Artifact
├── Version 1 ─┐
├── Version 2 ─┼── Content bundle A ── files
└── Version 3 ─┘                    └── thumbnails by renderer revision
```

Publication continues to select a Version. Preview, Viewer, export, and thumbnail routes continue to authorize a Version before resolving its Content bundle. A browser never receives an object-storage key or Content bundle identifier.

## Ownership of facts

| Record | Owns |
| --- | --- |
| Upload session | Requested Entry file, policy snapshot, processing and content-identity revisions, validation report, warnings, and processing state |
| Raw-input fingerprint alias | Owning User, matching revisions, requested Entry file, fingerprint-key revision, private reuse fingerprint, Content bundle, reusable validation evidence, and retirement state |
| Upload idempotency record | Randomized encrypted canonical request digest, encryption-key revision, operation scope, caller key, and original response |
| Version | Owning User, Artifact relationship, Upload session, version number, ready time, Content bundle reference, and pinned renderer revision |
| Content bundle | Owning User, canonical Entry file and Manifest, content-identity revision, lifecycle state, and integrity state |
| Content bundle fingerprint alias | Owning User, Content bundle, content-identity revision, fingerprint-key revision, private reuse fingerprint, and retirement state |
| Content bundle asset index | Normalized path, opaque object key, size, and server-derived content type |
| Private bundle Manifest | Entry file plus each asset's indexed metadata and SHA-256 integrity digest |
| Bundle thumbnail | Content bundle, renderer revision, opaque object key, dimensions, content type, and private object-storage SHA-256 integrity metadata |
| Publication | Selected Version and external availability state |

Upload-specific warnings remain on the Upload session even when multiple Versions reference the same Content bundle. Physical reuse must not collapse their histories or validation reports.

## Content identity

The Worker constructs one canonical identity document after validation and normalization. Its deterministic, length-delimited encoding contains:

1. the content-identity revision;
2. the normalized Entry file path; and
3. for each asset ordered by normalized path: path, byte size, server-derived content type, and content digest.

ZIP entry order, compression settings, timestamps, a removed common wrapper directory, and ignored operating-system metadata do not participate. A revision changes only when canonical identity semantics change.

The Worker calculates a SHA-256 digest of each file's bytes for canonical encoding and integrity. Plain digests persist only in the private bundle Manifest and private object-storage checksum metadata; relational lookup and asset-index rows do not store them. Key rotation does not change canonical content identity.

Private lookup aliases use domain-separated hash-based message authentication code (HMAC)-SHA-256 fingerprints. Raw input and bundle identity use separate purpose domains, and each input includes the owning User ID. A database-only reader cannot confirm known Upload or asset bytes by recomputing a persisted digest without the application key; paths, sizes, and other metadata remain sensitive. This protection does not extend to a compromised API or Worker process or to object-storage access. A client-provided hash never selects stored content.

The runtime accepts a current fingerprint key and, during rotation, at most one previous key. Lookup checks both revisions, and creation writes aliases for both in one transaction. A background reindex reconstructs canonical bundle identity from the private Manifest; the previous key cannot retire until every reusable bundle has a current alias. Missing required key material prevents the API or Worker role that needs it from becoming ready.

The API calculates raw-input HMACs directly while streaming and records one Upload-scoped candidate per accepted key revision; it does not persist a plain raw-input digest in PostgreSQL. Ready-Version commit promotes those candidates into active raw-input aliases that point to the Content bundle and retain the compatible validation evidence. Raw aliases from a retired key may expire because deleted raw objects cannot be reindexed; losing that fast path falls back to normalized-content reuse.

Upload idempotency uses a separate durable request identity. The API constructs the canonical request digest from the operation scope, validated request fields, and a transient raw SHA-256, then stores it with randomized authenticated encryption, which provides confidentiality and tamper detection. Each record names its encryption-key revision. Rotation decrypts and re-encrypts every live record before the previous key retires, so long-lived replay comparison does not depend on raw-object retention or fingerprint-key overlap. A pending idempotency claim stores no content-derived digest before the body is received.

## Two-stage processing

The API always streams the complete body to private raw storage while enforcing the archive-size limit. It calculates the server-owned raw fingerprint, commits the Upload session and processing job, and returns the existing accepted response. It does not commit a Version directly on a reuse hit.

The Worker owns both reuse paths and the single ready-Version commit state machine:

1. **Raw fast path.** Match an active raw-input alias by owning User, raw fingerprint, requested Entry file, policy revision, processing revision, content-identity revision, and fingerprint-key revision, then require its Content bundle to remain ready, healthy, and reusable. A safe hit copies the alias's immutable validation report and warnings to the new Upload session, then skips archive expansion, content validation, staging writes, and Manifest generation. Missing compatible report data forces full processing.
2. **Normalized-content path.** On a raw miss, run the normal validation and extraction pipeline. Calculate canonical bundle identity before promotion. A hit reuses the ready bundle and removes this attempt's staging objects; a miss reserves a creating bundle and promotes only attempt-specific objects.
3. **Version commit.** Atomically insert the new Version reference, mark the Upload session committed, complete the processing job, and arrange thumbnail work.

Raw reuse never bypasses a newer policy or processing revision. A normalized-content hit is safe across policy revisions because the current Upload has already passed its own policy before reuse. Ordinary rule upgrades constrain new Uploads; existing ready Versions remain available. Confirmed security incidents use an explicit isolation workflow rather than hidden cache invalidation.

## Persistence and lifecycle

The current schema has these relationships:

```text
artifact_version.content_bundle_id -> content_bundle.id
artifact_version.owner_user_id     -> user.id
content_bundle_asset.bundle_id     -> content_bundle.id
bundle_thumbnail.bundle_id         -> content_bundle.id
```

The schema enforces ownership rather than relying on Worker queries. Artifact and Content bundle expose unique `(id, owner_user_id)` keys. `artifact_version` has composite foreign keys from `(artifact_id, owner_user_id)` to Artifact and from `(content_bundle_id, owner_user_id)` to Content bundle. Fingerprint aliases use the same `(content_bundle_id, owner_user_id)` composite foreign key.

Each active Content bundle fingerprint alias has a unique `(owner_user_id, content_identity_revision, fingerprint_key_revision, reuse_fingerprint)` key. Each active raw-input alias is additionally scoped by `requested_entry_key`, policy revision, and processing revision. `requested_entry_key` is non-null; the empty string denotes automatic Entry file selection because a valid explicit path is non-empty. Both constraints are partial unique indexes where `retired_at IS NULL`; rotation may map multiple key revisions to one bundle, but only one active alias can own a matching identity and revision tuple.

A Content bundle moves through `creating`, `ready`, and `deleting`. It separately records `healthy`, `suspect`, or `corrupt` integrity. Reference insertion locks the bundle and rechecks that it is ready and healthy and still owns active aliases. An integrity transition to suspect or corrupt atomically retires every active raw-input and bundle-identity alias before another processing attempt may create a replacement. Existing Versions keep their original reference.

A repaired bundle may return to healthy and reactivate its aliases only when no replacement owns the active uniqueness keys. Otherwise it remains readable to existing Versions but ineligible for new reuse.

The creating row reserves identity before object promotion and records `creator_attempt_id`, its Lease, and every attempt-specific object prefix. Only the current creator may mark it ready. An expired creator Lease lets a later processing attempt take over with a new object prefix, while every losing or abandoned prefix remains eligible for durable cleanup.

Every processing and thumbnail write attempt also has a durable attempt row that survives bundle-state transitions. It records the object prefix, Lease, hard per-write deadline, terminal state, and cleanup state before the first object write. A Worker checks its Lease before each write and cannot publish metadata after cancellation or expiry.

Version relationships are the liveness source of truth. No mutable reference count authorizes deletion. A derived count may exist for metrics, but Reconciliation verifies the absence of Version references before deleting objects.

## Concurrency

Workers may concurrently expand and hash identical archives. The database uniqueness rule chooses one winning Content bundle:

- the winner commits its bundle metadata and object layout;
- a loser reloads the ready winner, commits its Version reference, and schedules its staging prefix for cleanup;
- a loser never overwrites winner objects;
- a worker that finds a live creating winner waits only for a bounded interval before normal retry policy applies; and
- an expired creating winner can be reclaimed only through the creator-Lease transition.

No distributed lock spans archive processing or object writes. Processing Leases recover crashed attempts, while database transactions and uniqueness constraints decide durable identity.

Transactions that insert a Version or delete an Artifact lock the Artifact first, then every affected Content bundle in ascending bundle-ID order. Serialization failures and deadlock aborts use a bounded idempotent database retry path.

## Object layout

Object keys use opaque, server-generated bundle identifiers:

```text
content-bundles/{contentBundleId}/attempts/{attemptId}/manifest.json
content-bundles/{contentBundleId}/attempts/{attemptId}/files/{normalizedPath}
content-bundles/{contentBundleId}/thumbnails/{rendererRevision}/{thumbnailAttemptId}.webp
```

Hashes and fingerprints never appear in object keys. The ready Manifest references only the winning attempt prefix; losing attempts cannot overwrite it. Raw and attempt staging paths remain Upload-scoped. A successful Version commit makes its raw ZIP and attempt staging objects eligible for immediate bounded cleanup; the current retryable failed Upload retains its raw ZIP.

## Thumbnail reuse

Thumbnail identity is `(contentBundleId, rendererRevision)`. Each Version pins the active renderer revision when it becomes ready, so its Version-shaped thumbnail URL remains immutable. A new renderer revision applies to later Versions and does not redirect existing Version URLs to new bytes.

A ready thumbnail is reused by every Version that references its bundle and pins the same renderer revision. A single bundle-level job is shared while rendering is pending. The Version becomes ready independently and may show the existing neutral placeholder. Runtime time, randomness, or animation inside identical content does not invalidate the cached thumbnail.

The bundle job selects a live referencing Version when it claims each render attempt, then uses the existing Version-authorized internal capture route. If that Version disappears, retry selects another live reference. A renderer revision receives work when the first Version pins it; advancing the revision does not proactively rerender older Versions.

Each render attempt writes an attempt-unique object. The job conditionally publishes one metadata row under its active Lease and the unique `(content_bundle_id, renderer_revision)` key. An expired or losing attempt cannot overwrite winner bytes, and Reconciliation removes its object.

The public management route remains Version-shaped. `/api/versions/{versionId}/thumbnail` authorizes the Version owner and resolves the bundle thumbnail for that Version's pinned revision. Existing private immutable caching remains valid.

## Failure behavior

Reuse is an optimization, never weaker evidence:

- a miss uses full processing;
- incomplete raw-alias evidence retires that alias and records a stable fallback reason before full processing;
- inconsistent bundle metadata or Manifest structure atomically marks the bundle suspect and retires all its active aliases before replacement processing;
- a non-ready or non-healthy bundle is ineligible for reuse;
- fast paths trust the current healthy attestation and immutable private storage instead of rereading and hashing every asset;
- a confirmed missing object or checksum mismatch marks the bundle suspect, retires its active aliases, and blocks later reuse while incident handling verifies or repairs it;
- a database uniqueness conflict reloads the winner and verifies readiness;
- unavailable fingerprint keys, PostgreSQL, or object storage remain explicit infrastructure failures governed by existing retry policy.

An invalid cached candidate never becomes a deterministic Artifact-content validation error. An integrity failure marks the bundle suspect or corrupt and blocks new reuse. Existing Version reads keep their current infrastructure-failure behavior until an explicit incident workflow decides whether to repair or isolate them; the reuse path does not silently repoint or delete them.

## Cleanup

An operation that removes Version relationships, currently permanent Artifact deletion, uses the global Artifact-then-sorted-bundle lock order before changing references. When the final reference disappears, the transaction retires active fingerprint aliases, cancels pending bundle jobs and attempts, records all bundle file and thumbnail prefixes in a durable cleanup intent, and marks the bundle deleting. A concurrent identical Upload may then reserve a new bundle instead of reviving the deleting row.

An abandoned creating bundle follows the same cleanup path only after its creator Lease expires and the source processing job becomes terminal. Reconciliation locks the row before choosing cleanup, so it cannot race a valid takeover. Cleanup does not finalize until all related Leases have expired and a writer-quiescence interval at least as long as the maximum object-write deadline has passed.

Reconciliation repeatedly:

1. confirms no Version reference exists;
2. removes bundle files, attempt prefixes, and all renderer-revision thumbnails idempotently;
3. removes candidate staging and raw objects recorded by the Upload lifecycle; and
4. deletes retired aliases and bundle metadata and marks the intent complete only after object deletion succeeds, while retaining attempt tombstones for the configured orphan-scan horizon.

A failed conditional metadata commit marks its attempt object for cleanup. A periodic bounded storage scan also deletes old attempt prefixes that no winning Manifest or thumbnail metadata references, including objects written late by a stale process after an earlier cleanup pass.

There is no recovery or reuse grace after permanent deletion. Writer quiescence and attempt tombstones exist only to finish deletion safely; they do not authorize reads or restoration. Backups and disaster recovery must restore database relationships and object data to a mutually consistent point; backup policy is outside this change.

## Security and privacy

- Reuse never crosses owning User IDs or deployment boundaries.
- Clients cannot query fingerprints, bundle identity, or whether content already exists.
- The complete Upload is received before raw reuse is considered; a claimed client hash grants no authority.
- Version ownership remains mandatory for Preview, export, and owner thumbnail reads. Viewer access still requires an accessible Publication.
- Opaque object keys and private storage remain mandatory even with keyed fingerprints.
- Logs and metrics never include fingerprints, raw paths, normalized Artifact paths, object keys, or content-derived values.
- A future move to global or organization-scoped reuse requires a new product and security decision; this schema does not enable it implicitly.

## Observability

Operational records classify outcomes as `raw_hash_hit`, `content_bundle_hit`, `dedup_miss`, or `dedup_fallback`. Aggregates measure avoided expanded bytes, avoided file writes, avoided Chromium renders, ready latency, fallback reason codes, cleanup backlog, and oldest cleanup age. They do not expose per-User content identity.

## Adoption boundary

The implementation uses a destructive pre-production transition: clear existing Artifact database records and their raw, staging, committed, and thumbnail objects before enabling the new schema and object layout. It provides no backfill, dual-read period, or legacy-key compatibility; migration `0012_content_bundle_foundation.sql` owns the database transition.

The later 16:9 thumbnail transition is also pre-production and destructive. Stop API, Worker, and Reconciliation writers; clear Artifact-domain rows plus raw, staging, Version, Content bundle, and thumbnail objects; apply `0013_artifact_thumbnail_16_9.sql`; then deploy API and Worker together with `ARTIFACT_RENDERER_REVISION=renderer-v2`. Before reopening traffic, require both readiness checks and verify a fresh Upload creates one `800x450` thumbnail under its bundle and pinned revision. Rollback while traffic remains closed removes post-transition Artifact data and objects, restores the database snapshot, and redeploys the previous matching API and Worker revision; after traffic opens, correction uses a forward migration and a new renderer revision rather than redirecting immutable Version thumbnail bytes.
