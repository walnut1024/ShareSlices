# List Artifacts with GitHub CLI-style output

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Add the first complete Artifact command path: list the current Owner's Artifacts with bounded Server pagination, useful filters, concise terminal output, and GitHub CLI-style selectable formatting. Establish the shared Artifact selector and output behavior that later targeted commands can reuse without binding a local directory to a remote Artifact.

User stories covered: 27–31 and 54–60.

## Acceptance criteria

- [ ] `artifact list` returns owned Artifacts ordered by recent modification and defaults to a limit of 30.
- [ ] `--publication`, `--processing`, and `-L/--limit` are validated locally and represented in the checked Server contract.
- [ ] The CLI follows Server pagination internally until it reaches the requested limit or exhausts the results.
- [ ] Human-readable output includes identifiers, names, processing state, Publication state, expiration, and modification time.
- [ ] `--json <fields>`, `--jq`, and `--template` follow GitHub CLI formatting behavior and reject unsupported fields.
- [ ] Interactive Artifact selection uses the same bounded listing behavior; prompt-disabled and non-TTY calls never wait for input.
- [ ] Progress and diagnostics stay on stderr, `--no-progress` suppresses transient output, and exit codes follow the documented conventions.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover the behavior without asserting private implementation details.

## Blocked by

None - can start immediately
