# Refine Artifacts Page management design

## Context

The high-fidelity frontend specification defines grid, list, first-use empty, batch-entry, and batch-selection states for the Artifacts Page. The current Web surface already receives per-Artifact state-valid actions and uses single-Artifact Publish and Delete requests. Reusing those contracts keeps the backend as the business source of truth and avoids a second batch mutation model.

`PRODUCT.md` already defines permanent Artifact deletion as removal of its management record, Versions, Publication, Share link, and raw, staging, and committed objects. This change does not weaken or duplicate that policy. It also preserves the existing Version model.

## Goals / Non-Goals

**Goals:**

- Match the approved desktop information hierarchy and density for grid, list, and empty states.
- Keep grid and list as two views over one filtered Artifact collection and one selection state.
- Let Owners batch Publish or Delete only when every selected Artifact is eligible.
- Explain blocked actions and partial results explicitly through Sonner.
- Preserve state-valid single-Artifact actions and permanent cleanup behavior.

**Non-Goals:**

- Batch Export, Unpublish, retry, rename, or replace-file operations.
- New batch API endpoints, cross-Artifact database transactions, or rollback of successful operations.
- Changes to Version, Publication, deletion cleanup, object storage, or OpenAPI contracts.
- Pagination, account-synchronized view preferences, or mobile and tablet layouts.

## Decisions

### Use one browse model for grid and list

Grid is the default first-use view. The browser stores the Owner's last grid or list choice locally; this preference is not account data. Search performs a case-insensitive Artifact-name contains match and the existing filters continue to classify processing and Publication state. Grid cards use an auto-filling minimum width near 220 pixels so the wider shell adds columns instead of stretching cards indefinitely.

List rows contain selection, Artifact name, processing state, Publication state, last modified time, and actions. Activating a row opens the Artifact detail page; activating its checkbox or action controls does not navigate. The list does not add thumbnails because `PRODUCT.md` limits the first thumbnail UI to grid cards.

### Distinguish empty collection from empty results

An Owner with no Artifacts sees the high-fidelity first-use state with a New artifact action and a drop target that uses the existing creation flow. An Owner whose current search or filter has no matches sees `No artifacts found` and can clear those conditions. Loading and request failure remain distinct states. Upload formats and size limits come from current product behavior rather than copied sample values.

### Share selection across views and filters

Select enters selection mode in both grid and list. Switching views preserves selected Artifact IDs. Search and filter changes may temporarily hide selected Artifacts without deselecting them; the selected count includes those hidden items. Select all and Deselect all apply only to the current filtered results. Closing selection mode or pressing Escape clears selection.

### Validate the entire selection before mutation

Publish and Delete controls remain clickable in selection mode. On click, the Web checks every selected Artifact's current state-valid actions. Publish additionally requires the latest ready Version. If any selected Artifact is ineligible, the Web sends no mutation and uses Sonner `toast.error` to state the action, affected count, and reason. This avoids silent skipping and avoids implying that a mixed selection succeeded.

Batch Export is not rendered. The high-fidelity Export control is intentionally excluded because multiple downloads may be browser-blocked and a server-generated aggregate archive needs separate compute, streaming, and concurrency policy.

### Reuse one Publish choice across eligible Artifacts

Batch Publish opens one dialog and applies the selected expiration policy to every selected Artifact. Each operation publishes that Artifact's latest ready Version and reuses its existing Share link; batch mode does not offer link replacement. Submission prevents duplicate requests and limits execution to three concurrent single-Artifact Publish calls.

Successful calls update their Artifacts. Failed calls remain selected. Sonner summarizes success and failure counts and includes the first concrete failure reason. Completed Publish calls are not rolled back. A fully successful operation exits selection mode; a partial result retains only the failures.

### Confirm and report permanent batch deletion

Batch Delete opens an Alert Dialog naming the selected count and stating that the operation permanently deletes the Artifacts and their Versions, Publications, Share links, and stored files. The destructive confirmation is explicit but does not require typed text. After confirmation, the Web limits execution to three concurrent single-Artifact Delete calls.

A successful API result removes that Artifact from management. Durable cleanup and reconciliation remain backend responsibilities; the Web reports the Artifact as deleted but does not claim that every object was physically removed synchronously. Failed calls remain visible and selected, and Sonner summarizes success and failure counts with the first concrete failure reason. The Web does not automatically retry a failed destructive request.

## Risks / Trade-offs

- **[Risk] State can change after client preflight.** -> Treat server responses as authoritative and report partial results without rolling back successful operations.
- **[Risk] Hidden selected items surprise the Owner.** -> Keep the total selected count visible and scope Select all text to the current filtered result count.
- **[Risk] Multiple requests create load spikes.** -> Cap Publish and Delete orchestration at three concurrent calls.
- **[Trade-off] Batch operations are not atomic across Artifacts.** -> Preserve simple, already tested single-Artifact contracts and make partial results explicit.

## Migration Plan

Add focused interaction tests, implement the browse and empty states, add shared selection state and batch dialogs, then verify both supported desktop acceptance sizes and run the repository quality gate.

## Open Questions

None.
