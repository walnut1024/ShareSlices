# CLI Artifact Management Design

## Context

The browser-authorized Rust CLI and the Server Artifact lifecycle already share the checked management API. Artifact commands must remain thin client orchestration: the CLI resolves explicit or interactive input, packages and transfers bytes, and presents results; the Server remains authoritative for ownership, processing, Publication, Share-link, export, and deletion policy.

## Goals / Non-Goals

**Goals:**

- Provide one GitHub CLI-style `artifact` command group with interactive assistance and deterministic non-interactive behavior.
- Keep local packaging, progress, formatting, and safe filesystem writes inside the CLI.
- Reuse the same owner-scoped Server APIs for browser, interactive CLI, and agent-driven CLI use.
- Preserve mutation idempotency and make uncertain outcomes explicit rather than guessing or retrying unsafe operations.

**Non-Goals:**

- Compound upload-and-publish shortcuts or implicit local-to-remote bindings.
- AK/SK authentication, plaintext credential fallback, or direct Skill-to-REST integration.
- Client-side replacement of Server archive validation, authorization, or lifecycle policy.
- Version pruning, Share-link rotation, or manual Share-link revocation.

## Decisions

- **One atomic resource command group.** `artifact list`, `upload`, `publish`, `unpublish`, `share view`, `share edit`, `export`, and `delete` map to explicit resource operations. This keeps agent automation composable and avoids hidden lifecycle transitions.
- **Interaction is an adapter.** Commands accept explicit identifiers non-interactively and use a shared injected interaction seam only when prompts and a terminal are available. `--yes` skips Delete confirmation only with an explicit Artifact ID.
- **Input shape selects upload preparation.** One ZIP is transferred unchanged; all other selected files/directories are deterministically packaged under an explicit or inferred common root. The CLI waits for ready or terminal failure after Server acceptance.
- **Output is command-specific.** Human output is the default. `--json <fields>`, `--jq`, and `--template` expose stable selected fields. Progress is stderr-only and disabled with `--no-progress`.
- **Filesystem writes are atomic.** Export downloads into a same-directory temporary file, refuses an existing destination unless `--clobber` is explicit, and renames only after a complete response.
- **Server policy remains authoritative.** Every request carries CLI version and OS metadata, ownership is resolved from the Session, and the Server validates Version state, Publication, Share expiration, and deletion eligibility.
- **Deletion cleanup is resumable.** The database transaction removes the Artifact graph and records object-cleanup work; runtime reconciliation retries raw, staging, and committed object deletion without making the CLI retry an uncertain DELETE.

## Risks / Trade-offs

- **Long processing can look stalled** → show transfer progress and a processing stage on stderr; allow agents to suppress it.
- **Interrupted mutation may have succeeded** → retry only idempotent upload operations and report Delete transport/5xx results as indeterminate.
- **Interactive behavior can block automation** → require complete explicit input whenever prompts are disabled or stdin is not a terminal.
- **Multiple client-side checks can drift from Server policy** → treat them as usability checks only and retain Server validation plus checked OpenAPI/YAML contracts.
