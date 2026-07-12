# Refine Artifact card and page naming design

## Context

The Vite Web app selects route-level React components in `web/src/App.tsx`. Those components currently use `*Screen` names, while the `/artifacts` route component is additionally named `ArtifactListScreen` even though it supports both grid and list views. The current grid item already composes shadcn Base UI components and implements correct whole-card navigation plus independently clickable quick actions; this interaction boundary must be preserved while aligning its visual treatment with `docs/high-fidelity/ShareSlices Artifacts.dc.html`.

The repository has recently completed and archived the Artifact dashboard, publication, upload, and CLI browser authorization changes. Implementation must use the current files and tests rather than assumptions from older plans or deleted design-file paths.

## Goals / Non-Goals

**Goals:**

- Make route-level component names describe Web pages rather than presentation modes.
- Prevent new `*Screen` component names through a durable frontend rule.
- Bring the Artifact grid card into visual alignment with the current high-fidelity reference.
- Preserve all current Artifact states, actions, navigation, and shadcn Base UI composition.

**Non-Goals:**

- Redesigning the list view, page shell, toolbar, dialogs, or Artifact detail content.
- Changing API contracts, Artifact lifecycle behavior, permissions, or responsive scope.
- Introducing new UI dependencies, primitives, or reusable abstractions without a second caller.
- Rewriting historical archived changes or implementation plans that mention old file names.

## Decisions

### Use resource-oriented `*Page` names for route components

Rename the current route components as follows:

| Current | Replacement |
| --- | --- |
| `ArtifactListScreen` | `ArtifactsPage` |
| `ArtifactDetailScreen` | `ArtifactPage` |
| `LoginScreen` | `LoginPage` |
| `RegisterScreen` | `SignUpPage` |
| `DeviceAuthorizationScreen` | `DeviceAuthorizationPage` |

`ArtifactsPage` uses the plural resource name because it owns the `/artifacts` collection route; `grid` and `list` remain internal view-mode values. `ArtifactPage` uses the singular resource name because it owns one Artifact route. This is preferred over `ArtifactListPage`, which would encode one presentation mode in the route component name.

The shared `AuthScreenLayout` becomes `AuthLayout`. `ManagementShell`, dialogs, and non-route components retain their existing role-specific suffixes.

The self-service account action uses `Sign up` in user-facing copy, `signup` in the Web query route, and `SignUp` in React identifiers. Backend registration terminology, resource-oriented API routes, and administrator-created accounts retain their existing names because they describe different actors and operations.

### Put the naming rule in `AGENTS.md`

Add one rule under Frontend guidance: route-level Web components use `*Page`; reusable containers use their concrete role, such as `*Layout`, `*Shell`, `*Section`, or `*Panel`; do not introduce `*Screen` component or file names. Update the current reference in `docs/design/modules.md` to the renamed device authorization page.

This durable engineering constraint belongs in `AGENTS.md`, not the product contract or capability spec.

### Refine the existing grid branch in place

Keep the grid item internal to `ArtifactsPage` because it has one caller. Continue using the installed Base UI variants of `Card`, `Button`, `Badge`, `DropdownMenu`, and `Tooltip`; do not replace them with hand-written interactive elements.

Match the high-fidelity card through narrowly scoped classes: a neutral one-pixel border, restrained resting shadow, elevated hover shadow without positional movement, the existing 132-pixel preview region, compact translucent controls, state badge placement, and tighter footer typography and spacing. Preserve the absolute whole-card anchor behind controls and the existing pointer-event boundary so card navigation does not capture quick actions or the overflow menu.

The list-view branch is unchanged except for identifiers required by the enclosing component rename.

### Verify behavior before visual fidelity

Extend or adjust the current Artifact management tests only where names or card interaction assertions require it. Run the targeted test and TypeScript check before visual inspection. Render at `1440x900`, the project's default desktop viewport, and compare only the card against the supplied high-fidelity file.

## Risks / Trade-offs

- **[Risk] Mechanical renames can leave stale imports or architecture references.** → Rename files and exported symbols together, then search current production code and current design docs for `Screen` identifiers and run TypeScript.
- **[Risk] Card-level navigation can regress when overlay controls change.** → Preserve the existing anchor/control layering and keep targeted tests for whole-card navigation and independent actions.
- **[Risk] Existing uncommitted high-fidelity and research files could be overwritten.** → Limit edits to the named Web files, `AGENTS.md`, `docs/design/modules.md`, tests, and this OpenSpec change; do not modify unrelated working-tree changes.
- **[Trade-off] Historical plans retain old names.** → Accept stale historical paths because editing archived or point-in-time planning artifacts would misrepresent history.

## Migration Plan

1. Add the durable naming constraint.
2. Rename route and layout files, exports, imports, and the current architecture reference in one mechanical change.
3. Refine the Artifact grid card without changing its behavior or list-view rendering.
4. Run targeted tests, type checking, OpenSpec validation, repository checks, and visual comparison.

Rollback is a source-level revert; there is no persisted data or deployment migration.

## Open Questions

None.
