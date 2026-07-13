# Add Artifact thumbnails

## Why

Artifact grid cards currently show the same neutral placeholder for every ready Artifact, so Owners cannot visually distinguish content without opening Preview.

## What Changes

- Generate an immutable thumbnail asynchronously for each ready Version without delaying or changing ready, Preview, Publication, or Share behavior.
- Render committed Version content in isolated Chromium with no external network access and a narrowly scoped internal capture grant.
- Store and serve the thumbnail through private Version-scoped storage and an owner-authorized API.
- Show the latest ready Version thumbnail only on Artifact grid cards, retaining the current placeholder while unavailable or after terminal failure.

## Capabilities

### New Capabilities

- `artifact-thumbnail`: Define Version thumbnail generation, isolation, lifecycle, access, and grid-card presentation.

### Modified Capabilities

None.

## Impact

- Affected surfaces: PostgreSQL migrations, Rust Worker job/runtime modules, private object storage, internal API rendering, management API contracts, Artifact list projection, and the Web Artifact grid.
- Deployment impact: Worker images include a pinned Chromium runtime and enforce a thumbnail-specific concurrency limit.
- No new backend service or runtime is introduced.
