# Permanently delete an Artifact safely

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Add permanent Artifact deletion with GitHub CLI-style safety. Terminal users can select and confirm an Artifact; automation can skip the prompt only by supplying both the explicit Artifact ID and `--yes`. Preserve clear behavior when processing is active or a network result is indeterminate.

User stories covered: 49–54 and 57–60.

## Acceptance criteria

- [ ] Delete accepts an explicit Artifact ID or an interactive Artifact selection.
- [ ] Delete prompts for confirmation unless both an explicit ID and `--yes` are present.
- [ ] `--yes` is ignored when the Artifact ID is omitted, preventing unconfirmed deletion of a selected resource.
- [ ] Delete is rejected while the Artifact is accepted or processing.
- [ ] Successful deletion removes the Artifact, Versions, Publication, Share link, and all associated raw, staging, and committed objects.
- [ ] Another user cannot discover or delete the Artifact.
- [ ] Network failure is reported as indeterminate without unsafe automatic repetition.
- [ ] Human output, errors, and exit codes clearly distinguish success, cancellation, authentication, state conflict, and uncertain failure.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover confirmation, authorization, state gates, object cleanup, and repeated requests.

## Blocked by

- [01-list-artifacts-with-gh-style-output](./01-list-artifacts-with-gh-style-output.md)
