# Optimize Artifact Card Layout

## Why

Artifact grid cards remain too small on large desktop viewports, which makes visual content harder to recognize and leaves most of the management surface unused. The thumbnail renderer and card layout also need one deliberate 16:9 contract so larger cards remain sharp on Retina displays without front-end cropping or distorted output.

## What Changes

- Bound the Artifacts Page content width and let its grid add three to five larger columns from the available CSS width rather than from named display classes.
- Give each grid card an independent 16:9 preview region plus a separate metadata footer so the footer never reduces the preview height.
- Change deterministic thumbnail capture from a `1440x900` viewport and approximately `480x300` output to a `1440x810` viewport and approximately `800x450` WebP output.
- Advance the thumbnail renderer revision so the new dimensions never reuse output created under the old rendering contract.
- Preserve Grid/List preference, card actions, selection behavior, placeholders, and the project's desktop-only scope.
- **BREAKING**: clear pre-production Artifact data and Artifact-owned objects before enforcing the new thumbnail dimensions; no old-thumbnail backfill or dual-size compatibility is provided.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-thumbnail`: Change the deterministic capture viewport, immutable thumbnail dimensions, renderer revision adoption, and grid-card preview ratio.
- `artifact-publication`: Define the desktop grid's bounded content width, adaptive column count, card preview/footer geometry, and supported viewport acceptance behavior.

## Impact

- Web Artifact management layout, card skeletons, card thumbnail markup, and focused component and Playwright coverage.
- Rust Worker Chromium capture dimensions, WebP encoding, renderer revision configuration, thumbnail metadata writes, and tests.
- PostgreSQL thumbnail dimension constraints and the destructive pre-production Artifact-data transition.
- API and Worker configuration examples, Docker Compose and Kubernetes deployment configuration, database and repository fixtures, OpenSpec requirements, and current design documentation.
- Public management and Viewer HTTP shapes remain unchanged.
