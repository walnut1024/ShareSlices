# Make the Public Website Home and Add Console

## Why

ShareSlices needs a public Website that introduces the product before presenting community Artifacts, while authenticated ownership work needs a clearly separate Console. The first iteration made Gallery itself the Web root and left personal management under `/artifacts`; this extension makes `/` resilient as the product homepage, moves full Gallery discovery to `/browse`, and gives personal management the canonical `/console` surface.

## What Changes

- Make `/` the canonical public Website homepage for signed-out and signed-in visitors, with product explanation, Gallery search, up to eight Featured Artifacts, and one up-to-eight Newest fallback only when the eligible Featured collection is empty; every Artifact card opens its trusted listing page.
- Add `/browse` as the full public Gallery index, retaining the existing default, Featured, Newest, search, exact-tag, and cursor-pagination behavior while keeping `/gallery/{opaqueSlug}` and `/creators/{opaqueSlug}` as public detail routes.
- Keep `/` available when the Gallery eligibility gate is closed; hide or replace Gallery discovery there without exposing resource data, while the data and content boundaries behind `/browse` and direct Gallery routes retain the generic pre-lookup `503` contract and drive a hydrated unavailable state.
- Add an authenticated Console whose Artifact list is `/console`, with Artifact detail and Preview under `/console/artifacts/{artifactId}` and Gallery profile settings under `/console/settings/gallery-profile`.
- Keep `/admin/gallery` outside Console because platform governance has a different actor and permission model.
- Make public navigation session-aware without blocking Website rendering: signed-out visitors see **Sign in**; signed-in Users see **My Artifacts** linked to `/console` plus account controls.
- Preserve a validated same-origin public Website, Console, or administration destination across sign-in; direct sign-in opens `/console`.
- Add migration-only replace navigation from former `/artifacts` and `/settings/gallery-profile` Web addresses to canonical Console destinations while retaining only route-owned query state. Migrate recognized Gallery-selection queries from `/` to `/browse`; new navigation never emits former management paths or Gallery collection queries at `/`.
- Apply the accepted Website and Browse hierarchy captured in this change through the existing design tokens. Do not ship fictional counts, engagement-based collections such as Trending or Most played, unsupported destination links, a separate signed-out **Open app** header action, or copy that implies Save a copy is anonymous.
- Move every development and deployed trusted-Web route matcher that owns Preview document caching to the canonical Console Preview path while retaining `Cache-Control: no-store` on the legacy Preview path during migration.
- Keep `/api/artifacts`, database state, Worker behavior, CLI commands, Gallery policy, and the isolated Artifact-content runtime unchanged; Console is a Web surface rather than a new domain or API namespace.
- **BREAKING**: `/` is no longer the Gallery index, `/browse` becomes the Gallery index, and `/console` replaces `/artifacts` as the canonical personal-management address.
- Continue removing `/gallery` as an index and `/?view=login`, `/?view=signup`, and `/?view=reset` as account-entry addresses without compatibility aliases.
- Update `PRODUCT.md` and `CONTEXT.md` so the durable product contract owns Website, Console, routing, availability, and terminology.

## Capabilities

### New Capabilities

- `console-navigation`: Define the authenticated Console route tree, shell boundary, legacy Web-route migration, indexing behavior, and separation from administration and resource APIs.

### Modified Capabilities

- `gallery-discovery`: Separate the resilient public Website homepage at `/` from the gated Gallery index at `/browse`, retain anonymous discovery, update public Session navigation, and define availability, canonical, and indexing behavior.
- `account-entry`: Route direct sign-in to `/console`, validate public Website, Console, and administration return destinations, and preserve surface-aware sign-out and private-route indexing behavior.

## Impact

- Durable terminology and policy in `CONTEXT.md` and `PRODUCT.md`.
- Web routing, route-owned link generation, Session projection, metadata, and surface selection in `web/src/**`.
- Public Website, Console, account-entry, Preview, Gallery profile, and administration shells and route-level pages.
- Compatibility handling for former Web management paths and current root Gallery-selection queries.
- Trusted-Web development and deployment route matchers for the owner Preview document, plus checked interface benchmark scenarios.
- Route, Session, accessibility, metadata, bundle-boundary, and browser end-to-end tests under `web/src/**` and `web/e2e/**`.
- No HTTP API, database, Worker, CLI, Gallery-governance, object-storage, content-origin, or new frontend-framework change is expected.
