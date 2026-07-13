# Upload a new Version and recover interrupted Uploads

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Extend `artifact upload` so an Owner can select or explicitly identify an existing Artifact and upload another immutable Version. Close the retry and recovery path so incomplete temporary input can be replaced safely without overwriting a ready Version or creating a duplicate result for one operation.

User stories covered: 15–25.

## Acceptance criteria

- [ ] `--name` targets a new Artifact and `--artifact` targets an existing Artifact; they are mutually exclusive.
- [ ] Omitting both in a terminal offers a new-versus-existing choice and an Artifact selector; prompt-disabled calls fail.
- [ ] Uploading to an existing Artifact preserves its name, Publication, Share link, and prior Versions.
- [ ] Success returns the newly committed ready Version and does not Publish it.
- [ ] A transient retry for the same incomplete Upload session may replace only its temporary ZIP.
- [ ] A ready Version is immutable and is never overwritten by retry or recovery behavior.
- [ ] Cancellation after Server acceptance does not stop Server processing or claim rollback.
- [ ] Recovery produces enough stable identifiers and guidance for the caller to inspect or retry the explicit Artifact operation.
- [ ] Server ownership, idempotency, state gates, and object cleanup are covered by service and checked HTTP contract tests.
- [ ] Complete CLI-process tests cover explicit, interactive, retry, cancellation, ready, and terminal failure paths.

## Blocked by

- [01-list-artifacts-with-gh-style-output](./01-list-artifacts-with-gh-style-output.md)
- [02-upload-prepared-zip-as-new-artifact](./02-upload-prepared-zip-as-new-artifact.md)
