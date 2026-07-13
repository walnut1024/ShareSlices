# Middle-truncate Artifact card names

## Why

Grid cards currently use end truncation, which hides the final portion of long Artifact names where dates, versions, and distinguishing suffixes often appear.

## What Changes

- Display long names on grid cards with a preserved head and tail separated by a single ellipsis.
- Show the complete name in a tooltip.
- Keep list view, detail view, stored names, search, and navigation semantics unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-publication`: Define how the grid card preserves identifying parts of long Artifact names.

## Impact

- Affected code: `web/src/screens/ArtifactsPage.tsx` and focused Artifact management tests.
- No API, storage, CLI, or product-policy changes.
