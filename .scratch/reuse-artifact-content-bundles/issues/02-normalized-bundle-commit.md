# 02 — Commit normalized content through one Content bundle

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Make full Worker processing calculate canonical normalized identity, atomically reserve or reuse one same-User Content bundle, publish attempt-isolated objects, and commit a distinct Version reference for every successful Upload.

## Acceptance criteria

- [ ] Canonical identity is stable across ZIP order, compression, timestamps, wrapper removal, and ignored operating-system metadata.
- [ ] Entry file, normalized path, content, content type, byte size, or identity revision changes produce a different identity.
- [ ] Concurrent equivalent Uploads create one ready bundle and distinct ready Versions.
- [ ] A creating bundle can be reclaimed only after its creator Lease expires.
- [ ] Losing and stale attempts cannot overwrite winner objects or publish metadata and are durably eligible for cleanup.
- [ ] Equivalent content owned by different Users creates separate bundles.
- [ ] Full-processing misses and validation failures preserve existing reports and retry behavior.
- [ ] PostgreSQL and object-storage integration tests prove physical reuse rather than relying on response shapes.

## Blocked by

- 01 — Establish the Content bundle contract and persistence foundation.
