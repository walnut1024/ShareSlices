# Worker engineering guidance

Inherits [repository-wide guidance](../AGENTS.md) and owns rules specific to `worker/**`.

## Runtime boundary

- Keep the Worker as a separate Rust and Tokio process that claims durable jobs.
- Keep Upload intake, account behavior, authentication, authorization, and Publication policy in the API application layer.
- Keep performance-sensitive Artifact processing and thumbnail work in the Worker, following the current ownership recorded in [docs/design/modules.md](../docs/design/modules.md).
- Do not embed Rust into the Hono API through native addons, foreign function interfaces (FFI), or request-time subprocesses.
- Keep database and object-storage clients behind Worker interfaces.

## Processing discipline

- Do not load a complete archive or expanded Artifact into memory.
- Use bounded readers and buffers, temporary files when seeking is required, and streaming object-storage writes.
- Put an explicit concurrency bound around parallel object writes and other resource-heavy work.
- Validate archive paths before extraction or object writes.
- Use unique attempt identities and staging locations so one attempt cannot overwrite another attempt's uncommitted output.
- Make job claim, lease, heartbeat, completion, failure, and Version commit transitions retry-safe and idempotent.
- Commit ready state only after required objects and manifest data are durable.

## Cross-runtime contracts

- Coordinate with the API through checked migrations, durable job states, object-key layouts, manifest shapes, and Version commit records; do not import API implementation code.
- Update both adapters and add cross-runtime coverage when a shared contract changes.
- Change the shared contract instead of duplicating API-owned business decisions in Rust.

## Verification

- Run `mise run rust-check` for Worker changes.
- After changing the Worker binary or image, run `mise run dev`; the canonical startup rebuilds and replaces the Worker before local integration checks.
