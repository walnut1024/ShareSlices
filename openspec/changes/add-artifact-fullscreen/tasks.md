# Artifact full-screen implementation tasks

<!-- cspell:ignore fullscreenchange -->

## 1. Product and HTTP Contracts

- [x] 1.1 Update `PRODUCT.md` with the confirmed owner and Viewer full-screen behavior, entry points, exit behavior, and exclusions.
- [x] 1.2 Update the checked OpenAPI Viewer entry contract for the trusted player response and reserved content-mode request without changing the stable Share-link address.
- [x] 1.3 Add failing API route and contract tests for Viewer shell/content-mode responses, relative asset resolution, no-store headers, Publication changes, and non-content states.

## 2. Fullscreen Controller and Owner Player

- [x] 2.1 Add failing Web unit tests for user-activated requests, exit requests, `fullscreenchange`, native/browser-driven exit, rejection, cleanup, and nested Artifact full-screen state.
- [x] 2.2 Implement the focused Fullscreen API controller and reusable `ArtifactPlayer` with shadcn Base UI controls, Lucide icons, accessible names, tooltip, failure status, full-viewport styling, and iframe Fullscreen Permissions Policy.
- [x] 2.3 Add the authenticated route-level `ArtifactPreviewPage`, load the existing ready-Version Preview content route inside the player, and keep normal mode mounted after full-screen exit.
- [x] 2.4 Change grid thumbnail and Artifact detail Preview navigation to open the trusted Preview page in a new tab without an opener while preserving current authorization and feedback behavior.

## 3. Direct Grid Card Full-screen Preview

- [x] 3.1 Add failing Artifact management tests for eligibility, bottom-right control placement, ordinary Preview independence, selection/list exclusions, latest-ready-Version selection, propagation, request failure, and management-state preservation.
- [x] 3.2 Implement the persistent Card maximize action and synchronously request full screen on the connected card player target from the click activation.
- [x] 3.3 Render `ArtifactPlayer` in the full-screen card, clean it up whenever that full-screen session ends, and report rejected requests through Sonner without navigation or retry.

## 4. Public Viewer Player

- [x] 4.1 Implement the fixed trusted Viewer player HTML, styles, maximize/minimize controls, accessible state, Fullscreen API event synchronization, failure feedback, and full-size content iframe in the Hono Viewer adapter.
- [x] 4.2 Add the reserved content-mode entry resolution while keeping `/a/{shareSlug}/`, wildcard manifest assets, effective Version selection, private storage, and relative URL paths unchanged.
- [x] 4.3 Keep Expired, Unpublished, retired, and unknown state pages outside the player and verify that they expose no full-screen control or Artifact metadata.
- [x] 4.4 Update Viewer route tests and OpenAPI coverage until all player, raw content, asset, status, caching, and authorization cases pass.

## 5. Integration and Verification

- [x] 5.1 Extend the desktop Playwright flow to cover Card entry, ordinary Preview, accessible Viewer, enter/exit controls, Escape or browser-driven exit where supported, and retained management state.
- [x] 5.2 Manually verify user-Artifact scripts, relative HTML/CSS/JavaScript paths, Artifact-owned full screen, repeated enter/exit, rejected requests, Expired, and Unpublished behavior at `1440x900`.
- [x] 5.3 Update `docs/design/modules.md` to match the implemented owner-player and Viewer HTTP-adapter shape, without adding a new domain Module.
- [x] 5.4 Run focused Web and API tests, typechecks, builds, `openspec validate add-artifact-fullscreen --strict`, and `mise run check`; resolve every change-related failure.
