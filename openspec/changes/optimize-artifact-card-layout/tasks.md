# Optimize Artifact Card Layout Tasks

## 1. Baseline and Contract Tests

- [x] 1.1 Review and archive `reuse-artifact-content-bundles`, then confirm the synchronized `artifact-thumbnail` spec uses Content bundle plus renderer-revision identity before changing thumbnail dimensions.
- [x] 1.2 Add failing Worker tests for a `1440x810` Chromium viewport and exactly decoded `800x450` WebP output without crop, letterbox, or distortion.
- [x] 1.3 Add failing database and repository tests for the `800x450` metadata constraint and one immutable thumbnail per Content bundle and `renderer-v2`.
- [x] 1.4 Add failing Web tests for the centered `1920px` page bound, `20px` gap, `310px` minimum tracks, 16:9 preview-only region, independent footer, placeholder geometry, and unchanged card actions.

## 2. Thumbnail Contract and Persistence

- [x] 2.1 Add a checked forward migration that requires the destructive pre-production Artifact cleanup, replaces the current thumbnail dimension constraint with exactly `800x450`, and leaves historical migrations unchanged.
- [x] 2.2 Mirror the new dimensions in the Drizzle schema, Worker thumbnail completion metadata, API repository fixtures, Worker PostgreSQL fixtures, and every dimension assertion.
- [x] 2.3 Change Worker capture to `1440x810` and proportional output to `800x450`, preserving one Chromium render, isolation, reduced motion, readiness sequencing, timeout classification, and attempt cleanup.
- [x] 2.4 Record representative lossless WebP byte sizes for fixed visual fixtures and document the result; do not add a lossy encoder or multiple stored variants without measured evidence and a separate decision.

## 3. Renderer Revision Cutover

- [x] 3.1 Advance `ARTIFACT_RENDERER_REVISION` defaults and examples from `renderer-v1` to `renderer-v2` in `.env.example`, Docker Compose, Kubernetes configuration, API tests, Worker tests, and end-to-end fixtures.
- [x] 3.2 Add or update tests proving a later Version pins `renderer-v2`, does not reuse an earlier renderer revision's bytes, and still shares one `renderer-v2` thumbnail across same-User Versions of the same Content bundle.
- [x] 3.3 Update the destructive cutover and rollback documentation to stop writers, clear Artifact-domain rows and Artifact-owned objects, apply the new migration, deploy matching API and Worker revisions, and smoke-test a fresh `renderer-v2` upload before reopening traffic.

## 4. Artifact Grid Layout

- [x] 4.1 Center the complete Artifacts Page in a `1920px` maximum-width container and change Grid view to `repeat(auto-fill, minmax(310px, 1fr))` with a `20px` gap while leaving List view behavior unchanged.
- [x] 4.2 Refactor each grid card so only its preview owns the 16:9 aspect ratio and its `60-64px` metadata footer remains outside that ratio.
- [x] 4.3 Keep thumbnail, neutral placeholder, Status, menu, Preview, Full-screen Preview, Publish, selection, long-name display, and keyboard behavior within the new geometry without cropping or layout movement.
- [x] 4.4 Update grid skeletons to reserve the same preview-plus-footer dimensions as loaded cards.

## 5. Documentation and Acceptance

- [x] 5.1 Update `docs/design/modules.md` and other current design references from `1440x900` and `480x300` thumbnail rendering to the new 16:9 `1440x810` and `800x450` renderer contract without changing the Web UI's default `1440x900` acceptance viewport.
- [x] 5.2 Run focused Web, API, Worker, database, typecheck, Rust format, Clippy, and test suites; keep Grid/List preference, Content bundle reuse, Preview, Full-screen Preview, Publish, and Delete regressions green.
  - Web (154), API (225), API account-entry contract, Rust workspace, and the real-Chromium thumbnail tests pass. The final containerized Artifact-flow rerun was blocked before execution by Docker Hub returning HTTP 502 for pinned Node and Debian base-image metadata; no product test failed.
- [x] 5.3 Run Playwright at `1280x720`, `1440x900`, `1512x982` DPR 2, `1728x1117` DPR 2, `1920x1080`, `2560x1440`, and `3840x2160`; assert expected three-to-five column counts, `1920px` content cap, no horizontal overflow, stable action placement, and complete 16:9 thumbnails.
- [x] 5.4 Inspect the captured screenshots for thumbnail clarity, sparse-row sizing, footer separation, long names, placeholders, selection mode, and 4K whitespace; fix any visual regression without adding mobile or density-selector scope.
- [x] 5.5 Run `openspec validate optimize-artifact-card-layout --strict`, `openspec validate --all --no-interactive`, `mise run check`, and `git diff --check`, and record any unrelated environment failure separately rather than weakening a gate.
  - Both OpenSpec validations and `git diff --check` pass. `mise run check` reaches documentation link validation and is blocked only by three pre-existing broken links under `.agents/skills/cloudflare/`; change-owned Markdown, spelling, and links pass.
