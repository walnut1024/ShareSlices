# Refine the Public Website and Browse Design

## Why

The implemented public Website and Browse surfaces now have the correct product boundaries, but their visual hierarchy diverges from the supplied high-fidelity direction: the homepage is dominated by an oversized dark hero and decorative mock browser, while Browse feels sparse and its controls and empty state do not form a coherent discovery workspace. This change refines those surfaces into a calmer, content-led public experience without inventing unsupported routes, collections, counts, or Gallery data.

## What Changes

- Align the public shell with the high-fidelity design language: a restrained light surface, compact sticky navigation, a consistent 1200-pixel content frame, deliberate spacing and type scale, and a minimal footer containing only real destinations.
- Replace the current decorative homepage hero with a centered, search-led introduction that foregrounds the real Browse and publishing journeys, then organize existing Gallery discovery, publishing explanation, empty, and unavailable content into a coherent page rhythm.
- Refine `/browse` with a clear page header, breadcrumb, integrated search and supported collection controls, a denser Gallery grid, and bounded loading, empty, unavailable, and pagination states.
- Refine shared Gallery cards so cover, title, Creator, description, creation time, and tags have a stable hierarchy, visible hover and keyboard focus, and no invented engagement counters or executable preview behavior.
- Reuse the existing Geist typography, shadcn/Base UI primitives, design tokens, route model, Gallery API projections, Session behavior, and supported desktop boundary.
- Add focused component, route, accessibility, and browser visual-regression coverage for the homepage, Browse, public shell, Gallery cards, and their loading, empty, unavailable, signed-in, and signed-out states.
- Keep the high-fidelity HTML as design evidence rather than executable production code: do not copy its inline styles, remote font loading, fictional counts, Trending or Most played collections, category taxonomy, unsupported Creator directory, **Open app** action, or placeholder destination links.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-interface-consistency`: Extend the coherent public visual-language contract to the Website homepage, Browse discovery, public shell, Gallery cards, state presentation, focus behavior, and supported desktop layout.

## Impact

- Public Web presentation in `web/src/screens/HomePage.tsx`, `web/src/screens/BrowsePage.tsx`, `web/src/components/PublicSiteShell.tsx`, and `web/src/components/GalleryCard.tsx`.
- Existing Web tokens and focused public-surface components under `web/src/styles.css` and `web/src/components/ui/`.
- Public route, component, accessibility, visual, and interface-build checks under `web/src/**`, `web/e2e/**`, and the existing checked benchmark harness.
- No HTTP API, database, Worker, CLI, Gallery eligibility, route, authentication, metadata, indexing, deployment, or dependency change is expected.
