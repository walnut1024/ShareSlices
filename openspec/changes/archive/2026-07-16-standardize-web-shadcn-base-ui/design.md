# Standardize Web shadcn and Base UI design

## Context

The Web project already declares `base-nova` in `web/components.json`, uses Tailwind CSS v4 and Geist, and carries local shadcn source components backed by `@base-ui/react`. The durable component-stack and viewport rules remain owned by `web/AGENTS.md`; this disposable change records only the scope, sequencing, exceptions, and evidence needed for this refactor.

The current audit found presentation drift in `VerificationCodeForm.tsx`, `AuthLayout.tsx`, `LoginPage.tsx`, `SignUpPage.tsx`, `PasswordResetPage.tsx`, `DeviceAuthorizationPage.tsx`, `GalleryAdministrationPage.tsx`, `GalleryProfilePage.tsx`, `ArtifactStatus.tsx`, `ArtifactPage.tsx`, and `ArtifactPlayer.tsx`. The public Gallery listing, Creator page, and Gallery detail already establish the target direction and must remain aligned with Artifact management. The ordinary management navigation already omits an Admin entry; this change must not restore one.

These components also orchestrate authentication, verification timers, governance decisions, profile revision checks, file upload, Artifact selection, Full screen, and isolated iframe behavior. The refactor therefore changes presentation and component composition only. Existing workflow requirements remain owned by their current OpenSpec capabilities and are referenced as regression boundaries rather than restated as new requirements.

## Goals / Non-Goals

**Goals:**

- Keep public Gallery listing, detail, and Creator surfaces aligned with Artifact presentation while aligning Gallery management and Creator profile surfaces with Artifact management in shell, hierarchy, spacing, density, semantic tokens, and reusable state presentation.
- Converge audited ordinary controls and presentation structures on the existing local shadcn components and their Base UI semantics.
- Preserve routes, navigation visibility, API calls, payloads, authorization, timers, state transitions, focus order, and user-visible outcomes.
- Replace audited raw palette choices with existing semantic tokens except at named specialized content boundaries.
- Make loading, empty, success, warning, error, status, identity, and data presentation consistent and accessible.
- Establish reproducible, machine-readable behavior, conformance, visual, request-count, bundle-size, and interaction evidence.

**Non-Goals:**

- Changing product behavior, wording policy, HTTP contracts, persistence, server state, API clients, route selection, or backend code.
- Adding or restoring an Admin navigation item. The existing authorized `/admin/gallery` route remains directly reachable but undiscoverable from ordinary management navigation.
- Switching the shadcn preset, overwriting local shadcn source, adding another primitive library, redesigning the token system, or adding a runtime dependency.
- Replacing specialized primitives when an ordinary styled component would break semantics, including the Artifact card's transparent selection target, file Dropzone, untrusted-content iframe, and Full screen content canvas.
- Changing geometry, hierarchy, or behavior merely to satisfy a stylistic rewrite. Equivalent utility normalization and meaningful shadcn composition are in scope when the checked rule applies.
- Broadly redesigning layouts or adding mobile and tablet support.

## Decisions

### Keep engineering rules in their durable owner

`web/AGENTS.md` remains the authority for shadcn, Base UI, Tailwind, semantic tokens, and supported desktop viewports. The new delta specification describes only the user-observable consistency and accessible state-presentation outcome introduced by this change. It does not create a second owner for account entry, CLI authorization, Gallery governance, Artifact management, upload, Viewer isolation, or viewport policy.

Existing capability behavior is protected through tests and task acceptance criteria. If the implementation discovers a product or contract defect, the defect is recorded and handled in a separate scoped fix or artifact update; it is not silently folded into this presentation change.

### Distinguish Base UI runtime contracts from shadcn composition conventions

Implementation will compose the checked local components under `web/src/components/ui/` according to their installed APIs, current shadcn/Base UI documentation, and the repository's shadcn workflow. Base UI custom triggers use `render` and set `nativeButton={false}` when the rendered element is not a button; forms use Field composition; labels, descriptions, errors, disabled state, and pending state remain associated with their controls; dialogs have accessible titles; Avatars have fallbacks; component icons use the configured Lucide library and `data-icon` contract.

The underlying Base UI `SelectItem` can operate without group context, but this change follows the shadcn composition convention and places Select, Dropdown Menu, and other group-based items in their matching group. This is recorded as a shadcn consistency rule, not falsely described as a Base UI runtime prerequisite. Cards are decomposed into meaningful header, title, description, action, content, and footer regions instead of dumping structured content into a single container; empty parts are never added solely to make the JSX look complete.

Updating the preset was rejected because it would overwrite reviewed local source and mix an upstream upgrade with a behavior-preserving refactor. Business-source conformance follows the shadcn workflow's checked style rules: gap layout replaces `space-*`, equal width and height pairs use `size-*`, conditional or merged classes use `cn()`, built-in variants precede component style overrides, and overlay components do not receive manual z-index values. These conversions must preserve computed geometry and behavior and must not trigger adjacent layout redesign.

### Refactor only audited business surfaces and named exceptions

The implementation scan covers all Web business source outside `web/src/components/ui/`, but edits remain limited to verified findings. The primary presentation batches are:

1. Gallery administration and Creator profile.
2. Account entry, verification, password recovery, and CLI device authorization.
3. Artifact status, detail metadata, and Player feedback.

The already-aligned public Gallery listing, Gallery detail, and public Creator surfaces remain in the conformance scan, visual comparison, and regression suite; they are changed only if a verified rule violation remains. Ordinary application surfaces use semantic tokens and appropriate local components. Fixed dark Player and Preview canvases remain explicit exceptions because they frame arbitrary Artifact content and Full screen presentation. The transparent full-card selection button remains an exception because a visually styled Button would change the hit target and conflict with nested controls. The upload Dropzone and isolated iframe also retain their specialized semantics.

Each durable exception is recorded beside the conformance checker under `web/scripts/` with the source path, rule, and reason, and is protected by a focused test. Change-local before and after evidence may refer to that checked configuration but is not its owner.

### Lock behavior before each presentation batch

Existing tests are mapped before adding coverage; new assertions are added only for uncovered behavior. Each batch locks its current accessible actions, request count and order where meaningful, payload, revision or idempotency evidence, timers, state transitions, and terminal outcomes before rendering changes begin.

The full functional browser suite runs at the default 1440 by 900 viewport. Targeted reachability and overflow smoke tests cover each affected shell at 1280 by 720. This avoids duplicating the entire integration matrix while still proving the minimum supported desktop viewport. The navigation tests explicitly assert that Gallery and Creator-profile access remain available and that no ordinary Admin menu entry appears.

### Review visual consistency with a named state matrix

Visual review uses fixed mocked fixtures and deterministic after screenshots for `artifact-grid-loaded`, `artifact-detail-loaded`, `gallery-listing-loaded`, `gallery-detail-loaded`, `public-creator-loaded`, `gallery-admin-loaded`, `gallery-profile-loaded`, `account-login`, `account-verification`, and `device-authorization-confirmation`. Every state is captured at 1440 by 900; the seven Artifact and Gallery states also receive targeted 1280 by 720 reachability and overflow captures. Because presentation editing began before the screenshot harness existed, the checked matrix records the source audit as the pre-change evidence and marks before screenshots unavailable rather than recreating or mislabelling post-change images.

`evidence/visual-review.md` records the route, fixture, viewport, before path, after path, automated overflow result, reviewed shell boundary, hierarchy, typography, control scale, spacing rhythm, card density, state presentation, intentional public-versus-management navigation difference, and pass or fail result for each state. Screenshots remain under ignored `output/playwright/`; the checked review matrix retains their deterministic names and conclusions without committing image binaries.

### Add a source-aware conformance gate with tested exceptions

A Web-owned conformance script will scan business source and fail on rules that can be determined reliably: imports from an unapproved primitive stack, raw ordinary action buttons outside the checked exception configuration, non-semantic palette classes outside named content-canvas exceptions, `space-*`, equal width and height pairs, manual conditional class expressions, manual overlay z-index values, and icon sizing overrides inside shadcn components. JSX-ancestry rules cover Field composition, grouped items, dialog titles, Avatar fallbacks, Card regions, and Base UI `render` usage where source-aware analysis is reliable; focused component tests cover the interaction semantics that static source cannot prove.

The checker includes positive, negative, and exception fixtures plus a report-only mode used to capture the initial finding set without weakening the gate. It is exposed through a Web package script at the start of the change and added to the root quality gate only after all unapproved findings are resolved. Its exception configuration is durable Web code, not an OpenSpec evidence file. It requires meaningful composition and equivalent utility normalization but does not require empty Card regions, change valid specialized primitives, or infer runtime accessibility from text matching alone.

### Measure performance through one reproducible harness

Before presentation code changes, the change adds and verifies a reusable measurement harness. The build collector runs `pnpm --dir web run build` and records each emitted JavaScript and CSS asset's raw and gzip bytes plus totals. The browser collector serves that exact `web/dist` output through a loopback Vite preview process, intercepts all scenario API responses with fixed fixtures, uses headless Chromium and a 1440 by 900 viewport, and has no live API dependency for these named scenarios:

- Gallery listing reaches its stable loaded state and opens the Report dialog.
- Gallery administration reaches loaded queue and notification states.
- Creator profile reaches its loaded form state.
- Account entry reaches login and verification states.
- CLI device authorization reaches account confirmation.
- Artifact management reaches a stable collection and opens an ordinary action surface.

Each browser scenario has an explicit route and stable end locator in a checked manifest. Deterministic Playwright workflows record their request boundaries, supported viewports, overflow results, and screenshots. The build collector writes environment metadata and asset sizes to `interface-before.json` and `interface-after.json`. The initial build was captured before presentation edits, but no valid initial browser timing run exists; `interface-after.json` therefore records post-change browser acceptance and the missing timing baseline explicitly. The reusable collectors, manifest, and smoke tests remain under Web ownership after the change is archived.

The completed change adds no runtime dependency or request. Production JavaScript gzip growth may not exceed the larger of 1 percent or 5 KiB, and production CSS gzip growth may not exceed the larger of 2 percent or 2 KiB. Browser acceptance fails if request counts exceed the locked workflow expectation, horizontal overflow appears, or the deterministic suite fails. A timing regression percentage is reported only when a valid pre-change capture exists. Any threshold breach requires correction or an explicit design update with measured justification before implementation is marked complete.

## Risks / Trade-offs

- **Risk: presentation refactors change form submission, focus, or request ordering** → Lock uncovered behavior before each batch and retain handlers and API calls unchanged.
- **Risk: standardized wrappers break full-card clicks, Full screen, or iframe sizing** → Preserve the named specialized boundaries and run their focused component and browser tests.
- **Risk: Gallery drifts again or Admin navigation reappears** → Capture Gallery and Artifact comparison screenshots and keep an explicit navigation assertion in the regression suite.
- **Risk: a static rule produces false positives or misses JSX semantics** → Check only source facts the tool can determine, test the checker, and use focused interaction tests for component semantics.
- **Risk: performance results reflect local noise** → Use the same production build mode, fixed fixtures, browser version, warm-up, run count, measurement interval, and noise floor before comparing evidence.
- **Trade-off: a few raw primitives and fixed colors remain** → Retaining semantics-specific, tested exceptions is preferable to forcing ordinary visual components into roles they do not fit.

## Migration Plan

1. Add the conformance and measurement harnesses, map existing coverage, add only missing behavior locks, and capture before evidence.
2. Correct verified component composition and accessibility defects without mechanical repository-wide rewrites.
3. Refactor Gallery administration and Creator profile, then verify their behavior, navigation boundary, target screenshots, and minimum-viewport smoke checks.
4. Refactor account entry and CLI device authorization, then verify every locked stage and outcome.
5. Normalize Artifact status, detail tokens, and Player feedback while retaining tested specialized boundaries.
6. Run focused tests after each batch, then run the full Web unit suite, default desktop end-to-end suite, targeted minimum-viewport checks, root quality gate, conformance audit, and before/after performance comparison.

Each presentation batch is locally reversible because it does not migrate data or contracts. Rollback consists of reverting that batch while retaining its tests and reusable gates. No deployment sequencing or backend rollback is required.

## Open Questions

None. The implementation uses the checked component configuration, audited surface list, existing behavior contracts, named exception boundaries, and explicit evidence protocol above.
