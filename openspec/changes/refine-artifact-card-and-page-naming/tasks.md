# Refine Artifact card and page naming tasks

## 1. Lock the naming contract

- [x] 1.1 Add the route `*Page` and reusable-container naming rule to the Frontend guidance in `AGENTS.md`.
- [x] 1.2 Add or update focused test expectations needed to preserve Artifact grid-card navigation and independent quick actions before changing the card.

## 2. Rename route-level Web components

- [x] 2.1 Rename the Artifact collection and detail files, exports, and `App.tsx` imports/usages to `ArtifactsPage` and `ArtifactPage`.
- [x] 2.2 Rename the login, registration, and device authorization files, exports, and `App.tsx` imports/usages to `LoginPage`, `RegisterPage`, and `DeviceAuthorizationPage`.
- [x] 2.3 Rename `AuthScreenLayout` to `AuthLayout`, update its consumers, and update the current device authorization reference in `docs/design/modules.md`.
- [x] 2.4 Search production Web code and current architecture documentation for remaining `*Screen` identifiers; leave historical archived changes and plans unchanged.

## 3. Refine the Artifact grid card

- [x] 3.1 Update only the grid branch in `ArtifactsPage` to match the current high-fidelity card's border, resting and hover shadows, 132-pixel preview, compact translucent controls, state badge placement, and footer spacing and typography.
- [x] 3.2 Preserve the existing shadcn Base UI composition, whole-card anchor layering, independent Preview/Share/menu interactions, state-dependent action visibility, and unchanged list-view branch.

## 4. Verify the change

- [x] 4.1 Run `mise exec -- pnpm --dir web test -- --run src/screens/artifact-management.test.tsx` and keep the targeted tests passing.
- [x] 4.2 Run `mise exec -- pnpm --dir web exec tsc --noEmit` and resolve all rename or type errors.
- [x] 4.3 Run `mise run check` and `mise exec -- openspec validate refine-artifact-card-and-page-naming --strict`.
- [x] 4.4 Render the Artifacts page at `1440x900`, compare the grid card against `docs/high-fidelity/ShareSlices Artifacts.dc.html`, and confirm no page-shell, toolbar, dialog, list-view, mobile, API, or product-policy changes entered the diff.
