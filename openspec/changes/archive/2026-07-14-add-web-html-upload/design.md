# Add Web HTML upload design

## Context

The API and Worker accept ZIP input, while the Web app already depends on `fflate` for archive preflight. A self-contained HTML file can be adapted to the existing contract entirely in the browser. HTML that references separate local files is not self-contained and cannot be completed from a single selected file.

This change updates `PRODUCT.md` because it changes user-visible upload behavior. It does not change the server architecture or interfaces in `docs/design/modules.md`.

## Goals / Non-Goals

**Goals:**

- Accept one `.html` or `.htm` file in the Web creation dialog.
- Package selected HTML bytes under the root path `index.html` before existing ZIP preflight and upload.
- Preserve the selected filename as the source of the initial Artifact name.
- Keep the API and Worker ZIP-only.

**Non-Goals:**

- Collecting files referenced by HTML.
- Rewriting HTML URLs or content.
- Supporting HTML input in the API, CLI, or Replace file flow.
- Supporting additional archive formats.

## Decisions

### Adapt HTML at the Web boundary

The dialog converts selected HTML to an `application/zip` `File` before calling the existing preflight and upload functions. ZIP selections pass through unchanged. The generated archive contains exactly one root entry named `index.html`, so the Worker receives its existing canonical input shape.

### Keep the user-selected file as dialog state

The dialog displays and validates the original selection. It derives the Artifact name by removing the final case-insensitive `.zip`, `.html`, or `.htm` extension. The generated ZIP is an upload implementation detail and is not shown as the selected filename.

### Package asynchronously

Use the asynchronous `fflate` ZIP API so compression does not synchronously block the Web interface. Run policy preflight and archive-size validation against the generated ZIP because that is the actual transferred input.

## Risks / Trade-offs

- **[Risk] Referenced local assets are missing.** → Label HTML support as self-contained and state that local assets are not collected.
- **[Risk] Packaging can fail before upload.** → Keep the dialog open and show the packaging error through the existing upload error surface.
- **[Trade-off] Web and other clients accept different source selections.** → Keep one stable server ZIP contract and treat Web packaging as a client convenience.

## Migration Plan

Add focused tests, implement the Web adapter, then run Web tests, TypeScript, the repository quality gate, and strict OpenSpec validation.

## Open Questions

None.
