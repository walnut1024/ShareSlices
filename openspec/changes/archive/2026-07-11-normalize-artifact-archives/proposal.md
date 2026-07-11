# Normalize Artifact Archives

## Why

Users commonly create ZIP files with operating-system tools rather than a future ShareSlices CLI. macOS archives can include metadata files that are not Artifact content, and generated reports or presentations often name their only HTML page after the document instead of `index.html`. Rejecting these deterministic cases makes users repair packaging details that ShareSlices can handle safely.

The current failure projection also collapses specific validation failures into broad summaries. Web, CLI, and direct API users need stable structured issues that identify the affected file, violated rule, relevant limits, and corrective action.

## What Changes

- Ignore known macOS metadata after path safety checks and before Artifact content validation.
- Remove one unambiguous wrapper directory while preserving relative paths.
- Continue to prefer a root `index.html`, but use the only root HTML file when no `index.html` exists.
- Reject missing or ambiguous entry pages instead of guessing.
- Persist and expose structured validation issues and non-blocking normalization warnings.
- Keep Worker validation authoritative while allowing Web and future CLI clients to perform policy-aligned preflight.

## Capabilities

### Modified Capabilities

- `artifact-upload`: expand archive normalization, entry-file resolution, validation reporting, and cross-client validation consistency.

## Impact

- `PRODUCT.md`: owns the stable compatibility and validation-feedback policy.
- `worker/`: normalizes safe archive structure and produces structured validation results.
- `api/`: persists and projects validation issues and warnings without exposing raw exceptions.
- `web/`: presents precise validation feedback and performs client preflight where practical.
- Future `cli/`: packages directories predictably and reports the same validation codes before upload where practical.
- `api/openapi/`: defines the management response shapes for structured issues and warnings when implementation begins.
