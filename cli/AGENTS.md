# CLI engineering guidance

Inherits [repository-wide guidance](../AGENTS.md) and owns rules specific to `cli/**`.

## Boundary

- Keep the CLI as a Rust single-binary client of the checked ShareSlices HTTP contract.
- Keep authentication, local input selection, packaging, transfer progress, safe retries, and HTTP calls in the CLI.
- Keep account, authorization, Artifact lifecycle, Publication state, and final validation on the Server.
- Do not access ShareSlices databases or object storage directly.
- Implement shortcut commands as orchestration over the same Server APIs used by stepwise commands. Do not create a second lifecycle path or bypass Server validation.

## Output and contracts

- Keep default output readable for the audience defined in [PRODUCT.md](../PRODUCT.md).
- Expose machine-readable results only through an explicit structured-output flag.
- Consume routes and fields defined by [api/openapi/](../api/openapi/); do not infer undocumented Server behavior.
- Retry only operations whose contract makes retry safety explicit.

## Verification

- Update command-line tests with changes to flags, defaults, output fields, prompts, exit behavior, or retry semantics.
- Run `mise run cli-test` for CLI changes.
