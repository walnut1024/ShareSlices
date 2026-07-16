# Standardize Web shadcn and Base UI tasks

## 1. Establish Reviewable Baselines and Gates

- [x] 1.1 Create `evidence/interface-audit.md` with the checked `base-nova` configuration, local component inventory, primitive dependencies, every verified business-source finding, and the initial specialized-boundary candidates; identify each finding by file and rule rather than by a repository-wide search-and-replace category.
- [x] 1.2 Create `evidence/coverage-map.md` that maps each affected surface and named workflow to existing unit or browser coverage, then list only the missing behavior assertions that must be added before its presentation batch changes.
- [x] 1.3 Add the missing Gallery administration, Creator-profile, and management-navigation behavior locks, including direct authorized access to `/admin/gallery`, absence of an Admin entry in ordinary navigation, authorization failure, load and empty states, decision payload and revision, profile upload order, avatar removal, revision conflict, and deterministic request counts.
- [x] 1.4 Add the missing account-entry and CLI device-authorization behavior locks, including login, signup, verification, resend countdown, password reset, initial lookup, account ownership, code matching, approve, deny, claimed, expired, dependency-failure, request order, and terminal outcomes.
- [x] 1.5 Add the missing Artifact and public Gallery behavior locks, including full-card selection versus nested actions, Share with link versus Share to Gallery as separate actions, Preview and Full screen, Player canvas and isolated iframe boundaries, upload Dropzone, reporting, and duplicate-request prevention.
- [x] 1.6 Add `web/scripts/check-interface-conformance.mjs`, its checked exception configuration, report-only mode, and positive, negative, and exception tests. Check reliably detectable business-source rules for second primitive-stack imports, raw ordinary action buttons, non-semantic palette classes, `space-*`, equal width and height pairs, manual conditional class expressions, manual overlay z-index values, and component-icon sizing overrides; use JSX-aware checks or focused component tests for Field composition, grouped items, Card regions, dialog titles, Avatar fallbacks, and Base UI `render` usage.
- [x] 1.7 Expose the failing gate as `pnpm --dir web run interface:check`, expose its initial report-only command, and add a root `web:interface-check` script without adding it to the root `check` pipeline until all unapproved baseline findings are resolved.
- [x] 1.8 Add a tested Web build collector, a checked six-scenario browser manifest, and deterministic Playwright acceptance with fixed mocked fixtures, stable end locators, 1440 by 900 coverage, targeted 1280 by 720 coverage, request-boundary assertions, overflow checks, and ignored screenshot output.
- [x] 1.9 Create `evidence/visual-review.md` with the ten-state review matrix and fields defined in `design.md`; capture deterministic 1440 by 900 after screenshots plus the seven targeted 1280 by 720 Artifact and Gallery screenshots under ignored `output/playwright/`, and identify unavailable before screenshots explicitly.
- [x] 1.10 Preserve the genuine pre-edit build collector output in `evidence/interface-before.json`; record the initial source-audit findings as the pre-change visual evidence and state that browser timing and screenshots were not captured before editing.

## 2. Correct Verified Component Semantics

- [x] 2.1 Consult the current documentation and checked local source for each affected installed component and record any component-specific constraint needed by the implementation; confirm that no preset application, source overwrite, second primitive stack, or runtime dependency is required.
- [x] 2.2 Fix verified dialog-title, Avatar-fallback, custom-trigger, form-association, focus, and dismissal defects. Wrap Select, Dropdown Menu, and other group-based items in the matching shadcn group, use Base UI `render` plus `nativeButton={false}` where required, and decompose structured Cards into meaningful regions without adding empty parts.
- [x] 2.3 Replace the ordinary raw buttons in verification and login states with the existing Button component while preserving `type`, accessible name, handler, countdown, disabled or pending state, and keyboard activation.
- [x] 2.4 Retain the transparent Artifact selection button as a checked exception with its source path, rule, reason, and focused interaction test; do the same for any other exception that survives review.
- [x] 2.5 Replace audited fixed neutral palette classes with semantic tokens, `space-*` with geometry-equivalent gap layouts, equal width and height pairs with `size-*`, and conditional or merged class expressions with `cn()` on business surfaces. Preserve fixed dark Player and Preview canvases only as checked content-boundary exceptions and do not redesign adjacent layout.
- [x] 2.6 Normalize affected shadcn component icons to the configured Lucide imports and `data-icon` placement without call-site sizing overrides; preserve standalone icon sizing where no shadcn component owns it.
- [x] 2.7 Run `pnpm --dir web run interface:check` and the focused component tests for every corrected semantic defect before beginning page-level presentation batches.

## 3. Align Gallery Management with Artifact Management

- [x] 3.1 Refactor `GalleryAdministrationPage.tsx` into readable view-only sections that use the existing management shell, Field composition, appropriate Card regions, Badge, Empty, Alert, Separator, and semantic tokens without moving its effect, API calls, decision handler, revision evidence, or local state.
- [x] 3.2 Give Gallery administration explicit loading, empty, loaded, pending, and error presentation without adding a fetch, cache, retry, decision replay, or global state path; keep `/admin/gallery` directly reachable for authorized administrators and do not add or restore an Admin navigation item.
- [x] 3.3 Refactor `GalleryProfilePage.tsx` identity, biography help, avatar presentation, upload, avatar removal, loading, absent-profile, success, pending, and error states with the appropriate Avatar, Field, FieldDescription, Checkbox, Spinner, Empty or Alert compositions and semantic tokens.
- [x] 3.4 Run the Gallery administration and Creator-profile focused tests after each file changes and verify identical authorization, request counts, decision payload, idempotency evidence, profile revision, upload order, removal semantics, and failure outcomes.
- [x] 3.5 At 1440 by 900, complete the paired after screenshots and review-matrix fields for Artifact grid, Artifact detail, public Gallery listing, Gallery detail, public Creator, Gallery administration, and Creator profile; change the already-aligned public surfaces only for verified findings.
- [x] 3.6 At 1280 by 720, run targeted public and management Gallery reachability, focus, clipping, and horizontal-overflow smoke checks, then rerun the isolated Gallery browser suite and confirm that public navigation and governance behavior remain unchanged.

## 4. Standardize Account Entry and Device Authorization

- [x] 4.1 Refactor `AuthLayout.tsx` to semantic shell, surface, foreground, muted, and border tokens while preserving its two-column structure, footer, focus order, and existing account-entry routes.
- [x] 4.2 Refactor `VerificationCodeForm.tsx` and `LoginPage.tsx` typography, feedback, links, and actions with the appropriate Button, Field, Alert, and semantic-token compositions without changing form names, autocomplete, validation, resend timer, handlers, or requests.
- [x] 4.3 Refactor `SignUpPage.tsx` and `PasswordResetPage.tsx` status, progress, help, success, and error presentation with components whose semantics match the state, without changing stage transitions, password rules, verification behavior, or navigation.
- [x] 4.4 Refactor `DeviceAuthorizationPage.tsx` shell, account identity, verification code, pending state, account summary, success, denial, unavailable, and terminal-error presentation while preserving account ownership, code comparison, approve and deny mutation boundaries, session evidence, and terminal guidance.
- [x] 4.5 Run account-entry and device-authorization unit and focused browser tests at 1440 by 900, then run targeted 1280 by 720 reachability, focus-order, clipping, and overflow smoke checks; fix presentation regressions without changing locked behavior.

## 5. Standardize Artifact Presentation and Preserve Specialized Boundaries

- [x] 5.1 Project `ArtifactStatus.tsx` through checked Badge variants and semantic state tokens without changing labels, precedence, allowed actions, or restricted-state meaning.
- [x] 5.2 Normalize `ArtifactPage.tsx` metadata, headings, links, descriptions, separators, and ordinary feedback with semantic tokens and appropriate local presentation components without changing data, actions, or hierarchy.
- [x] 5.3 Refactor `ArtifactPlayer.tsx` error and pending feedback into one reusable accessible presentation while preserving the fixed dark canvas, absolute parent controls, iframe sizing, sandbox, isolated URL, Full screen behavior, and content isolation.
- [x] 5.4 Keep the transparent selection target, upload Dropzone, Preview canvas, Gallery iframe, and other approved specialized primitives in the durable checker configuration with concise boundary reasons and focused tests.
- [x] 5.5 Run Artifact grid, list, detail, batch, Preview, Full screen, upload, Share with link, Share to Gallery, Download, and deletion tests; verify that the two share operations remain separate controls and that no request, selection, confirmation, or outcome changes.

## 6. Prove Full Regression and Performance Acceptance

- [x] 6.1 Run `pnpm --dir web run interface:check`, review every remaining finding or exception against the checked rule and reason, remove stale exceptions, then add `web:interface-check` to the root `check` pipeline only after the standalone gate passes.
- [x] 6.2 Run `mise run web-test` and resolve every failure in the focused behavior locks, component semantics, checker tests, and existing Web suite before browser acceptance.
- [x] 6.3 Run the isolated Gallery, Artifact, account-entry, and CLI authorization browser specs plus the targeted 1280 by 720 smoke spec, then run the complete default-viewport suite with `mise run web-e2e`; complete every before-and-after row in `evidence/visual-review.md` and resolve every failed comparison.
- [x] 6.4 Run the checked build collector and deterministic browser acceptance, then write `evidence/interface-after.json`; fail the change if JavaScript gzip growth exceeds the larger of 1 percent or 5 KiB, CSS gzip growth exceeds the larger of 2 percent or 2 KiB, request counts exceed the locked expectations, horizontal overflow appears, the browser suite fails, or the evidence misrepresents the unavailable pre-change browser timing baseline.
- [x] 6.5 Run `mise run check`, `git diff --check`, `mise run docs-check`, and `openspec validate standardize-web-shadcn-base-ui`; resolve every failure before marking the change implementation-complete.
- [x] 6.6 Review the final diff line by line and confirm that every product-code change is presentation-only, API clients and backend code are unchanged, ordinary navigation still has no Admin entry, the local shadcn/Base UI configuration is unchanged, all approved exceptions remain intentional, and the before/after evidence records the final comparison.
