# Refine Artifacts Page management tasks

## 1. Lock the Web behavior

- [x] 1.1 Add the `artifact-publication` delta requirements for grid, list, empty states, shared selection, and batch operation feedback.
- [x] 1.2 Add focused failing tests for view preference, search and filters, initial and filtered empty states, selection persistence, Select all scope, and Escape behavior.
- [x] 1.3 Add focused failing tests for blocked, successful, and partially successful batch Publish and Delete flows.

## 2. Refine Artifact browsing

- [x] 2.1 Align the Artifacts Page heading, toolbar, wider grid density, cards, and list columns with the high-fidelity specification.
- [x] 2.2 Persist the local grid or list preference and implement name search plus existing state filters.
- [x] 2.3 Add distinct first-use and filtered-result empty states, including creation drop behavior only in the first-use state.

## 3. Add selection and batch operations

- [x] 3.1 Add selection mode shared by grid and list, preserving selection across view and filter changes while scoping Select all to visible filtered results.
- [x] 3.2 Add all-or-none eligibility preflight and explicit Sonner reasons for blocked Publish and Delete attempts.
- [x] 3.3 Add batch Publish with one expiration choice, latest ready Versions, Share-link reuse, three-request concurrency, and partial-result feedback.
- [x] 3.4 Add permanent batch Delete confirmation, three-request concurrency, no automatic destructive retry, and partial-result feedback.

## 4. Verify

- [x] 4.1 Run focused Web tests and the Web TypeScript check.
- [x] 4.2 Verify grid, list, both empty states, selection, Sonner feedback, Publish, and Delete at `1440x900` and `2560x1440`.
- [x] 4.3 Run `mise run check`, strict change validation, and `git diff --check`.
- [x] 4.4 Review the scoped diff for contract, accessibility, correctness, and regression risks.
