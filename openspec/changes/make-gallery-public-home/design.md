# Make Gallery the Public Home: Design

## Context

Gallery is already implemented as a public trusted-Web surface at `/gallery`, with public listing details at `/gallery/{opaqueSlug}` and Creator profiles at `/creators/{opaqueSlug}`. Account entry currently occupies `/` and selects sign-up, sign-in, or password reset through a `view` query parameter. Public Gallery routes bypass the management-session check entirely, so the public header always presents a signed-out state even when the browser has a valid Session.

The product contract already separates public Gallery discovery from authenticated Artifact management and limits the supported Web experience to desktop browsers. This change moves the existing public index rather than creating a new landing page, preserves the current Gallery eligibility and response-precedence rules, and introduces no API or data-model work.

## Goals / Non-Goals

**Goals:**

- Make `/` the canonical Gallery index for signed-out and signed-in Viewers.
- Give sign-in, sign-up, and the current multi-stage password-reset journey stable dedicated paths.
- Project Session state into public navigation without delaying public Gallery content.
- Preserve only validated trusted Web destinations through sign-in.
- Keep public, account-entry, management, unavailable, and not-found routes distinct in navigation and search metadata.
- Remove the old Gallery index and query-selected account-entry addresses without compatibility behavior.

**Non-Goals:**

- Changing Gallery eligibility, listing response precedence, content isolation, or public APIs.
- Adding a marketing landing page, mobile layout, social sign-in, or a second password-recovery page.
- Adding a routing library, global state store, API endpoint, database migration, or Worker change.
- Changing Share to Gallery submission or completion semantics.

## Decisions

### 1. Use one canonical route table

The Web route model will use these canonical addresses:

| Surface | Route |
| --- | --- |
| Gallery index | `/` |
| Gallery listing | `/gallery/{opaqueSlug}` |
| Creator profile | `/creators/{opaqueSlug}` |
| Sign in | `/sign-in` |
| Sign up | `/sign-up` |
| Password reset | `/reset-password` |
| Artifact management | `/artifacts` and its existing descendants |

`/gallery` will resolve through ordinary unknown-route handling instead of redirecting. The `view` query parameter on `/` will no longer select account content; `/` remains Gallery regardless of that obsolete parameter. New navigation will never emit the removed addresses.

Lowercase kebab-case keeps page paths aligned with the visible **Sign in** and **Sign up** vocabulary and the existing multi-word route convention. The password-reset request, code, new-password, and completion states remain one `/reset-password` journey because they are not independently addressable resources today.

Alternative: retain aliases or redirects for old addresses. Rejected because the product decision explicitly removes them and no checked external callback or email contract depends on them.

### 2. Centralize route classification without adding a router dependency

Route selection will move behind one pure route classifier that returns a small discriminated route value for public Gallery, account entry, device authorization, authenticated management, and not-found destinations. Rendering, session requirements, post-authentication behavior, and document metadata will consume that same classification.

This removes scattered prefix and query checks while staying proportional to the current application. A full routing dependency is unnecessary for the route count and would broaden the change into application-framework migration.

Alternative: add more conditionals directly to `App.tsx`. Rejected because public Session projection, route metadata, protected-return handling, and not-found behavior would then continue deriving route meaning independently.

### 3. Render public Gallery independently from Session projection

Gallery data and eligibility rendering will start immediately. In parallel, the Web will perform the existing current-user check for the public shell:

- while unresolved, the account area uses a stable, non-text placeholder;
- unauthenticated or failed checks resolve to **Sign in**;
- an authenticated Session resolves to **My Artifacts** plus the existing account menu.

A Session lookup failure does not turn a public route into an error or suppress Gallery content. No new polling or global store is introduced; the application-level Session projection remains the single Web source for account navigation.

Alternative: block Gallery until the current-user request completes. Rejected because authentication is not a prerequisite for public discovery and would make Session latency or failure look like Gallery failure.

### 4. Validate post-sign-in destinations as product routes

When a signed-out Viewer reaches a protected management route, the Web opens `/sign-in` with one encoded `returnTo` path. Sign-in accepts only an absolute-path reference on the current Web origin that resolves to an allowlisted Gallery or management route; protocol-relative values, external origins, account-entry loops, device authorization, and unknown routes are rejected. Query and fragment components are retained only after the route itself passes validation.

Successful sign-in follows a valid `returnTo`; otherwise it opens `/artifacts`. A signed-in User who opens `/sign-in`, `/sign-up`, or `/reset-password` follows the same valid destination rule and otherwise opens `/artifacts`. This keeps direct sign-in management-oriented while allowing Gallery actions that require authentication to return to their originating public page.

Alternative: accept any string beginning with `/`. Rejected because `//host` forms and unclassified internal destinations make the redirect boundary too permissive.

### 5. Make sign-out destination depend on the current surface

The account menu uses the existing current-Session deletion operation. After success or an already-unauthenticated result:

- a public Gallery or Creator route remains at its current address and projects the signed-out header;
- an authenticated management route replaces its current history entry with `/`.

Network or Server failure retains the local Session projection and existing neutral error feedback. This avoids sending a browsing Viewer away from public content while ensuring a signed-out User is not left on a protected page.

Alternative: always open `/sign-in`. Rejected because sign-out does not make Gallery private and the product homepage is now the natural safe destination.

### 6. Derive canonical and indexing metadata from route class

The Gallery index will emit `/` as its canonical URL. Eligible trusted listing and Creator pages retain their stable canonical URLs and existing governance-readiness indexing gate. Account-entry, management, device-authorization, unavailable, and not-found pages will be excluded from indexing and will not inherit a stale public canonical element during client-side navigation.

The implementation will give one route-metadata owner responsibility for setting and cleaning up the document title, robots directive, and canonical link. This is necessary in a single-page application where metadata from a prior public listing can otherwise leak onto the next route.

Alternative: let each page independently append metadata. Rejected because cleanup and route transitions would remain inconsistent.

### 7. Update the durable contract and test routing as behavior

`PRODUCT.md` will replace `/gallery` with `/` as the public index and refine the unconditional post-sign-in statement to account for validated originating destinations. Unit coverage will exercise the route classifier and destination validator. Web integration coverage will exercise signed-out and signed-in root entry, protected redirects, account-route behavior, sign-out destinations, unavailable Gallery, not-found routes, and metadata cleanup. Browser coverage will verify the public-to-authentication-to-return flow and supported `1440x900` navigation.

## Risks / Trade-offs

- [Removing old addresses can break bookmarks] → This is an accepted breaking product decision; tests will assert that no application link emits or aliases the removed addresses.
- [A failed Session check can briefly show an account placeholder] → Reserve its layout footprint and resolve failure to **Sign in** without blocking Gallery.
- [A permissive `returnTo` becomes an open redirect or unintended workflow entry] → Centralize route parsing and allow only classified same-origin Gallery and management destinations.
- [SPA metadata can remain from the previous route] → Make metadata replacement and cleanup part of route transitions and test navigation in both directions.
- [Root Gallery becomes `503` when the Gallery eligibility gate is closed] → Preserve the existing fail-closed public contract and show the public unavailable frame rather than falling back to account entry.
- [Active Gallery feedback changes also touch public links] → Keep this change limited to route destinations and verify the existing `View in Gallery` behavior instead of redesigning feedback.

## Migration Plan

1. Update `PRODUCT.md` and the Web route tests to express the new route contract.
2. Introduce centralized route classification, destination validation, and route metadata ownership.
3. Move account-entry links and protected-route handling to the canonical paths.
4. Project current Session state into the public shell and apply surface-aware sign-out navigation.
5. Remove all generation and handling of `/gallery` and `/?view=...` index/account addresses.
6. Run focused Web tests, browser routing coverage, document checks, and the repository quality gate.

Rollback requires reverting the Web and product-contract changes together. There is no database or API rollback.

## Open Questions

None.
