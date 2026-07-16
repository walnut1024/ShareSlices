# Standardize Web shadcn and Base UI presentation

## Why

ShareSlices already configures shadcn `base-nova` with Base UI as the sole primitive stack, but several Web surfaces still bypass that system with native controls, hand-built cards and states, incomplete component composition, and hard-coded neutral colors. The inconsistency makes Gallery, account entry, device authorization, and Artifact management harder to maintain and visually divergent, so the Web layer needs a controlled presentation-only standardization that proves existing behavior and performance remain intact.

## What Changes

- Standardize Web controls, forms, status feedback, empty states, cards, menus, and identity presentation on the existing local shadcn components backed by Base UI.
- Correct verified shadcn composition and accessibility defects, including ordinary native action buttons, incomplete Field composition, ungrouped composite items, missing dialog titles or Avatar fallbacks, incomplete Card structure, invalid Base UI custom-trigger usage, non-semantic colors, and non-conforming layout utilities. Each rule will be traced to the checked project configuration, current component documentation, or the repository's shadcn workflow rather than mislabelled as an underlying Base UI runtime requirement.
- Refactor Gallery administration and Creator profile presentation into the same visual language as Artifact management, including shell, hierarchy, spacing, density, semantic tokens, and state presentation, without changing authorization, governance, revision, upload, or notification behavior.
- Preserve the current navigation boundary: the ordinary management navigation does not expose an Admin entry, while the existing authorized administration route remains directly reachable.
- Normalize account-entry, password-recovery, verification, and CLI device-authorization presentation to semantic design tokens while preserving their routes, request ordering, timers, and state transitions.
- Normalize Artifact status, detail metadata, and player feedback while retaining the specialized full-card selection target, untrusted-content iframe, Preview canvas, and Full screen behavior.
- Add focused behavior locks, a source-aware interface conformance gate, targeted visual checks, and a reproducible build and browser benchmark with durable in-code exceptions for specialized content and hit-target primitives.
- Do not add another primitive stack, change the `base-nova` preset, alter HTTP contracts, or introduce new product behavior.

## Capabilities

### New Capabilities

- `web-interface-consistency`: Defines the new user-observable consistency and accessible state-presentation outcome across ShareSlices management surfaces. Existing product workflows remain owned by their current capabilities.

### Modified Capabilities

None. Existing account, Artifact, Gallery, Viewer, and CLI authorization behavior remains unchanged.

## Impact

- Affected code is limited to Web presentation, focused Web tests, Web end-to-end coverage, Web-owned conformance and measurement tooling, and the root package-script wiring that adds the conformance gate to the existing quality pipeline.
- The existing `web/components.json`, local shadcn source components, Base UI dependency, API clients, routes, product contracts, and backend code remain unchanged. A discovered behavior or contract defect is recorded separately and is not fixed inside this presentation change.
- No runtime dependency or service will be added. Production bundle size, deterministic request counts, and named interaction timings will be compared with machine-readable before and after evidence captured by the same harness.
