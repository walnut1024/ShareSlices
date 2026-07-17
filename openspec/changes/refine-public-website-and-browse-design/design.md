# Public Website and Browse Design Refinement

## Context

`make-gallery-public-home` established the product and routing model this change inherits: `/` is a resilient public Website, `/browse` is the full Gallery index, `/console` owns personal management, public Session projection does not gate Website content, and Gallery availability can remove discovery without taking down the homepage. Its implementation already uses the shared Geist font, Tailwind v4 tokens, shadcn/Base UI primitives, `PublicSiteShell`, `GalleryCard`, and one route-owned destination model.

The two supplied high-fidelity HTML files establish a clearer public visual direction: a 64-pixel sticky header, a neutral light canvas, a roughly 1200-pixel content frame, compact controls, restrained borders and shadows, search-led discovery, dense static Artifact cards, and explicit page endings. They also contain illustrative behavior the product does not support, including fictional aggregate and play counts, category facets, Trending and Most played collections, an independent Creator directory, **Open app**, and placeholder Company and Legal destinations. The design must preserve the references' hierarchy without turning illustrative data into a product contract.

The current homepage instead uses a full-width dark grid hero with an oversized heading and a decorative browser-card construction. It pushes real Gallery content below a large non-functional visual. The current Browse page has the right search and collection behavior, but the header, controls, grid, and state presentation feel disconnected at the supported desktop boundary. This change is presentation-only and must preserve the current route, API, security, indexing, availability, and authentication contracts.

## Goals / Non-Goals

**Goals:**

- Give `/` and `/browse` one recognizable, content-led public Website language derived from the supplied references.
- Keep real search, Featured, Newest, default discovery, exact-tag, cursor pagination, Session, and Gallery-availability behavior unchanged.
- Make public navigation, page headings, Gallery controls, cards, state messages, calls to action, and footer feel deliberately related.
- Keep primary content and actions readable, reachable, and free of horizontal overflow at every supported desktop viewport.
- Preserve keyboard, focus, labelling, loading, empty, unavailable, and pending semantics while refining presentation.
- Protect the existing checked bundle and request-count budgets.

**Non-Goals:**

- Adding or renaming routes, HTTP endpoints, Gallery collections, category facets, counters, Creator discovery, or content-interaction behavior.
- Changing the supported-device boundary, adding a mobile public experience, or changing the desktop-required fallback.
- Redesigning listing detail, Creator profile, account entry, Console, owner Preview, or administration surfaces.
- Copying prototype inline styles, remote font imports, mock data, placeholder links, or executable prototype code into production.
- Adding another design system, CSS framework, routing dependency, global state layer, asset pipeline, or runtime.
- Changing `PRODUCT.md`, `CONTEXT.md`, OpenAPI, database, Worker, CLI, Gallery eligibility, metadata, or deployment policy.

## Decisions

### 1. Translate the references into existing public-surface primitives

The implementation will preserve the supplied references' measurable public grammar: a 64-pixel sticky translucent header, a `max-w-[1200px]` content frame with 24-pixel horizontal gutters, Geist typography, neutral surfaces, compact rounded controls, restrained shadows, and consistent section spacing. It will express that grammar through the existing Tailwind tokens, `buttonVariants`, inputs, toggles, cards, badges, skeletons, alerts, and empty-state primitives rather than inline styles.

Public-only layout composition will live in the public shell and public page components. Global semantic tokens change only if the new value is already valid for Console and administration; the implementation must not silently restyle authenticated surfaces to obtain the Website result.

Alternative: copy the prototype markup and inline values literally. Rejected because the prototype includes remote assets, illustrative destinations and data, and a parallel styling layer that would drift from the checked component system.

Alternative: change global theme tokens until the current markup resembles the prototype. Rejected because broad token changes would alter unrelated Console, account, and administration surfaces.

### 2. Make the homepage search-led and content-led

The homepage will replace the dark grid hero and decorative stacked browser mock with a centered light introduction. It will present one plain product promise, a real Gallery search form that submits to `/browse`, one Browse action, and one Session-aware publishing action. Search remains useful only while Gallery is available; the ownership action keeps the existing signed-in `/console` and signed-out validated `returnTo` behavior.

Below the introduction, the page keeps one real discovery section backed by the existing Featured request and one conditional Newest fallback. The section will use the shared Gallery cards and a compact collection label rather than prototype engagement counters or editorial badges that are absent from the API. Existing loading, empty, and unavailable results occupy the same bounded section so state changes do not collapse the page or leave an oversized blank region.

The existing three publishing explanations remain, but their presentation will follow the quieter reference rhythm. A final publishing call to action and minimal public footer may reuse only real Website, Browse, sign-in, and Console destinations. Unsupported category, Creator-directory, Company, Legal, Status, Changelog, and API links do not appear merely because they exist in the prototype.

Alternative: keep the dark hero and only restyle the discovery cards. Rejected because the current hero is the largest source of hierarchy drift and uses a non-functional mock interface as the dominant evidence of the product.

Alternative: reproduce every homepage prototype section. Rejected because several sections depend on nonexistent data, routes, or public claims.

### 3. Treat Browse as one supported discovery workspace

`/browse` will use the same public frame and begin with a quiet tinted page header containing a real Home/Browse breadcrumb, title, supporting copy, and Gallery search. Beneath it, one control row will expose only the implemented default, Featured, and Newest modes and will accurately reflect search or exact-tag context. Current query parsing and destination helpers remain authoritative.

The collection uses a four-column desktop grid inside the 1200-pixel frame, preserving card dimensions close to the reference without adding an unsupported category sidebar. Search, controls, cards, and pagination must remain inside the frame at the 1280-pixel support boundary. Loading, zero-result, unavailable, and load-more failure states stay in the collection region and keep the page header and navigation stable.

Alternative: reproduce the prototype's sticky category and popular-tag sidebar. Rejected because the Server does not expose category taxonomy, aggregate counts, or a bounded popular-tags projection; deriving them from the current page would be misleading and incomplete.

Alternative: retain the 1920-pixel application frame. Rejected because it produces a different density and visual rhythm from the accepted public references and makes Browse feel unrelated to the homepage.

### 4. Keep Gallery cards static, trusted, and data-complete

`GalleryCard` remains the shared card for homepage and Browse. It will keep the static cover or neutral placeholder, title, Creator display name, optional description, immutable creation date, and tags already present in the projection. Presentation will use one stable image ratio, a compact metadata block, bounded text, and a consistent footer. Hover and `focus-visible` treatment will identify the trusted listing destination without implying that the Artifact executes inside the card.

Tag actions continue to open exact-tag Browse results and must not be nested in the listing anchor. The implementation may reorganize the card DOM to make the listing destination and tag actions visibly coherent, but it must retain valid interactive nesting and accessible names. It must not add play overlays, play counts, Editor's pick badges, or other fields absent from the contract.

Alternative: make the full prototype card clickable and place tag links inside it. Rejected because nested anchors are invalid and create ambiguous keyboard behavior.

### 5. Make public shell and state semantics explicit

`PublicSiteShell` will continue to own Website navigation and Session projection. It will add the shared public frame treatment, a skip link to the page's main landmark, active-route indication, stable pending Session space, and a minimal footer. The footer is a page-ending landmark, not a new navigation taxonomy; it only emits destinations the route model already owns.

Page components provide a stable `main` target and section labels. Search remains a labelled form; collection selection remains a grouped single choice; cards expose an explicit trusted listing destination; loading and pending results remain perceivable; empty and unavailable states explain the condition without presenting unsupported recovery. Color alone must not communicate active, error, unavailable, or focus state.

Alternative: duplicate a header and footer in each public page. Rejected because Session, availability, active navigation, and route generation would drift across pages.

### 6. Verify the visual change without weakening existing gates

Focused component and route tests will lock the real content hierarchy, destinations, state semantics, valid interactive structure, and absence of unsupported prototype claims. Existing request-count and bundle checks remain authoritative and will be updated only when the checked scenario itself needs to include the new public presentation.

Browser verification will capture the supplied references through an approved browser path and compare them with `/` and `/browse` at the same desktop viewport. It will cover 1440 by 900 for the primary composition and 1280 by 720 for the supported-width boundary, including signed-out navigation, available discovery, empty discovery, unavailable Gallery, search, collection selection, tag navigation, and load more. Visual review must check container width, crop, spacing, type scale and weight, borders, radii, focus, and horizontal overflow; a screenshot alone is not acceptance.

Alternative: rely only on DOM snapshots and unit tests. Rejected because they cannot detect hierarchy, spacing, clipping, typography, or visual-state regressions.

## Risks / Trade-offs

- [The high-fidelity references contain unsupported product ideas] → Treat them as visual evidence, keep the current product and spec owners authoritative, and add assertions that forbidden counts, collections, routes, and links are absent.
- [A public-only refinement can accidentally restyle authenticated surfaces] → Prefer public composition classes and components; run existing account, Console, and administration visual smoke coverage after any shared-token edit.
- [A denser 1200-pixel frame can clip search and collection controls at 1280 pixels] → Lock the 24-pixel gutter, allow deliberate control wrapping where necessary, and add a 1280-pixel no-overflow browser check.
- [Homepage state changes can create large layout jumps] → Reserve a bounded discovery region and use matching grid skeletons and state containers.
- [Gallery cards have two destinations: listing and tag filters] → Keep separate non-nested anchors with explicit focus treatment and test keyboard order and navigation.
- [Visual polish can grow CSS or JavaScript unexpectedly] → Reuse installed primitives and icons, add no dependency, and keep the existing production-asset thresholds.
- [The reference cannot be captured through the current browser environment] → Do not claim pixel fidelity without a valid same-viewport source capture; keep source-measured layout decisions and require an approved capture during implementation verification.

## Migration Plan

1. Apply this change only after the completed `make-gallery-public-home` behavior is the working baseline; preserve its route, Session, availability, and metadata tests.
2. Refine the public shell and shared Gallery card first, then update homepage and Browse composition against those shared pieces.
3. Add focused tests and same-viewport browser evidence before running the full quality gate.
4. Deploy as a presentation-only Web release with no data or contract migration. Roll back by reverting the public presentation files and their tests; no persistent state or compatibility path is involved.

## Open Questions

None. The supplied references, current product contract, and existing Web primitives are sufficient to implement the scoped refinement.
