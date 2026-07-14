# 06 — Reuse thumbnails by Content bundle and renderer revision

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Share one thumbnail job and immutable output for Versions that reference the same Content bundle and renderer revision while keeping Version-shaped authorization and caching.

## Acceptance criteria

- [ ] Each ready Version pins the active renderer revision.
- [ ] One pending job and one completed output exist per bundle and renderer revision.
- [ ] A render attempt selects a live referencing Version and uses its single-use capture grant.
- [ ] Deleting the selected Version before capture retries through another live reference.
- [ ] Attempt-unique objects and active-Lease metadata commit prevent stale overwrite.
- [ ] A new renderer revision does not change older Version thumbnail bytes or URLs.
- [ ] Deleting one of several references preserves the shared thumbnail.
- [ ] Existing owner authorization, placeholder, non-blocking readiness, and private immutable caching behavior remains green.

## Blocked by

- 03 — Resolve shared content through Version authorization.
