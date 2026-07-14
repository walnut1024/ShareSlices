# Reuse Artifact Content Bundles

<!-- cspell:words HMAC -->

Status: ready-for-agent

## Problem Statement

ShareSlices currently expands, validates, stores, and renders each accepted Upload independently even when the same User has already uploaded equivalent Artifact content. Repeated uploads therefore consume avoidable Worker CPU, object-storage capacity, object-write operations, and Chromium rendering time.

The optimization cannot change the product model. Every non-idempotent Upload must still create a distinct immutable Version, ownership and Publication must remain Version-based, and no User may learn whether another User has uploaded equivalent content. Failed or uncertain reuse must never weaken validation or turn an otherwise valid Upload into a reuse-specific error.

## Solution

Introduce an internal immutable Content bundle containing one validated and normalized Entry file, Manifest, and asset set. Versions owned by the same User may reference the same Content bundle when a server-derived private identity proves equivalence.

Use two reuse stages. Exact raw input with compatible validation evidence can skip archive expansion and validation. Otherwise the Worker performs full validation, computes a canonical normalized identity, and either references an existing healthy bundle or atomically creates one. Thumbnail work is shared by Content bundle and renderer revision, while every read continues to authorize a Version.

Keep reuse private. Public HTTP and CLI shapes do not expose bundle IDs, fingerprints, hit state, or object-storage locations. Cross-User content remains physically separate. Permanent deletion removes bundle objects only after the final Version reference disappears.

## User Stories

1. As an Owner, I want every new Upload to create a new immutable Version, so that my Artifact history remains complete even when storage is reused.
2. As an Owner, I want equivalent repeated content to become ready faster when safe, so that I do not wait for redundant processing.
3. As an Owner, I want different ZIP encodings of the same normalized Artifact to reuse stored content, so that compression metadata does not waste storage.
4. As an Owner, I want a changed Entry file to create distinct content, so that the rendered result is never confused with another Version.
5. As an Owner, I want validation warnings preserved for each Upload, so that Version history does not lose processing evidence.
6. As an Owner, I want a reuse miss or uncertainty to fall back to full processing, so that optimization never blocks a valid Upload.
7. As an Owner, I want a newer policy to be enforced before reuse, so that old validation evidence cannot bypass current rules.
8. As an Owner, I want earlier ready Versions and Publications to remain unchanged when a later Upload fails.
9. As an Owner, I want to retry a failed later Upload without replacing an earlier ready Version.
10. As an Owner, I want Preview to authorize the selected Version before serving shared content.
11. As an Owner, I want Export to return the selected Version's normalized files even when another Version shares them.
12. As a Viewer, I want a Published Version to resolve one immutable content set, so that requests never mix shared bundles.
13. As an Owner, I want Version thumbnail URLs and authorization to remain unchanged, so that reuse is invisible in management UI.
14. As an Owner, I want equivalent Versions to reuse a completed thumbnail, so that repeated Chromium rendering is avoided.
15. As an Owner, I want a later renderer revision not to change older Version thumbnail bytes.
16. As an Owner, I want deleting one Artifact to preserve shared content still referenced by another owned Version.
17. As an Owner, I want deleting the final reference to permanently remove the shared content and thumbnails.
18. As a User, I want my content never to be reused by another User, so that account ownership and deletion boundaries remain isolated.
19. As a User, I want Upload responses and timing contracts not to reveal another User's content existence.
20. As a User, I want repeated idempotent requests to return the original result for as long as the idempotency record is retained.
21. As a User, I want reusing an idempotency key with different input to remain a conflict without exposing a content digest.
22. As an operator, I want concurrent equivalent Uploads to create one physical bundle and distinct logical Versions.
23. As an operator, I want expired or crashed attempts recoverable without overwriting winner objects.
24. As an operator, I want confirmed corrupt bundles quarantined before replacement, so that new Versions cannot reference known-bad content.
25. As an operator, I want aggregate avoided-work and cleanup metrics without content fingerprints or User-level content identity.
26. As an operator, I want late stale-writer objects cleaned eventually, so that crashes do not create permanent storage leaks.
27. As an operator, I want missing key material to fail readiness, so that an incomplete deployment cannot silently weaken identity behavior.
28. As a developer, I want one Worker-owned bundle state machine, so that API and Worker cannot commit ready content through divergent rules.
29. As a developer, I want public OpenAPI contracts unchanged, so that existing Web, CLI, and external clients remain compatible.
30. As a developer, I want the pre-production transition to clear legacy data instead of supporting dual layouts, so that the implementation remains bounded and testable.

## Implementation Decisions

- Reuse one complete Content bundle only within one User; reject global, organization, deployment, and file-level reuse.
- Keep Version as the logical immutable history record and Content bundle as private physical content ownership.
- Include content-identity revision, normalized Entry file, and path-sorted asset path, size, server-derived content type, and digest in canonical identity.
- Use separate HMAC domains for raw input and normalized bundle lookup, with current and one previous fingerprint-key revision.
- Store integrity SHA-256 only in private Manifest and object metadata, not relational lookup indexes.
- Store durable Upload idempotency evidence with randomized authenticated encryption and independent key rotation.
- Keep the API responsible for receiving the complete Upload, streaming raw fingerprint candidates, recording the Upload session, and queuing processing.
- Keep the Worker as the only runtime that validates content and commits ready Version references.
- Reserve bundle identity before object publication and use attempt-specific object prefixes and conditional metadata commit.
- Enforce same-User ownership with composite database foreign keys, not only application queries.
- Require ready and healthy state plus active aliases for reuse; retire aliases atomically during quarantine or deletion.
- Derive liveness from Version relationships rather than a mutable reference count.
- Keep Preview, Viewer, export, thumbnail, and internal capture authorization Version-shaped.
- Pin a renderer revision on every ready Version and share one thumbnail job/output per bundle and revision.
- Preserve object-attempt tombstones and scan bounded old prefixes to clean late stale writes.
- Use a destructive pre-production schema and object-layout transition with no backfill or dual read.

## Testing Decisions

- Use Worker integration tests with PostgreSQL and object storage to prove physical reuse, unique winners, distinct Versions, Lease takeover, and cleanup.
- Use pure Worker tests for canonical identity and key-revision vectors.
- Use API database tests for ownership foreign keys, encrypted idempotency evidence, Version resolution, alias retirement, and final-reference deletion.
- Use thumbnail Worker tests for shared jobs, pinned revisions, Version capture selection, and attempt-unique immutable output.
- Use existing public HTTP contract tests to prove multi-Version behavior, authorization, Preview, export, deletion, and non-exposure of reuse internals.
- Keep the existing Web upload-acceptance redirect regression test green; no new reuse UI is introduced.
- Test externally visible behavior at the highest seam and reserve direct table/object assertions for physical reuse invariants that cannot be observed publicly.
- Run focused tests during each ticket and finish with API, Web, Rust, documentation, OpenSpec, and repository-wide quality gates.

## Out of Scope

- Cross-User, organization, team, workspace, deployment, region, or global reuse.
- Individual-file block or chunk deduplication.
- Client-provided authoritative hashes or skipping complete Upload receipt.
- Public reuse status, bundle IDs, fingerprints, object keys, or signed object-storage URLs.
- Rewriting HTML or supporting root-absolute Artifact URLs.
- Automatically rerendering old Versions when renderer revision changes.
- Automatically redirecting Versions away from suspect or corrupt content.
- Production data migration, backfill, dual-read, or rollback that preserves new Artifact data.
- New Web, CLI, Skill, mobile, or tablet user interactions.

## Further Notes

- `PRODUCT.md` remains the owner of Version, Upload, Publication, and deletion behavior.
- `CONTEXT.md` owns the Content bundle definition.
- ADR 0005 owns the same-User complete-bundle decision.
- The target module and persistence design remains in the durable Content bundle design document; the OpenSpec change records only implementation-local decisions.
