# Public Website and Console: Tasks

Sections 1–4 record the applied first increment. Sections 5–8 extend and supersede its route destinations before this change can be archived.

## 1. Product Contract and Route Model

- [x] 1.1 Update `PRODUCT.md` so `/` owns the public Gallery index, dedicated account paths own account entry, and successful sign-in may follow a validated originating destination before defaulting to `/artifacts`.
- [x] 1.2 Add a pure Web route classifier covering Gallery index, listing, Creator, account entry, device authorization, authenticated management, and not-found routes, with unit tests for every canonical and removed address.
- [x] 1.3 Add a centralized `returnTo` validator with unit coverage for allowed Gallery and management paths plus external, protocol-relative, account-entry, device, malformed, and unknown rejection cases.

## 2. Canonical Routing and Authentication

- [x] 2.1 Refactor Web route selection to consume the route classifier, render Gallery at `/`, render account entry at `/sign-in`, `/sign-up`, and `/reset-password`, and route `/gallery` through ordinary not-found handling.
- [x] 2.2 Remove account selection through the root `view` query parameter and replace every generated `/?view=...` link with its dedicated account path.
- [x] 2.3 Route signed-out management requests through `/sign-in` with an encoded validated destination, and route successful or already-authenticated account entry to that destination or `/artifacts`.
- [x] 2.4 Add route-owned document metadata so canonical, robots, and title state is replaced or removed correctly across Gallery, account-entry, management, unavailable, and not-found navigation.

## 3. Public Session Navigation

- [x] 3.1 Project the existing current-Session check into the public Gallery shell without blocking Gallery data or eligibility rendering, including a stable pending placeholder and signed-out failure fallback.
- [x] 3.2 Present only **Sign in** for signed-out public navigation and present **My Artifacts** plus the existing account menu for signed-in public navigation.
- [x] 3.3 Apply surface-aware sign out so public Gallery and Creator routes remain in place while management routes replace their location with `/`, retaining existing failure and duplicate-request protection.
- [x] 3.4 Verify existing Gallery and management navigation, including `View in Gallery`, emits only canonical public and account-entry paths without changing Gallery submission feedback.

## 4. Verification

- [x] 4.1 Update focused Web component and integration tests for root Gallery entry, dedicated account routes, signed-in account-route handling, protected return flow, public Session projection, sign-out destinations, not-found behavior, unavailable Gallery, and metadata cleanup.
- [x] 4.2 Update the Web browser flows at `1440x900` to cover signed-out Gallery entry, public sign-in and return, signed-in Gallery navigation, canonical metadata, and direct rejection of the removed `/gallery` index.
- [x] 4.3 Run `mise run web-test`, `mise run web-e2e`, and `mise run docs-check`, then remove any remaining application or test references that generate the removed addresses.
- [x] 4.4 Run `openspec validate make-gallery-public-home` and the authoritative `mise run check` quality gate.

## 5. Final Product Contract and Route Model

- [x] 5.1 Add the accepted Website and Console terms to `CONTEXT.md` and update `PRODUCT.md` so `/` owns the resilient public Website, `/browse` owns the full Gallery index, and `/console` owns authenticated personal management.
- [x] 5.2 Add a synchronous location resolver that runs before route and Session initialization, classifies every canonical surface, normalizes former management paths and recognized root Gallery-selection queries, rejects unknown `/device/*` descendants, and has unit coverage for canonical, former, malformed, and unrelated-query addresses.
- [x] 5.3 Centralize typed destination generation and route-owned query parsing for Website search, Browse collections, account entry, Console, feedback, owner Preview, and administration; retain only the checked per-route keys and reject fragments, nested destinations, duplicates, and legacy paths in `returnTo`.
- [x] 5.4 Give the shared client document a conservative `noindex,nofollow` default and replace direct page mutations with one metadata controller that clears stale state on navigation, keeps loading and private states excluded, and upgrades only typed eligible public results to their canonical metadata.

## 6. Public Website and Gallery Discovery

- [x] 6.1 Add `HomePage` at `/` using the accepted hierarchy recorded in this change and existing CSS tokens and local components: keep the product explanation, Gallery search, bounded Artifact discovery, supported education, and ownership call to action; omit fictional counts, unsupported destinations, remote assets, anonymous-Save claims, Trending, Most played, public engagement metrics, and any category or Creator section without an implemented contract.
- [x] 6.2 Load Featured with `limit=8` on Home without delaying non-Gallery content, load Newest once with `limit=8` only when an eligible Featured result succeeds empty, never use that fallback after an unavailable result, render at most eight cards from the selected result, link every card to its trusted listing page, route homepage search to `/browse?q=...`, and link **Browse all** to `/browse`.
- [x] 6.3 Move the existing full Gallery UI to `BrowsePage` at `/browse` using the accepted Browse hierarchy recorded in this change without importing unsupported controls or data, preserve default, Featured, Newest, search, exact-tag, and cursor behavior, generate all collection/search/tag/back links under `/browse`, and keep `/gallery/{opaqueSlug}` and `/creators/{opaqueSlug}` unchanged.
- [x] 6.4 Replace the Gallery-specific public shell with `PublicSiteShell`, retain non-blocking Session projection, expose **Sign in** without a separate signed-out **Open app** action, point signed-in **My Artifacts** to `/console`, and route a signed-out ownership call to action through `/sign-in` with an encoded `/console` return destination.
- [x] 6.5 Make a Gallery outage remove active Gallery destinations and all cached resource evidence from the public shell and Home section while preserving Website content and the existing pre-lookup `503` data/content behavior for `/browse` and direct Gallery routes.
- [x] 6.6 Lazy-load public Website, account-entry, Console, owner Preview, and administration page groups without adding another Web application, global store, or routing dependency.

## 7. Console and Authentication Migration

- [x] 7.1 Add `ConsoleShell`, render the existing `ArtifactsPage` at `/console`, and move Artifact detail and owner Preview to canonical `/console/artifacts/{artifactId}` descendants.
- [x] 7.2 Move personal Gallery profile management to `/console/settings/gallery-profile` while keeping `/admin/gallery` outside Console and out of ordinary User navigation.
- [x] 7.3 Make direct and already-authenticated account entry open `/console`, allow only classified public Website, Console, and administration `returnTo` destinations, and preserve surface-aware sign out.
- [x] 7.4 Replace every generated `/artifacts` and `/settings/gallery-profile` Web destination, including Preview helpers, feedback links, tests, and checked benchmark scenarios, with its typed Console destination without changing `/api/artifacts` or other resource interfaces.
- [x] 7.5 Implement replace-style legacy management navigation in the synchronous resolver: retain only `gallery=manage` on Artifact detail and one non-empty `versionId` on Preview, discard all other query and fragment state, and prove a signed-out legacy deep link can generate only a canonical Console `returnTo`.
- [x] 7.6 Update `web/vite.config.ts`, the image and Compose Caddy route configurations, Kubernetes base, and public-production overlay so canonical and legacy owner Preview documents both send `Cache-Control: no-store`; add configuration checks and verify the header through the real Caddy stack.
- [x] 7.7 Update `docs/design/modules.md` to record the implemented Website, Console, Preview, administration, location-resolution, and metadata ownership structure after the code migration.

## 8. Final Verification

- [x] 8.1 Add focused route, Session, shell, hydrated-metadata, compatibility, and component tests for Website availability, deterministic Featured-to-Newest Home discovery, homepage search, `/browse` query state, `/console`, synchronous legacy normalization, direct and returning login, sign out, loading transitions, and stale Gallery-data removal.
- [x] 8.2 Run browser flows at `1440x900` for signed-out Website discovery, full Gallery browse, direct Console authentication, ownership-action return, current root Gallery bookmarks, legacy management bookmarks, owner Preview, unavailable Gallery navigation, and administration separation.
- [x] 8.3 Extend the checked interface harness and canonical scenario registry, wire it into the relevant `mise` gate, and assert that a fresh `/` navigation does not request Console, owner Preview, or administration chunks, sends no duplicate Session or identical Gallery request, makes at most one Featured request plus one Newest request only after an eligible empty Featured result, and records the production asset delta without inventing an ungrounded absolute budget.
- [x] 8.4 Search application, deployment, test, and benchmark sources for obsolete generated Web destinations while explicitly preserving `/api/artifacts` and historical documentation.
- [x] 8.5 Run `mise run web-test`, `mise run web-e2e`, `mise run docs-check`, `openspec validate make-gallery-public-home --strict`, and the authoritative `mise run check` gate.
