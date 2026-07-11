# Artifacts page card and page naming design

## Goal

Make the Artifact grid card match the current high-fidelity design and replace the ambiguous `Screen` suffix in production Web code with names that describe actual routing and layout roles.

## Scope

- Rename route-level React components from `*Screen` to `*Page`:
  - `ArtifactListScreen` to `ArtifactsPage`
  - `ArtifactDetailScreen` to `ArtifactPage`
  - `LoginScreen` to `LoginPage`
  - `RegisterScreen` to `RegisterPage`
  - `DeviceAuthorizationScreen` to `DeviceAuthorizationPage`
- Rename `AuthScreenLayout` to `AuthLayout` because it is a reusable layout, not a route.
- Update imports, exports, current architecture references, and affected tests.
- Add a frontend naming rule to `AGENTS.md`: route-level Web components use the `*Page` suffix; reusable containers use role-specific suffixes such as `*Layout`, `*Shell`, `*Section`, or `*Panel`; do not introduce `*Screen` names.
- Refine only the grid branch of the Artifact collection item to match `docs/high-fidelity/ShareSlices Artifacts.dc.html`.

Historical plans remain unchanged because they document file names at the time they were written.

## Artifact card design

The grid card remains a shadcn Base UI composition built from `Card`, `CardContent`, `CardFooter`, `Button`, `Badge`, `DropdownMenu`, and `Tooltip`.

The card keeps the existing information and actions:

- Clicking the card opens the Artifact page.
- Ready Artifacts expose Preview and Share actions.
- The overflow menu exposes the currently allowed Open, Export, Rename, and Delete actions.
- Processing, failure, ready, and shared states remain derived from existing Artifact data.

Visual changes are limited to fidelity adjustments visible in the high-fidelity source: neutral one-pixel border, restrained resting shadow, stronger hover elevation without layout movement, 132-pixel preview area, compact translucent action controls, status treatment, and tighter title and modified-time footer spacing. No new interactions, data, responsive behavior, or dependencies are introduced.

The list-view item is not redesigned.

## Component structure

The collection route is named `ArtifactsPage` because it represents `/artifacts`; `grid` and `list` remain view-mode values inside that page. The single-resource route is `ArtifactPage` because it represents one Artifact at `/artifacts/:artifactId`.

The existing grid item may remain an internal function in `ArtifactsPage` unless the implementation shows that separating it materially improves readability. No reusable abstraction is required for a single caller.

## Verification

- Run the targeted Artifact management test suite.
- Run the Web TypeScript check.
- Run the repository local quality gate.
- Search production Web code and current architecture documentation to confirm no `*Screen` component or file names remain.
- Inspect the rendered grid at the project viewport of `1440x900` and compare the card against the supplied high-fidelity reference.

