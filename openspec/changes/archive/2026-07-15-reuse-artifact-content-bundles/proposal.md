# Reuse Artifact Content Bundles

## Why

Repeated Uploads can currently expand, store, and render the same normalized Artifact content more than once. ShareSlices needs same-User Content bundle reuse so each Upload still creates its own immutable Version while duplicate processing, object writes, and Chromium rendering are avoided when equivalence is proven.

## What Changes

- Add private same-User reuse for complete validated and normalized Content bundles; do not reuse across Users or deduplicate individual files.
- Keep every non-idempotent Upload as a distinct Version and make reuse invisible through management and Viewer HTTP contracts.
- Add an exact-raw fast path and a normalized-content path, both with safe fallback to full processing.
- Share thumbnail work by Content bundle and renderer revision while preserving Version authorization and Version-shaped thumbnail URLs.
- Delete shared bundle objects only after their final Version reference disappears, with durable cleanup and stale-attempt recovery.
- Replace persisted plain content-derived lookup digests with keyed aliases and encrypted durable Upload idempotency evidence.
- **BREAKING**: use a destructive pre-production Artifact-data transition to the new schema and object layout, with no backfill, dual read, or legacy object compatibility.

## Capabilities

### New Capabilities

- `artifact-content-reuse`: Define same-User Content bundle identity, reuse, isolation, concurrency, integrity, and cleanup behavior.

### Modified Capabilities

- `artifact-upload`: Allow additional ready Versions, preserve Upload idempotency without a public digest contract, and define transparent fallback from reuse.
- `artifact-thumbnail`: Reuse one immutable thumbnail per Content bundle and renderer revision while retaining Version-scoped access.

## Impact

- PostgreSQL Artifact, Version, Upload, idempotency, asset, thumbnail, attempt, alias, and cleanup records.
- Hono Upload intake, Artifact repositories, Version content resolution, thumbnail resolution, and Reconciliation.
- Rust Worker processing, canonical identity, job commit, object layout, thumbnail rendering, and cleanup orchestration.
- Private S3-compatible raw, staging, Content bundle, Manifest, thumbnail, and orphan-attempt objects.
- API, Worker, OpenSpec, and end-to-end test gates; public OpenAPI resource shapes remain unchanged.
