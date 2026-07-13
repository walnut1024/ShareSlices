# Simplify Artifact upload dialog

## Why

The Web creation dialog asks users to name an Artifact before selecting a ZIP even though the ZIP filename already provides a useful default. Removing that duplicate decision makes initial upload a direct file-first action while preserving Rename for later corrections.

## What Changes

- Remove the Artifact name field from the Web creation dialog.
- Derive the submitted Artifact name from the selected ZIP filename by removing the final `.zip` extension, trimming it, and applying the existing 120-character limit.
- Keep ZIP preflight, progress, validation feedback, API input, CLI behavior, and post-upload Rename unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-upload`: Specify that the ShareSlices Web UI derives the initial Artifact name from the selected ZIP filename instead of asking for a separate name.

## Impact

- Affected code: `web/src/screens/CreateArtifactDialog.tsx` and focused Artifact management tests.
- Affected contract: Web behavior within the existing `artifact-upload` capability.
- No API, OpenAPI, database, CLI, worker, Viewer, or mobile-layout changes.
