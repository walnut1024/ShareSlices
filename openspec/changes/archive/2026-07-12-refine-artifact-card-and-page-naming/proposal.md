# Refine Artifact card and page naming

## Why

The Artifact dashboard already supports grid and list views, but its route component is named after a list presentation and the grid card does not fully match the current high-fidelity design. Route-level Web components also use the ambiguous `Screen` suffix, which obscures the distinction between pages, layouts, and view modes.

## What Changes

- Refine the Artifact grid card to match the supplied high-fidelity card while preserving its current state-dependent actions and whole-card navigation.
- Rename route-level Web components from `*Screen` to resource-oriented `*Page` names and rename the shared authentication container from `AuthScreenLayout` to `AuthLayout`.
- Add a frontend naming constraint that reserves `*Page` for route-level components and uses role-specific names for reusable UI containers.
- Keep the Artifact list view, API behavior, product state model, and desktop-only scope unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-publication`: Clarify that the Artifact management page presents owned Artifacts in grid and list views and that the grid card exposes only state-valid management actions.

## Impact

- Affected code: `web/src/App.tsx`, route component files under `web/src/screens/`, the shared authentication layout, Artifact management tests, and card styling in the Web frontend.
- Affected documentation: `AGENTS.md` and the current Web module reference in `docs/design/modules.md`.
- No API, database, dependency, mobile-layout, or product-policy changes.
