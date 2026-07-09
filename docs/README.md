# Documentation Map

How ShareSlices documentation is organized: who owns which facts, how conflicts are resolved, and what each lifecycle class means. Every durable document change should respect this map.

## Ownership

One fact has exactly one owner. Other documents link to the owner; they never copy the content.

| Document | Exclusively owns | Lifecycle |
| --- | --- | --- |
| `CONTEXT.md` | Glossary: product and system terminology | durable |
| `PRODUCT.md` | Product policy, boundaries, limits, roadmap | durable |
| `AGENTS.md` | Engineering discipline: decidable rules for building | durable |
| `docs/design/` | Target architecture: modules, seams, interface sketches | evolving |
| `api/openapi/` | The HTTP contract: built behavior plus behavior the active change builds | evolving |
| `openspec/specs/` | Implemented requirements per capability | living |
| `openspec/changes/` | One change: proposal, design, tasks, delta specs | disposable |

Lifecycle classes:

- **durable** — always true; edited directly, carefully.
- **evolving** — describes intent that converges on code; sections carry status markers (`target` / `current`); once built, code wins and the document is updated to match.
- **living** — written only by the OpenSpec archive sync (`/opsx:archive`), never edited by hand during a change.
- **disposable** — belongs to one change; archived with it; never referenced by durable documents.

## Precedence

When documents disagree, the higher document wins. To make the lower one win, change the higher one first.

- Product line: `PRODUCT.md` > `openspec/specs/` > `openspec/changes/`
- Engineering line: `AGENTS.md` > `docs/design/` > `openspec/changes/`

A change that needs to deviate from `PRODUCT.md`, `AGENTS.md`, or `docs/design/` updates that document in the same change, with the reason recorded in the change's `design.md`.

## Rules

- Reference direction is one-way: lower documents may link upward; durable documents never link into `openspec/changes/`.
- OpenSpec artifacts must not duplicate durable documents. A change's `design.md` records decisions local to that change; anything durable moves up.
- `api/openapi/` may document reserved behavior ahead of implementation (contract-first), but every reserved element must be named and excluded explicitly in the active change's delta spec or `design.md` — never left ambiguous.
- Contract tests exercise every documented response of `api/openapi/` except those explicitly reserved.
- Terminology in any document follows `CONTEXT.md`. New terms introduced by a change are added to `CONTEXT.md` when the change is archived.

## Consistency gates

`mise run check` enforces what it can mechanically:

- `tools/check-doc-refs.mjs` — every `mise run <task>` mentioned in a durable document must exist in `.mise.toml`. Disposable documents (`openspec/changes/`) are exempt: they may describe tasks they are about to create.
- `tools/check-doc-links.mjs` — relative Markdown links must resolve to existing files.
- `openspec validate` — active changes must be structurally valid.
