# Make Gallery the Public Home: Tasks

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
