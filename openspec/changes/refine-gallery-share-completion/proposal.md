# Refine Gallery share completion

## Why

The simplified first-share dialog still turns into a dense Manage Gallery state panel immediately after the Owner confirms. That makes it unclear whether the share action completed and exposes lifecycle detail before it is useful.

## What Changes

- Keep the first-share action to one public-access confirmation with no metadata or Version form.
- Make the confirmation copy plainly state that everyone can view the Artifact in Gallery, while still disclosing download and Save a copy permissions and keeping Share with link separate.
- After the Server accepts the share request, show a dedicated completion state instead of switching into Manage Gallery in the same dialog.
- State accurately that Gallery checks may still be in progress, so acceptance does not promise that the Artifact is already publicly listed.
- Keep Manage Gallery, Update Gallery, withdrawal, unavailable, governance, and irreversible-replacement interactions separate and unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gallery-listing`: Refine the Web first-share confirmation and accepted-submission result so the Owner has a clear click, confirm, and completion flow without implying premature public availability.

## Impact

- Product interaction policy in `PRODUCT.md`.
- `web/src/screens/ArtifactGalleryDialog.tsx` and its focused tests.
- Browser coverage for the first Gallery share flow.
