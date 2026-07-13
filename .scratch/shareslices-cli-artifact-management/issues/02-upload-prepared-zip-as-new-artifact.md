# Upload a prepared ZIP as a new Artifact

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Deliver the narrowest complete Upload path: accept one user-prepared ZIP, create a new Artifact, transfer the archive, wait until the Server commits a ready Version, and return identifiers suitable for the next explicit command. Do not repackage the ZIP or Publish the Artifact.

User stories covered: 1–2, 10–16, 18–26, and 54–60.

## Acceptance criteria

- [ ] One ZIP can be uploaded as a new Artifact with a supplied or interactively resolved name and Entry file.
- [ ] ZIP input cannot be combined with another path and is uploaded without repackaging or content rewriting.
- [ ] Common name and Entry defaults are resolved in the CLI; ambiguity prompts only when a TTY is available.
- [ ] Upload succeeds only after a ready Version is committed and returns the Artifact and Version identifiers.
- [ ] Transfer reports measured byte progress and processing reports a stage or activity indicator without inventing a percentage.
- [ ] `--no-progress` suppresses transient output while preserving final stdout and error diagnostics.
- [ ] Authentication, compatibility metadata, local preflight, terminal processing failure, cancellation, and safe transient retry are externally observable and actionable.
- [ ] Upload never creates a Publication or changes Share-link expiration.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover success and failure behavior.

## Blocked by

None - can start immediately
