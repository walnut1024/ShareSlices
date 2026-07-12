## 1. CLI Resource Commands

- [x] 1.1 Implement bounded Artifact listing with filters and selectable output.
- [x] 1.2 Implement prepared-ZIP and deterministic local-input Upload through ready Version completion.
- [x] 1.3 Implement ready-Version Publish and idempotent Unpublish.
- [x] 1.4 Implement Share-link view and future-or-never expiration editing.
- [x] 1.5 Implement atomic ready-Version Export with safe filenames and overwrite control.
- [x] 1.6 Implement confirmed permanent Delete with cancellation and indeterminate-result handling.

## 2. Server Contracts

- [x] 2.1 Extend owner-scoped Artifact and ready-Version management APIs used by the CLI.
- [x] 2.2 Preserve Publication, Share-link, export, and deletion state gates in application modules.
- [x] 2.3 Add transactional deletion cleanup recording and runtime reconciliation.
- [x] 2.4 Synchronize OpenAPI and YAML/Python HTTP contracts.

## 3. Interaction and Safety

- [x] 3.1 Add a shared interactive selector and deterministic prompt-disabled behavior.
- [x] 3.2 Keep progress on stderr, support `--no-progress`, and expose stable human and selected JSON output.
- [x] 3.3 Send CLI compatibility metadata and map success, failure, cancellation, and authentication exit codes.

## 4. Verification

- [x] 4.1 Cover CLI parsing, production dispatch, interaction, filesystem effects, and HTTP requests with complete-process tests.
- [x] 4.2 Cover API ownership, state transitions, cleanup, OpenAPI, and YAML/Python contracts.
- [x] 4.3 Run formatting, type checks, tests, Clippy, OpenSpec validation, and the repository quality gate.
