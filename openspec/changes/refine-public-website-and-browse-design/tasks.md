# Refine the Public Website and Browse Design Tasks

## 1. Lock the Public Presentation Contract

- [x] 1.1 Confirm the completed `make-gallery-public-home` route, Session, Gallery-availability, metadata, and request behavior is the implementation baseline, and preserve unrelated working-tree changes.
- [x] 1.2 Add focused public-shell tests for the shared 64-pixel header, active Home and Browse destinations, stable pending and signed-in account areas, skip link, real-only footer destinations, and absence of unsupported prototype links.
- [x] 1.3 Add focused Gallery-card tests for ready and missing covers, optional description and tags, listing and exact-tag destinations, visible focus classes, valid non-nested interactive structure, and absence of invented play controls, counts, or badges.

## 2. Refine the Shared Public Shell and Gallery Card

- [x] 2.1 Refine `PublicSiteShell` to use the existing tokens and primitives for the sticky translucent header, 1200-pixel public frame, stable Session area, active navigation, skip-to-main behavior, and minimal real-destination footer.
- [x] 2.2 Refine `GalleryCard` to use one stable cover ratio, compact bounded metadata, neutral missing-cover treatment, separate listing and tag interactions, and consistent border, radius, hover, and `focus-visible` treatment.
- [x] 2.3 Run the focused public-shell and Gallery-card tests and verify no shared-token change visually or semantically alters account entry, Console, listing detail, Creator profile, or administration outside the shared public frame.

## 3. Make the Homepage Search-Led and Content-Led

- [x] 3.1 Add homepage tests for the search-led introduction, Session-aware publishing destination, Browse destination, real Featured and conditional Newest discovery, publishing explanation, and absence of the dark mock-browser hero and unsupported prototype claims.
- [x] 3.2 Add homepage tests for loading, eligible-result, empty, and Gallery-unavailable states, including bounded discovery geometry, stable page landmarks, disabled Gallery entrypoints when unavailable, and unchanged request counts.
- [x] 3.3 Refine `HomePage` into the centered light-surface introduction, real search and actions, bounded Gallery discovery, compact Upload/Publish/Share-safely explanation, and optional real-destination closing action defined by the design.
- [x] 3.4 Run the focused homepage and public-routing tests and verify direct search, signed-in publishing, signed-out `returnTo`, Featured fallback, unavailable Gallery, metadata, and indexing behavior remain unchanged.

## 4. Make Browse a Bounded Discovery Workspace

- [x] 4.1 Add Browse tests for the Home/Browse breadcrumb, page header, labelled search, default/Featured/Newest group, active search and exact-tag context, four-column result grid, empty state, unavailable state, and cursor pagination.
- [x] 4.2 Add regression assertions that Browse does not render category facets, popular-tag rankings, aggregate counts, Trending, Most played, duplicate requests, or primary controls outside the supported-width frame.
- [x] 4.3 Refine `BrowsePage` to use the 1200-pixel public frame, quiet page header, integrated search, supported collection controls, dense four-column grid, and bounded loading, empty, unavailable, load-more pending, and load-more failure states.
- [x] 4.4 Run the focused Browse, Gallery-page, routing, and accessibility tests and verify default, Featured, Newest, search, exact-tag, and cursor destinations still derive exclusively from the existing route helpers and API projection.

## 5. Verify Visual Fidelity, Accessibility, and Performance

- [x] 5.1 Capture valid source screenshots of both supplied high-fidelity prototypes through an approved browser path; if the environment cannot capture them, record the evidence gap and do not claim pixel-level fidelity.
- [x] 5.2 Capture `/` and `/browse` at 1440 by 900 and 1280 by 720 for signed-out, signed-in, available, empty, unavailable, search, exact-tag, and pagination states, then compare the implementation with the source at the same viewport for container width, crop, spacing, type scale and weight, borders, radii, focus, and horizontal overflow.
- [x] 5.3 Exercise keyboard navigation through header, skip link, search, collection controls, listing links, tag links, pagination, ownership actions, and footer, and verify accessible names, order, focus visibility, pending state, and color-independent state cues.
- [x] 5.4 Run the checked interface-build and request-count harnesses and verify the existing JavaScript, CSS, request, and background-activity thresholds without adding a dependency or weakening a gate.
- [x] 5.5 Run `mise run web-test`, `mise run web-e2e`, `mise run docs-check`, `openspec validate refine-public-website-and-browse-design --strict`, and the authoritative `mise run check` gate; resolve every change-related failure before handoff.
