# CLI Artifact Management Proposal

## Why

ShareSlices has a browser-authorized CLI but lacks a living specification for the Artifact commands agents and users now rely on. The implemented List, Upload, Publish, Share, Export, and Delete flows need one checked contract covering explicit non-interactive use, safe interactive assistance, output stability, and destructive-operation guarantees.

## What Changes

- Add the `shareslices artifact` command group for listing owned Artifacts and selecting resources interactively when prompts are available.
- Upload prepared ZIPs or deterministically package selected local files and directories, then wait for a ready Version or terminal failure.
- Publish an explicit ready Version, unpublish the current Publication, and view or edit the stable Share-link expiration.
- Export an explicit ready Version to an atomic local ZIP with safe overwrite behavior.
- Permanently delete an eligible Artifact only after explicit confirmation, with resumable Server-side object cleanup.
- Provide stable human and selectable JSON output, compatibility metadata, progress suppression, and documented exit codes.

## Capabilities

### New Capabilities

- `cli-artifact-management`: CLI command semantics, interaction rules, output contracts, upload preparation, transfer behavior, and destructive safety for owned Artifacts.

### Modified Capabilities

None.

## Impact

- Rust CLI parsing, interaction, packaging, transfer, formatting, and credential-backed API calls.
- Artifact management, Publication, Viewer export, deletion cleanup, OpenAPI, and YAML/Python HTTP contracts.
- PostgreSQL deletion-cleanup ledger and reconciliation runtime wiring.
- CLI architecture documentation and automated CLI/API/Worker tests.
