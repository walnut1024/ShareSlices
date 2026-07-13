# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
└── docs/adr/
```

## Before exploring, read these

- **`CONTEXT.md`** at the repository root.
- **`docs/adr/`** — read ADRs that touch the area being changed.

If either location does not exist, proceed silently. Do not create it upfront; create domain vocabulary or ADRs only when a decision requires them.

## Use the glossary's vocabulary

When naming a domain concept in an issue, refactor proposal, hypothesis, or test name, use the term defined in `CONTEXT.md`. Do not drift to a synonym the glossary explicitly avoids.

If a needed concept is absent, either reconsider the new term or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
