# gallery-discovery Delta Specification

## ADDED Requirements

### Requirement: Project Session state into public Website navigation

The Web SHALL render public Website content independently from the current-Session check. While that check is unresolved, the public account area MUST reserve its layout without presenting a false signed-in or signed-out action. A signed-out Viewer or failed non-authoritative Session check SHALL see **Sign in** without a separate **Open app** header action. A signed-in User SHALL see **My Artifacts** linked to `/console` and the existing account menu without being redirected away from the public route.

#### Scenario: Public Session check is pending

- **WHEN** a Viewer opens a public Website route and the current-Session check has not resolved
- **THEN** public content renders while the account area shows a stable non-text placeholder

#### Scenario: Signed-out Viewer sees account entry

- **WHEN** the current-Session check resolves without an authenticated User
- **THEN** the public header presents **Sign in** linked to `/sign-in` and does not present a competing sign-up or **Open app** action

#### Scenario: Signed-in User sees Console entry

- **WHEN** the current-Session check resolves with an authenticated User
- **THEN** the public header presents **My Artifacts** linked to `/console` and the existing account menu

#### Scenario: Public Session check fails

- **WHEN** the non-authoritative current-Session check fails while public Website content is otherwise available
- **THEN** the Web preserves the public content and resolves the account area to **Sign in** without presenting the Website or Gallery as authentication-gated

#### Scenario: Visitor selects an ownership call to action

- **WHEN** a signed-out visitor selects an ownership action such as **Start publishing**
- **THEN** the Web opens `/sign-in` with `/console` as the validated `returnTo` and does not imply that ownership work is anonymous

#### Scenario: Signed-in User selects an ownership call to action

- **WHEN** a signed-in User selects an ownership action from Website
- **THEN** the Web opens `/console`

## MODIFIED Requirements

### Requirement: Expose public Gallery routes separately from Artifact management

The Web SHALL expose `/` as the canonical public Website homepage without requiring sign-in. When Gallery is enabled and deployment-eligible, the homepage SHALL request the existing Featured collection with `limit=8`. If and only if that eligible request succeeds with no listings, the homepage SHALL request the existing Newest collection once with `limit=8`; it MUST NOT request Newest after a nonempty or unavailable Featured result and MUST NOT render more than eight Artifact cards. Every rendered Artifact card SHALL open its trusted `/gallery/{opaqueSlug}` listing page, **Browse all** SHALL open `/browse`, and homepage search SHALL open `/browse?q={encodedQuery}`. The Web SHALL expose `/browse` as the canonical full Gallery index, active `/gallery/{opaqueSlug}` listing pages, and `/creators/{opaqueSlug}` Creator profiles without requiring sign-in. `/browse` SHALL retain the existing default, Featured, Newest, search, exact-tag, and cursor-pagination contracts and MUST NOT add an engagement-ranked collection or public engagement count. Gallery navigation SHALL remain visible to signed-out and signed-in Viewers while Gallery is available. `/console` SHALL remain a separate authenticated personal-management surface and MUST NOT serve as a public Gallery index.

When Gallery is disabled or deployment-ineligible, `/` SHALL remain available with its non-Gallery Website content and MUST NOT expose Gallery resource data or an active Gallery destination. The Gallery data and content boundaries behind `/browse`, Creator profiles, listing pages, interactions, and content routes SHALL follow the existing generic pre-lookup `503` contract, and their client-rendered trusted Web pages SHALL present the corresponding unavailable state. Public navigation MUST NOT advertise Gallery as active after that unavailable result resolves. The former `/gallery` index MUST NOT redirect to or alias `/browse`, and an obsolete account-entry `view` value on `/` MUST NOT select account-entry content.

#### Scenario: Signed-out visitor opens the Website

- **WHEN** a signed-out visitor opens `/`
- **THEN** the Web displays the public Website without redirecting the visitor to sign in

#### Scenario: Signed-in User opens the Website

- **WHEN** a signed-in User opens `/`
- **THEN** the Web displays the public Website instead of redirecting the User to Console

#### Scenario: Featured homepage discovery contains listings

- **WHEN** Gallery is enabled and eligible and the Featured request returns one or more listings
- **THEN** the Website does not request Newest, renders at most eight returned Artifact cards without public engagement counts, and each card opens its trusted listing page

#### Scenario: Featured homepage discovery is empty

- **WHEN** Gallery is enabled and eligible and the Featured request succeeds with no listings
- **THEN** the Website requests Newest exactly once with `limit=8` and renders at most eight returned Artifact cards

#### Scenario: Featured homepage discovery is unavailable

- **WHEN** the homepage Featured request resolves with the Gallery-unavailable result
- **THEN** the Website does not request Newest and exposes neither cached Gallery resource evidence nor an active Gallery destination

#### Scenario: Visitor searches from the homepage

- **WHEN** a visitor submits a nonempty homepage Gallery search
- **THEN** the Website opens `/browse` with the encoded search text in its `q` query instead of rendering a second search-results surface at `/`

#### Scenario: Signed-out Viewer opens full Gallery discovery

- **WHEN** Gallery is enabled and eligible and a signed-out Viewer opens `/browse`
- **THEN** the Web displays the full public Gallery index without requiring sign-in

#### Scenario: Viewer changes the Browse collection

- **WHEN** a Viewer searches, selects an exact tag, opens Featured or Newest, or follows a next cursor from `/browse`
- **THEN** the Web keeps that state under `/browse` and uses the existing Gallery collection and pagination contracts

#### Scenario: Signed-out Viewer opens a listing

- **WHEN** a signed-out Viewer opens the URL of an eligible active Gallery listing
- **THEN** the Web displays its trusted Gallery metadata page and fixed-Version player without requiring sign-in

#### Scenario: Viewer opens personal Artifact management

- **WHEN** a signed-out Viewer opens `/console`
- **THEN** the Web requires authentication instead of treating the route as Website or Gallery content

#### Scenario: Signed-in User navigates the product

- **WHEN** a signed-in User opens Console while Gallery is enabled and eligible
- **THEN** the public Website and Gallery remain visible navigation destinations distinct from personal Artifacts

#### Scenario: Former Gallery index is requested

- **WHEN** a Viewer opens `/gallery`
- **THEN** the Web presents ordinary not-found handling without redirecting to or rendering `/browse`

#### Scenario: Obsolete account view is requested on the root

- **WHEN** a Viewer opens `/` with a `view` query parameter formerly used for account entry
- **THEN** the Web renders the canonical Website homepage and does not open an account-entry page or preserve that parameter as a canonical URL

#### Scenario: Current root Gallery selection is requested

- **WHEN** a Viewer opens `/` with `q`, `tag`, or `view=featured|newest` state generated by the first increment
- **THEN** the Web replaces the location with the equivalent `/browse` query before rendering collection results

#### Scenario: Unrelated Website query is requested

- **WHEN** a visitor opens `/` with no recognized Gallery-selection query
- **THEN** the Web keeps the Website route and does not reinterpret unrelated query state as Gallery discovery

#### Scenario: Gallery is unavailable while Website remains available

- **WHEN** Gallery is disabled or deployment-ineligible and a visitor opens `/`
- **THEN** the Website remains available without listing, Creator, cover, count, or resource-state evidence and does not present Gallery as an active destination

#### Scenario: Viewer opens a gated Gallery route while Gallery is unavailable

- **WHEN** Gallery is disabled or deployment-ineligible and a Viewer opens `/browse`, a Creator profile, or a listing route
- **THEN** its Gallery data boundary returns the generic pre-lookup `503` and the hydrated Web page presents unavailable handling without falling back to account entry or taking down `/`

#### Scenario: Gallery navigation resolves unavailable

- **WHEN** a public route resolves Gallery as disabled or deployment-ineligible
- **THEN** its public shell retains Website navigation but no longer presents Gallery as an active destination

### Requirement: Index only trusted Gallery metadata after governance readiness

The shared client-rendered Web document SHALL start with `noindex,nofollow` and no canonical URL. After hydration, the public Website homepage SHALL identify `/` as its canonical URL and MUST NOT inherit Gallery's governance-readiness indexing prohibition solely because Gallery is unavailable. Before reporting, takedown, and administration are operational, hydrated metadata MUST keep `/browse`, Creator profiles, and trusted listing metadata pages excluded from search-engine indexing. After those governance gates are operational, the Web SHALL allow the canonical `/browse` Gallery index and eligible Creator and trusted listing metadata pages to be indexed. Eligible Creator and listing pages MUST identify their own stable trusted URLs. Loading, unavailable, gone, and not-found states MUST remain excluded from indexing and MUST NOT retain a canonical URL from a previously rendered route. Artifact content responses from the Untrusted-content origin MUST remain excluded from indexing in every deployment state, and machine-discoverable links MUST point to the trusted listing page rather than directly to Artifact content. This client metadata requirement does not claim a route-specific HTTP document status.

#### Scenario: Shared Web document has not hydrated

- **WHEN** the trusted client-rendered document is returned before route code or public data resolves
- **THEN** it contains `noindex,nofollow` and no canonical URL

#### Scenario: Website homepage hydrates

- **WHEN** `/` hydrates while Gallery is unavailable or not yet ready for indexing
- **THEN** the Website identifies `/` as canonical and does not inherit Gallery's readiness-based `noindex` solely from that state

#### Scenario: Governance is not ready

- **WHEN** `/browse`, a Creator profile, or trusted listing metadata hydrates before all Gallery indexing gates are operational
- **THEN** the document metadata directs crawlers not to index the page

#### Scenario: Governance becomes operational

- **WHEN** reporting, takedown, and administration are all operational and Gallery indexing is enabled
- **THEN** `/browse` and eligible trusted Creator and listing metadata pages no longer carry the pre-readiness indexing prohibition

#### Scenario: Crawler requests the Gallery index

- **WHEN** the enabled and eligible Gallery index is allowed to be indexed
- **THEN** its trusted page declares `/browse` as the canonical Gallery URL

#### Scenario: Crawler requests unavailable or unknown public content

- **WHEN** a public Gallery route hydrates unavailable, gone, or not-found handling
- **THEN** the document metadata prohibits indexing and exposes no stale canonical link from another route

#### Scenario: Crawler requests Artifact content

- **WHEN** a crawler requests the fixed Version from the Untrusted-content origin
- **THEN** the response prohibits indexing and does not present that content URL as the canonical Gallery result
