# Publish and Unpublish explicit Versions

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Add atomic Publish and Unpublish commands. Let terminal users select an Artifact and ready Version while requiring explicit identifiers in non-interactive calls. Preserve the stable Share link and keep expiration independent from Publication state.

User stories covered: 32–39 and 54–60.

## Acceptance criteria

- [ ] Publish accepts an explicit Artifact and ready Version or resolves both through terminal selectors.
- [ ] Non-interactive Publish never infers the latest Version and fails when either required identifier is absent.
- [ ] Publish atomically changes the current Publication only after ownership and ready-Version validation.
- [ ] Publishing the already current Version succeeds without creating a different business result.
- [ ] Publish does not create or alter Share-link expiration.
- [ ] Unpublish accepts an explicit or interactively selected Artifact and removes only the current Publication.
- [ ] Repeated Unpublish has the same result and requires no destructive confirmation.
- [ ] Human and selected-field outputs clearly report the resulting Owner-external access state.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover authorization, state gates, idempotency, and output.

## Blocked by

- [01-list-artifacts-with-gh-style-output](./01-list-artifacts-with-gh-style-output.md)
