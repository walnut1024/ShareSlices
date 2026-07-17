# Make Gallery the Public Home

## Why

ShareSlices defines Gallery as a public discovery surface, but the Web root currently opens account entry and makes the product appear sign-in-gated. Making Gallery the root experience gives signed-out Viewers the intended public entry point while keeping personal Artifact management explicitly authenticated.

## What Changes

- Make `/` the canonical public Gallery index for signed-out and signed-in Viewers.
- Add dedicated lowercase kebab-case account routes: `/sign-in`, `/sign-up`, and `/reset-password`.
- Keep `/gallery/{opaqueSlug}` and `/creators/{opaqueSlug}` as public detail routes and keep `/artifacts` as the authenticated management surface.
- Make the public Gallery header session-aware without blocking Gallery rendering: signed-out Viewers see **Sign in**; signed-in Users see **My Artifacts** and account controls.
- Preserve a validated same-origin management or Gallery destination across sign-in; direct sign-in opens `/artifacts`.
- Define route-specific sign-out, unavailable, not-found, canonical, and search-indexing behavior for public, account-entry, and management surfaces.
- **BREAKING**: Remove `/gallery` as the Gallery index and remove the `/?view=login`, `/?view=signup`, and `/?view=reset` account-entry addresses without redirects or compatibility aliases.
- Update `PRODUCT.md` so the durable product contract names `/` as Gallery and permits origin-aware post-sign-in navigation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gallery-discovery`: Move the public Gallery index to `/`, define public-header session behavior, remove the former `/gallery` index, and make root, detail, unavailable, not-found, canonical, and indexing behavior explicit.
- `account-entry`: Move Web account entry to dedicated routes and define validated return destinations, signed-in route handling, protected-route entry, sign-out destinations, and indexing behavior.

## Impact

- Web routing and session projection in `web/src/App.tsx` and the public and authenticated shells.
- Account-entry and Gallery navigation links, including Share-to-Gallery completion links.
- Route, session, accessibility, metadata, and browser end-to-end tests under `web/src/**` and `web/e2e/**`.
- Durable product policy in `PRODUCT.md` and the modified OpenSpec capability contracts.
- No API, database, Worker, CLI, or new dependency change is expected.
