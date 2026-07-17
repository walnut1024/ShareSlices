# Public Website and Console: Design

## Context

The first applied increment of this change moved account entry to dedicated paths, made `/` the Gallery index, centralized route classification and safe `returnTo` validation, and projected Session state into public navigation. Personal Artifact management still uses `/artifacts`, Gallery profile management uses `/settings/gallery-profile`, and `App.tsx` selects public, account-entry, Preview, personal-management, and administration pages from one route union.

The active change identifier remains `make-gallery-public-home` because the user asked to correct and extend that applied increment before archival. The final artifact titles and accepted vocabulary describe the corrected Website-and-Console outcome; the identifier records the history rather than naming a product surface.

The corrected product model has two primary Web surfaces. `/` is the public Website where a visitor first understands ShareSlices and may discover community Artifacts without signing in. `/console` is the authenticated personal-management surface and initially opens the existing Artifact list. Gallery remains a public capability inside the Website rather than the Website's availability owner. Consequently, a Gallery readiness failure must close Gallery discovery, listing, interaction, and content entrypoints without taking down the product homepage or Console.

Console is a presentation and navigation term. Artifact, Version, Publication, Gallery listing, and account behavior remain owned by their existing Server modules and HTTP resource contracts. The trusted Website and Console continue to share one Web origin and management Session, while executable Artifact content remains on the isolated Untrusted-content origin.

The supplied high-fidelity references informed the intended visual hierarchy but are neither normative nor required implementation inputs. The accepted hierarchy and exclusions are recorded in this change so it remains reproducible from a clean checkout. Implementation follows `PRODUCT.md`, the implemented Gallery specs, and the existing Web design system instead of cloning illustrative text, data, links, inline styles, or remote assets.

## Goals / Non-Goals

**Goals:**

- Make `/` the canonical public Website homepage and `/browse` the canonical full Gallery index.
- Keep the Website homepage available independently from Gallery eligibility without leaking Gallery resource state.
- Show up to eight eligible Featured Gallery Artifacts on the homepage while Gallery is available, with a single up-to-eight Newest fallback only when Featured succeeds empty and every card leading to its trusted listing page.
- Make `/console` the canonical authenticated Artifact list and place personal management descendants under its route tree.
- Keep platform administration outside Console while preserving the same trusted visual language.
- Preserve safe origin-aware authentication returns and make direct sign-in open `/console`.
- Give routing, link generation, metadata, legacy migration, Session policy, and shell selection one coherent owner.
- Split public Website, account-entry, Console, Preview, and administration code at natural lazy-loading boundaries without creating another Web application.
- Preserve the existing API, database, Worker, CLI, Gallery-governance, and isolated-content architecture.

**Non-Goals:**

- Adding a second frontend repository, Web origin, framework, routing library, global client store, or backend runtime.
- Renaming `/api/artifacts`, domain modules, database resources, CLI commands, or product objects to Console.
- Changing Gallery eligibility inputs, listing lifecycle, response precedence, content isolation, report handling, or public interaction policy.
- Adding a generic Dashboard, organization workspace, mobile layout, social sign-in, or new administration capability.
- Redesigning Artifact cards, Gallery listing content, upload, Publish, or Share-to-Gallery behavior beyond navigation needed by the new surfaces.
- Adding engagement-based Trending or Most played collections, public engagement counters, a category taxonomy, a public Creator directory, fictional aggregate counts, or destinations without implemented product routes.
- Changing the existing requirement that Save a copy and ownership work require sign-in.
- Adding server-side rendering, static route pre-rendering, or edge-generated Web document status codes in this change.

## Decisions

### 1. Use one canonical route model with explicit surfaces

The route module will classify every trusted Web address into one explicit surface and page:

| Surface | Canonical routes |
| --- | --- |
| Public Website | `/`, `/browse`, `/gallery/{opaqueSlug}`, `/creators/{opaqueSlug}` |
| Account entry | `/sign-in`, `/sign-up`, `/reset-password` |
| Device authorization | `/device` with its existing `user_code` query |
| Console | `/console`, `/console/artifacts/{artifactId}`, `/console/artifacts/{artifactId}/preview`, `/console/settings/gallery-profile` |
| Administration | `/admin/gallery` |

`/console` renders the existing `ArtifactsPage`; the page keeps its resource name because Console is its shell, not its content. Artifact detail remains resource-shaped below Console. Preview remains authenticated but renders without Console navigation so the Artifact player can own the viewport. Administration remains a separate route class because its actor and authorization differ from personal ownership work.

The route module will own classification, canonical path generation, route-owned query parsing, safe `returnTo` validation, legacy-path normalization, and metadata inputs. Callers will request destinations by route value rather than constructing management paths independently. The classifier will reject unknown `/device/*` descendants because no continuation path exists there. This deepens the existing real seam without adding a routing dependency.

Alternative: add React Router or another routing package while renaming paths. Rejected because the current pure classifier already has multiple callers and adequate history behavior; a new dependency is justified only when nested loaders, error boundaries, or route composition create measured pressure.

### 2. Separate Website availability from Gallery availability

[PRODUCT.md](../../../PRODUCT.md) owns the Website and Gallery availability policy. Its implementation consequence is that the route resolver classifies `/` as Website before any Gallery request. The homepage renders its product content immediately and requests the existing Featured collection with `limit=8`. If and only if that eligible request succeeds empty, it requests the existing Newest collection once with `limit=8`; a nonempty Featured result never triggers Newest, and an unavailable Featured result never triggers a resource fallback. The discovery section renders at most eight eligible cards and contains its success, empty, and unavailable states. Cards use trusted listing links, **Browse all** opens `/browse`, and homepage search submits to `/browse?q=...` instead of owning a second result surface.

`/browse`, `/gallery/{opaqueSlug}`, `/creators/{opaqueSlug}`, Gallery metadata and interactions, and isolated Artifact content remain Gallery entrypoints. `/browse` projects the existing collection contracts without another API. Their data and content boundaries retain the implemented pre-lookup `503`, `404`, `410`, and `200` precedence; the static Web document itself remains the existing client-rendered `200` shell. A resolved unavailable result drives the hydrated unavailable state and removes active Gallery navigation. Console routing and non-Gallery operations do not depend on that result.

Alternative: keep `/` as the Gallery index and add a separate marketing address. Rejected because the accepted product entry is the canonical root and the Website must survive a Gallery capability outage.

### 3. Keep one Web application with surface-level shells and chunks

The current public shell becomes `PublicSiteShell`, and the current management shell becomes `ConsoleShell`. Account entry, owner Preview, and administration retain focused shells or shell-free layouts appropriate to their tasks. They share the existing design tokens, primitives, account menu, Session projection, and API adapters, but each shell owns only its navigation and layout policy.

The application entry will lazy-load page groups by surface so an anonymous homepage visit does not eagerly load upload, Artifact management, Preview, or administration code. This is bundle separation inside the existing `web/` build, not an application or deployment split. Shared UI moves only when at least two surfaces use the same coherent responsibility; no generic `shared` layer is introduced. A checked fresh-navigation harness will assert that `/` does not request Console, owner Preview, or administration chunks and will record build-size deltas; this change does not invent an arbitrary absolute byte budget.

Alternative: create separate Website and Console applications now. Rejected because they share one Session, origin, component system, deployment lifecycle, and API adapter, and there is no measured scaling or ownership pressure that offsets duplication.

### 4. Treat Console as Web information architecture only

The route migration does not rename HTTP or domain interfaces. Browser navigation changes to `/console`, but Web API adapters continue calling `/api/artifacts`, `/api/versions`, Gallery owner routes, and existing account endpoints. Artifact application modules, database tables, Worker contracts, CLI commands, object layouts, and isolated-content authorization do not learn about Console.

`CONTEXT.md` defines Console as the authenticated Web surface and explicitly excludes it as a domain resource, API namespace, or administration surface. This prevents UI terminology from producing a shallow parallel backend.

Alternative: introduce `/api/console` as a frontend-specific aggregation namespace. Rejected because the current Server already exposes the required resource projections and no second backend adapter or measured request problem justifies another interface.

### 5. Preserve origin-aware authentication behavior

Public Website content renders independently from the non-authoritative current-Session projection. While Session lookup is pending, the account area reserves stable space; failure resolves to signed-out navigation without suppressing public content. The signed-out header exposes **Sign in** without a separate **Open app** action. A signed-in User remains on `/` or any accessible public route and sees **My Artifacts** linked to `/console` plus the account menu.

A direct successful sign-in, or a signed-in User opening an account-entry route without an accepted destination, opens `/console`. An ownership call to action such as **Start publishing** opens Console directly for a signed-in User and otherwise opens `/sign-in` with an encoded `/console` return destination; the signed-out header still presents **Sign in** rather than a false anonymous ownership action. `returnTo` accepts only same-origin classified public Website, Console, or administration routes and retains only query keys owned by that route. It rejects fragments, account-entry loops, device authorization, external origins, protocol-relative values, malformed paths, legacy management paths, and unknown destinations. A protected Console or administration request signs in with its canonical destination. Signing out on an accessible public route stays in place; signing out from Console or administration replaces the location with `/`.

Alternative: always redirect signed-in users from `/` to Console. Rejected because the Website and Gallery remain useful public destinations after authentication and authentication must not change their identity.

### 6. Normalize legacy management paths before authentication

The Web will generate only canonical Console paths. A synchronous location resolver runs before initial route classification, Session lookup, or authentication gating and converts former trusted Web routes to canonical locations. This is bootstrap logic, not an effect that races Session resolution. Management routes migrate as replace-style navigation:

| Former path | Canonical destination | Retained query state |
| --- | --- | --- |
| `/artifacts` | `/console` | none |
| `/artifacts/new` | `/console` | none |
| `/artifacts/{artifactId}` | `/console/artifacts/{artifactId}` | `gallery=manage` only |
| `/artifacts/{artifactId}/preview` | `/console/artifacts/{artifactId}/preview` | one non-empty `versionId` only |
| `/settings/gallery-profile` | `/console/settings/gallery-profile` | none |

Unknown query keys, duplicate route-owned keys, nested `returnTo`, and every fragment are discarded. Normalization occurs before the authentication gate so a signed-out legacy request carries a canonical Console `returnTo` and never returns to a legacy path after sign-in. Client metadata does not make former addresses canonical, and no application link emits them. Removing compatibility later requires a separate explicit change.

The first increment already generated Gallery collection state at the root. The same resolver migrates only recognized Gallery-selection queries while leaving the canonical Website root and tracking parameters alone:

| Former selection | Canonical destination |
| --- | --- |
| `/?q={query}` | `/browse?q={query}` |
| `/?tag={tag}` | `/browse?tag={tag}` |
| `/?view=featured` | `/browse?view=featured` |
| `/?view=newest` | `/browse?view=newest` |

If recognized keys are combined, the existing exact-tag, search, and collection precedence is preserved by the route-owned parser. At least one recognized selection triggers migration; the resolver serializes only recognized state and discards unrelated keys and fragments. Obsolete account values such as `view=login` and unknown `view` values do not trigger migration by themselves. New Website search, Gallery cards, tag links, listing back-links, and collection controls generate `/browse` destinations directly.

`/gallery` remains an ordinary unknown route rather than an alias for `/browse`; it was already deliberately retired and has no checked external dependency.

Alternative: make old and new management paths permanent aliases. Rejected because two canonical route trees increase link drift, metadata mistakes, and return-path complexity.

### 7. Keep administration outside Console

`/admin/gallery` remains an authenticated administration route and is not nested under `/console` or exposed in ordinary User navigation. It may reuse the same visual tokens and appropriate shell elements, but its route class, permission check, metadata, and lazy-loaded page group remain distinct. Gallery profile management is personal and therefore moves into Console.

Alternative: place all authenticated pages under `/console`. Rejected because authentication alone does not make ordinary ownership and platform governance the same surface.

### 8. Use one conservative hydrated-document metadata protocol

The current Vite application is client rendered: trusted Web routes receive the same static document, and Gallery API or content responses—not the Website document—carry resource-specific `200`, `404`, `410`, or `503` status. This change does not claim server-rendered status or metadata. The base `index.html` starts with `noindex,nofollow` and no canonical link so a private deep link or lazy-loading gap cannot inherit indexable defaults.

On every location change, one metadata controller synchronously clears the canonical link and applies the route's conservative title and `noindex,nofollow` state. A page that depends on public data reports a typed resolution such as eligible, not found, gone, or unavailable back to that controller instead of mutating `document.head` independently. Only an eligible hydrated public result may upgrade robots and install its canonical URL. `/` can upgrade independently from Gallery readiness because its Website content remains valid; `/browse`, Creator, and listing results upgrade only when the existing governance and eligibility gates permit. Console, administration, account-entry, device, owner Preview, legacy, unavailable, and not-found states never upgrade.

Alternative: add SSR, pre-rendering, or edge-generated route documents now. Rejected because that changes build and deployment architecture beyond this navigation change. If non-JavaScript crawler coverage or true Web-route HTTP statuses become a requirement, that work needs a separate measured change rather than claims in client metadata.

### 9. Move Preview document policy with the route

The owner Preview page remains a trusted, authenticated Web document around API-served Preview content. Its canonical path change must update the development middleware, image Caddyfile, Compose Caddyfile, Kubernetes base, and public-production overlay that currently match `/artifacts/*/preview`. Both `/console/artifacts/*/preview` and the legacy `/artifacts/*/preview` document receive `Cache-Control: no-store` during the compatibility window; API Preview entry and asset policy is unchanged.

Alternative: rely only on the API content response's `no-store`. Rejected because the existing product contract and deployment configuration also protect the trusted owner Preview document, and moving the browser address must not silently weaken that policy.

## Risks / Trade-offs

- [The homepage could accidentally inherit Gallery outage behavior] → Classify `/` as Website before Gallery eligibility and contain unavailable Gallery data inside a bounded section.
- [The homepage could leak Gallery state while the gate is closed] → Do not render cached listing, Creator, cover, count, or resource-specific errors when Gallery is ineligible.
- [Legacy bookmarks can strand signed-out users or race authentication] → Resolve the canonical location synchronously before route and Session initialization, then retain only route-owned query state.
- [Route strings can drift across components] → Centralize destination generation in the route module and prohibit new hard-coded former paths through focused tests and repository search.
- [The Preview route can lose its document-level no-cache policy] → Update and test every development and deployed matcher for both canonical and migration paths before emitting the new URL.
- [A single entry bundle can make the public Website unnecessarily heavy] → Lazy-load surface page groups and extend the checked harness to inspect route requests and build output instead of relying on total-size reporting alone.
- [A prototype can introduce fictional or prohibited behavior] → Reuse its hierarchy only after mapping every visible datum, action, and destination to an implemented contract; omit the rest.
- [Shell extraction can create shallow pass-through modules] → Give each shell ownership of its navigation, layout, Session projection, and feedback providers; keep resource behavior in pages and application adapters.
- [Durable policy can temporarily lead implementation] → Keep the change active, mark the new implementation tasks incomplete, and archive only after code and verification match the final contract.

## Migration Plan

1. Update `CONTEXT.md`, `PRODUCT.md`, proposal, delta specs, and route tests to express the final Website and Console contract.
2. Add the synchronous canonical-location resolver, route-owned query model, centralized destination generation, and conservative metadata controller before moving pages.
3. Introduce `HomePage` at `/`, move full Gallery discovery and its generated query URLs to `BrowsePage` at `/browse`, and add migration for recognized root Gallery selections.
4. Introduce `ConsoleShell`, move the existing Artifact list and descendants to canonical Console routes, and move Gallery profile settings under Console.
5. Update every Preview document matcher for canonical and legacy routes, then switch generated owner Preview links.
6. Keep administration separate, update authentication returns and sign-out projection, and replace every generated former management link.
7. Add surface-level lazy loading, hydrated metadata resolution, and focused unit and integration coverage; extend the checked request/build harness and canonical scenario registry.
8. Run browser flows at `1440x900`, real Caddy header checks, OpenSpec validation, documentation checks, and repository quality gates.

Rollback reverts the Website, Console routes, authentication destinations, legacy normalization, metadata controller, trusted-Web Preview matchers, and durable contracts together. No API, database, Worker, CLI, object-storage, or content-runtime rollback is required.

## Open Questions

None.
