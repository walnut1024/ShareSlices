# 03 — Resolve shared content through Version authorization

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Make Preview, Viewer, export, and internal capture continue to authorize a Version while resolving its files through the referenced Content bundle, with no public contract change.

## Acceptance criteria

- [ ] Owner Preview and export resolve only the selected Version's owned Content bundle.
- [ ] Viewer resolves only the bundle referenced by the currently Published Version.
- [ ] Internal capture grants remain single-use and Version-scoped.
- [ ] A User cannot resolve a Version or bundle owned by another User.
- [ ] Public HTTP and OpenAPI responses expose no bundle ID, fingerprint, hit state, or object key.
- [ ] Version-owned legacy asset and Manifest paths are removed only after every runtime caller uses bundle resolution.
- [ ] Existing Web, CLI, Preview, Viewer, export, and Publication tests remain green.

## Blocked by

- 02 — Commit normalized content through one Content bundle.
