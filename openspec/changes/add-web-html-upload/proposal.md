# Add Web HTML upload

## Why

The Web creation dialog currently requires users with a single self-contained HTML artifact to create a ZIP before upload. The browser can perform that packaging without changing the established server upload and processing contracts.

## What Changes

- Let Web users choose or drop one `.html` or `.htm` file in addition to a ZIP.
- Package a selected HTML file as a ZIP containing a root `index.html` before preflight and upload.
- Continue deriving the initial Artifact name from the filename selected by the user.
- Explain that single-file HTML upload does not collect referenced local assets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-upload`: Add a Web-only HTML input adapter while preserving the ZIP server contract.

## Impact

- Affected code: `web/src/screens/CreateArtifactDialog.tsx`, the Artifacts empty-state upload copy, and focused Web tests.
- Affected product contract: `PRODUCT.md` upload input behavior.
- No API, OpenAPI, database, CLI, Worker, Viewer, or mobile-layout changes.
