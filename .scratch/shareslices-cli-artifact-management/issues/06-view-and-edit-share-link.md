# View and edit Share-link expiration

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Add `artifact share view` and `artifact share edit` so an Owner can read the stable Share link and its effective access state, set a future expiration, or restore permanent expiration without changing Publication.

User stories covered: 40–43 and 54–60.

## Acceptance criteria

- [ ] Share view accepts an explicit or interactively selected Artifact and reports URL, Publication state, expiration, and effective accessibility.
- [ ] Share view returns the stable link even when the Artifact is Unpublished or the link is expired.
- [ ] Share edit accepts an RFC 3339 future instant or `never` and validates input before mutation.
- [ ] Prompt-disabled Share edit requires an explicit Artifact and expiration value.
- [ ] Expiration editing neither Publishes nor Unpublishes the Artifact and never rotates its Share slug.
- [ ] Human output and selected JSON fields use stable names and do not expose object-storage URLs or credentials.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover permanent, future, expired, Unpublished, unauthorized, and invalid-input behavior.

## Blocked by

- [01-list-artifacts-with-gh-style-output](./01-list-artifacts-with-gh-style-output.md)
