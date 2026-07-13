# Package local inputs for Upload

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Extend Artifact Upload to accept non-ZIP local content. Deterministically package a standalone file, one directory, or explicitly selected files and directories into a temporary ZIP, then use the established Upload path unchanged.

User stories covered: 1, 3–14, and 20–22.

## Acceptance criteria

- [ ] A standalone non-ZIP file is packaged alone and never causes sibling files to be collected implicitly.
- [ ] A single directory is packaged without an extra wrapper directory.
- [ ] Multiple files, directories, and CLI-expanded glob patterns are packaged relative to the selected root.
- [ ] Unmatched patterns, inputs outside the root, duplicate effective paths, traversal, links, special files, nested archives, and unsupported inputs fail locally with actionable errors.
- [ ] Known operating-system metadata is ignored consistently with the authoritative Server rules.
- [ ] Archive entries are normalized and path-sorted, and repeated packaging of identical input produces an equivalent package.
- [ ] Entry defaults and interactive selection operate on the packaged effective paths.
- [ ] Temporary ZIP data is streamed, bounded by the active upload policy, and removed after success, failure, or cancellation.
- [ ] The resulting package uses the existing Upload transport, wait-to-ready, output, and Server validation behavior.
- [ ] Complete CLI-process tests exercise real temporary input trees and assert archive requests and user-visible results.

## Blocked by

- [02-upload-prepared-zip-as-new-artifact](./02-upload-prepared-zip-as-new-artifact.md)
