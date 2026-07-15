# Optimize Artifact Card Layout Design

## Context

The Artifacts Page currently fills the management shell width and creates grid tracks from `minmax(220px, 1fr)`. At the supported desktop sizes this produces small visual previews, while sparse collections occupy only a small corner of a large surface. Each card also places its preview and footer inside one `8:5` aspect-ratio box, so metadata reduces the actual preview height.

Thumbnail capture currently launches Chromium once at `1440x900`, captures the viewport, resizes the image exactly to `480x300`, and stores a lossless WebP. The active `reuse-artifact-content-bundles` change moves thumbnail identity to `(contentBundleId, rendererRevision)` and is complete but not yet archived. This change depends on that archive so its thumbnail delta applies to the final bundle-owned requirement instead of competing with another active modification of the same capability.

ShareSlices supports desktop browsers only, with `1280x720` as the minimum Web viewport and `1440x900` as the default design viewport. Display marketing classes and physical pixels are not layout inputs: CSS viewport width controls grid geometry, while thumbnail source dimensions provide sufficient density for Retina displays.

## Goals / Non-Goals

**Goals:**

- Keep Artifact previews recognizable from the minimum desktop viewport through 4K displays and browser scaling.
- Use one end-to-end 16:9 thumbnail contract without front-end cropping, letterboxing, or geometric distortion.
- Keep the grid at three to five columns with cards approximately `310-392` CSS pixels wide across the supported acceptance matrix.
- Provide one approximately 2x thumbnail source for cards up to about `400` CSS pixels without creating multiple stored variants.
- Preserve Content bundle reuse, renderer-revision pinning, card actions, Full-screen Preview, selection, search, filters, and list view.
- Make the pre-production renderer transition explicit and verifiable.

**Non-Goals:**

- Mobile or tablet layouts, touch behavior, or widths below `1280` CSS pixels.
- User-selectable grid density or card-size controls.
- Multiple thumbnail resolutions, `srcset`, art direction, custom thumbnail selection, or publication thumbnails.
- Re-rendering or redirecting thumbnails for existing Versions.
- Changing Preview, Viewer, Publication, object authorization, or public HTTP resource shapes.
- Adding a new lossy WebP dependency without measurements showing that current lossless output violates an agreed storage budget.

## Decisions

### Finish the Content bundle change before implementation

Review and archive `reuse-artifact-content-bundles` before applying this change. Its archive makes bundle-owned thumbnail work and renderer-revision pinning the implemented baseline. Expanding that already-complete change was rejected because it explicitly excludes Web management changes and would mix an independently reviewable layout contract into a storage-lifecycle cutover.

### Size the grid from CSS width, not device labels

Wrap the complete Artifacts Page content in a centered `1920px` maximum-width container while retaining the management shell's `32px` side padding. Use a `20px` grid gap and `repeat(auto-fill, minmax(310px, 1fr))` tracks. `auto-fill` preserves empty tracks for sparse collections, so a few cards keep the same scale as a full row instead of stretching across the container.

This produces the following deterministic targets before scrollbar rounding:

| CSS viewport | Available page width | Columns | Approximate card width |
| ---: | ---: | ---: | ---: |
| `1280` | `1216` | 3 | `392` |
| `1366` | `1302` | 4 | `311` |
| `1440` | `1376` | 4 | `329` |
| `1512` | `1448` | 4 | `347` |
| `1728` | `1664` | 5 | `317` |
| `1920` | `1856` | 5 | `355` |
| `2048+` | `1920` maximum | 5 | `368` |

Explicit device-name breakpoints were rejected because browser zoom, operating-system scaling, and Retina DPR change the relationship between physical resolution and CSS viewport width.

### Separate preview geometry from card metadata

Move the aspect-ratio wrapper inside the Card so it encloses only the visual preview. The preview uses `16:9`; the footer remains an independent `60-64px` region. Status, selection, menu, Full-screen Preview, and Publish controls remain overlays or controls at their existing semantic positions. Loading skeletons reserve the same preview-plus-footer geometry.

Keeping `8:5` was rejected because the product has chosen a more conventional wide visual-browser cover. Cropping a `16:10` source or resizing it non-proportionally was rejected because either can remove or distort Artifact content.

### Render and store one matching 16:9 image

Change Chromium's fixed capture viewport to `1440x810`, then resize proportionally to exactly `800x450`. The Worker still starts Chromium and renders the Artifact once per thumbnail attempt. It does not first create a `16:10` image, crop, letterbox, or stretch it.

One `800x450` object covers cards up to about `400` CSS pixels at DPR 2 while avoiding the storage, metadata, cleanup, and HTTP-selection complexity of separate 1x and 2x variants. The current lossless WebP encoder remains initially because flat UI captures may compress efficiently and the existing Rust image dependency does not expose lossy WebP quality. Record representative output sizes during implementation; a different encoder is a later measured optimization rather than an implicit dependency expansion.

### Advance and deploy the renderer contract atomically

Advance `ARTIFACT_RENDERER_REVISION` from `renderer-v1` to `renderer-v2` in API and Worker examples, Compose defaults, Kubernetes configuration, and configuration tests. A later Version pins `renderer-v2` and receives independent bundle thumbnail work; a Version pinned to `renderer-v1` is never silently redirected.

The repository is pre-production and old Artifact data will be cleared, so there is no backfill or dual-size read path. Add a new checked migration rather than editing historical migrations. The migration assumes the operator has stopped writers and cleared Artifact-domain rows and Artifact-owned objects, then replaces the current thumbnail dimension constraint with exactly `800x450`.

### Verify layout and pixel density separately

Component tests assert semantic behavior and stable geometry classes; Worker tests decode the output and assert exactly `800x450`; database tests assert the matching constraint and metadata. Playwright verifies column counts, no horizontal overflow, stable footer geometry, and unchanged actions at `1280x720`, `1440x900`, `1512x982` with DPR 2, `1728x1117` with DPR 2, `1920x1080`, `2560x1440`, and `3840x2160`. The high-DPR cases verify source clarity and layout without treating DPR as a layout breakpoint.

## Risks / Trade-offs

- **[Risk] An Artifact responds differently to the shorter `1440x810` viewport.** → Treat that result as the chosen thumbnail contract; Preview and Viewer remain unchanged and continue rendering in their actual windows.
- **[Risk] `800x450` lossless WebP objects consume materially more storage than current thumbnails.** → Reuse one object per Content bundle and renderer revision, record representative byte sizes, and require measured evidence before adding a lossy encoder or multiple variants.
- **[Risk] API and Worker deploy with different renderer revisions.** → Update every default and fixture together, keep readiness validation, and make matching revision values a pre-cutover checkpoint.
- **[Risk] A migration encounters surviving `480x300` rows.** → Stop the cutover, clear Artifact data and its private objects as specified, then rerun; do not weaken the new dimension constraint.
- **[Trade-off] A `1920px` cap leaves large margins on a 4K display at 100% scaling.** → Prefer a stable five-column scanning surface; list view remains available when density matters more than visual recognition.
- **[Trade-off] A single `800x450` source is larger than necessary on DPR 1.** → Accept the simpler immutable object lifecycle for the first sharp-card contract and revisit responsive variants only with measured bandwidth pressure.

## Migration Plan

1. Review and archive `reuse-artifact-content-bundles`; validate that the main `artifact-thumbnail` requirement now owns Content bundle and renderer-revision behavior.
2. Stop API, Worker, Reconciliation, and external Artifact traffic in the pre-production environment.
3. Delete Artifact-owned database rows and raw, staging, Version, Content bundle, and thumbnail objects using the existing destructive-transition procedure.
4. Apply the new checked thumbnail-dimension migration and verify Artifact-domain tables remain empty with the `800x450` constraint installed.
5. Deploy API and Worker together with `ARTIFACT_RENDERER_REVISION=renderer-v2`; require both readiness checks to pass before reopening traffic.
6. Upload a fresh Artifact, wait for its thumbnail, and verify one bundle-level `renderer-v2` object with `800x450` metadata, owner-authorized delivery, and immutable caching.
7. Verify the grid and actions across the desktop acceptance matrix, then run the repository quality gates.

Rollback before traffic reopens by stopping writers, deleting post-migration Artifact objects and rows, restoring the database snapshot, and redeploying the previous API and Worker configuration. After traffic opens, correction requires a forward migration and another renderer revision; existing Version thumbnail bytes remain immutable.

## Open Questions

None. Lossy encoding or responsive thumbnail variants require measured storage or transfer evidence and are intentionally outside this change.

## Implementation Measurements

On 2026-07-15, the fixed Chromium integration fixtures produced valid lossless `800x450` WebP outputs of 324 bytes for a flat delayed-load page and 2,654 bytes for the isolated page with text and blocked resources. These deliberately simple fixtures prove that the existing encoder remains compact for flat UI content but do not establish a production percentile; no new lossy encoder dependency is justified by this sample.
