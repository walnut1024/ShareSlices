# gallery-discovery Delta Specification

## ADDED Requirements

### Requirement: Project Session state into public Gallery navigation

The Web SHALL render public Gallery content independently from the current-Session check. While that check is unresolved, the public account area MUST reserve its layout without presenting a false signed-in or signed-out action. A signed-out Viewer or failed non-authoritative Session check SHALL see **Sign in**. A signed-in User SHALL see **My Artifacts** and the existing account menu without being redirected away from the public route.

#### Scenario: Public Session check is pending

- **WHEN** a Viewer opens a public Gallery route and the current-Session check has not resolved
- **THEN** Gallery content renders while the account area shows a stable non-text placeholder

#### Scenario: Signed-out Viewer sees account entry

- **WHEN** the current-Session check resolves without an authenticated User
- **THEN** the public header presents **Sign in** linked to `/sign-in` and does not present a competing sign-up action

#### Scenario: Signed-in User sees personal management

- **WHEN** the current-Session check resolves with an authenticated User
- **THEN** the public header presents **My Artifacts** linked to `/artifacts` and the existing account menu

#### Scenario: Public Session check fails

- **WHEN** the non-authoritative current-Session check fails while public Gallery content is otherwise available
- **THEN** the Web preserves the public content and resolves the account area to **Sign in** without presenting Gallery as authentication-gated

## MODIFIED Requirements

### Requirement: Expose public Gallery routes separately from Artifact management

When Gallery is enabled and deployment-eligible, the Web SHALL expose `/` as its one canonical public index, active `/gallery/{opaqueSlug}` listing pages, and `/creators/{opaqueSlug}` Creator profiles without requiring sign-in. Gallery navigation SHALL remain visible to signed-out and signed-in Viewers in that enabled state. `/artifacts` SHALL remain a separate authenticated personal management surface and MUST NOT serve as the public Gallery index. The former `/gallery` index MUST NOT redirect to or alias `/`, and the obsolete `view` query parameter on `/` MUST NOT select account-entry content.

#### Scenario: Signed-out Viewer opens Gallery

- **WHEN** a signed-out Viewer opens `/`
- **THEN** the Web displays the public Gallery without redirecting the Viewer to sign in

#### Scenario: Signed-in User opens the product root

- **WHEN** a signed-in User opens `/`
- **THEN** the Web displays Gallery instead of redirecting the User to personal Artifact management

#### Scenario: Signed-out Viewer opens a listing

- **WHEN** a signed-out Viewer opens the URL of an eligible active Gallery listing
- **THEN** the Web displays its trusted Gallery metadata page and fixed-Version player without requiring sign-in

#### Scenario: Viewer opens personal Artifact management

- **WHEN** a signed-out Viewer opens `/artifacts`
- **THEN** the Web requires authentication instead of treating the route as Gallery

#### Scenario: Signed-in User navigates the product

- **WHEN** a signed-in User opens any trusted management page while Gallery is enabled and eligible
- **THEN** Gallery remains a visible navigation destination distinct from personal Artifacts

#### Scenario: Former Gallery index is requested

- **WHEN** a Viewer opens `/gallery`
- **THEN** the Web presents ordinary not-found handling without redirecting to or rendering `/`

#### Scenario: Obsolete account view is requested on the root

- **WHEN** a Viewer opens `/` with a `view` query parameter formerly used for account entry
- **THEN** the Web renders the canonical Gallery index and does not open an account-entry page or preserve that parameter as a canonical URL

#### Scenario: Gallery navigation is unavailable

- **WHEN** Gallery is disabled or deployment-ineligible
- **THEN** the Web does not present Gallery as an available destination and `/` plus every direct public Gallery route follows the generic `503` contract without falling back to account entry

### Requirement: Index only trusted Gallery metadata after governance readiness

Before reporting, takedown, and administration are operational, the Web MUST mark the Gallery index, Creator profiles, and trusted listing metadata pages as excluded from search-engine indexing. After those governance gates are operational, the Web SHALL allow the canonical `/` Gallery index and eligible Creator and trusted listing metadata pages to be indexed. The Gallery index MUST identify `/` as its canonical URL; eligible Creator and listing pages MUST identify their own stable trusted URLs. Unavailable and not-found responses MUST remain excluded from indexing and MUST NOT retain a canonical URL from a previously rendered route. Artifact content responses from the Untrusted-content origin MUST remain excluded from indexing in every deployment state, and machine-discoverable links MUST point to the trusted listing page rather than directly to Artifact content.

#### Scenario: Governance is not ready

- **WHEN** a crawler requests a trusted Gallery, Creator profile, or listing metadata page before all indexing gates are operational
- **THEN** the response directs the crawler not to index the page

#### Scenario: Governance becomes operational

- **WHEN** reporting, takedown, and administration are all operational and Gallery indexing is enabled
- **THEN** the canonical `/` index and eligible trusted Creator and listing metadata pages no longer carry the pre-readiness indexing prohibition

#### Scenario: Crawler requests the Gallery index

- **WHEN** the enabled and eligible Gallery index is allowed to be indexed
- **THEN** its trusted page declares `/` as the canonical Gallery URL

#### Scenario: Crawler requests unavailable or unknown public content

- **WHEN** a public Gallery route produces unavailable or not-found handling
- **THEN** the response prohibits indexing and exposes no stale canonical link from another route

#### Scenario: Crawler requests Artifact content

- **WHEN** a crawler requests the fixed Version from the Untrusted-content origin
- **THEN** the response prohibits indexing and does not present that content URL as the canonical Gallery result
