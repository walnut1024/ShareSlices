# Documentation map

This map defines who owns each ShareSlices fact, how to resolve conflicts, and how each document changes over time. Every durable document change must follow it.

## Ownership

Each durable fact has one owner. Other documents link to that owner. Scoped guidance may state concrete implementation consequences but must not copy mutable policy or contract details.

| Document | Exclusively owns | Lifecycle |
| --- | --- | --- |
| `CONTEXT.md` | Glossary: product and system terminology | durable |
| `PRODUCT.md` | Product policy, boundaries, limits, roadmap | durable |
| Root and scoped `AGENTS.md` files | Repository-wide and subtree-specific engineering discipline | durable |
| `docs/agents/` | Repository adapters for issue, triage, and domain-document skills | durable |
| `docs/design/` | Current and target architecture: modules, seams, interface sketches, with status markers | evolving |
| `api/openapi/` | The HTTP contract: built behavior plus behavior the active change builds | evolving |
| `openspec/specs/` | Implemented requirements per capability | living |
| `openspec/changes/` | One change: proposal, design, tasks, delta specs | disposable |

Lifecycle classes:

- **durable**: always true; edited directly, carefully.
- **evolving**: describes intent that converges on code; sections carry status markers (`target` / `current`); once built, code wins and the document is updated to match.
- **living**: written only by the OpenSpec archive sync (`/opsx:archive`), never edited by hand during a change.
- **disposable**: belongs to one change; archived with it; never referenced by durable documents.

## Conflict resolution

When documents disagree, follow the document that owns the subject. Update that owner before changing dependent documents or code.

- Product behavior: `PRODUCT.md` > `openspec/specs/` > `openspec/changes/`
- Repository-wide engineering, cross-runtime boundaries, and security: root `AGENTS.md` > `docs/design/` > `openspec/changes/`
- Delegated subtree implementation: applicable scoped `AGENTS.md` > `docs/design/` > `openspec/changes/`

An OpenSpec change that needs to alter a durable owner updates that owner in the same change and records the reason in its `design.md`.

Scoped `AGENTS.md` files inherit root guidance and own only delegated subtree implementation. A scoped rule that contradicts a root-owned subject is a documentation defect; fix the owner instead of resolving the conflict by file proximity. `docs/agents/` configures reusable engineering skills; it does not own runtime implementation rules.

## Rules

- Reference direction is one-way: lower documents may link upward; durable documents never link into `openspec/changes/`.
- OpenSpec artifacts must not duplicate durable documents. A change's `design.md` records decisions local to that change; anything durable moves up.
- `api/openapi/` may document reserved behavior ahead of implementation (contract-first), but every reserved element must be named and excluded explicitly in the active change's delta spec or `design.md`; never leave it ambiguous.
- Contract tests exercise every documented response of `api/openapi/` except those explicitly reserved.
- Terminology in code and durable documents follows `CONTEXT.md`. An active change may propose candidate terms. Add accepted terms to `CONTEXT.md` before using them in code or durable documents and before `/opsx:archive`.

## Consistency gates

Durable documentation must satisfy these stable invariants:

- Every `mise run <task>` named in a durable document exists in `.mise.toml`. An active change may name a task that the same change adds.
- Relative Markdown links resolve to existing files.
- Active OpenSpec changes pass structural validation.
