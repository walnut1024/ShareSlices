# gallery-discovery delta specification

## ADDED Requirements

### Requirement: Expose public Gallery routes separately from Artifact management

When Gallery is enabled and deployment-eligible, the Web SHALL expose `/gallery`, active `/gallery/{opaqueSlug}` listing pages, and `/creators/{opaqueSlug}` Creator profiles without requiring sign-in. Gallery navigation SHALL remain visible to signed-out and signed-in Viewers in that enabled state. `/artifacts` SHALL remain a separate authenticated personal management surface and MUST NOT serve as the public Gallery index.

#### Scenario: Signed-out Viewer opens Gallery

- **WHEN** a signed-out Viewer opens `/gallery`
- **THEN** the Web displays the public Gallery without redirecting the Viewer to sign in

#### Scenario: Signed-out Viewer opens a listing

- **WHEN** a signed-out Viewer opens the URL of an eligible active Gallery listing
- **THEN** the Web displays its trusted Gallery metadata page and fixed-Version player without requiring sign-in

#### Scenario: Viewer opens personal Artifact management

- **WHEN** a signed-out Viewer opens `/artifacts`
- **THEN** the Web requires authentication instead of treating the route as Gallery

#### Scenario: Signed-in User navigates the product

- **WHEN** a signed-in User opens any trusted management page while Gallery is enabled and eligible
- **THEN** Gallery remains a visible navigation destination distinct from personal Artifacts

#### Scenario: Gallery navigation is unavailable

- **WHEN** Gallery is disabled or deployment-ineligible
- **THEN** the Web does not present Gallery as an available destination and any direct public Gallery route follows the generic `503` contract

### Requirement: Return non-disclosing public listing responses

When Gallery is enabled and eligible, a publicly accessible Listed revision SHALL return its trusted page and authorized content normally. An unknown slug, Pending listing, Removed listing, Restricted listing, Artifact takedown, or another temporary effective-access block MUST return a generic `404 Not Found` across the trusted listing page, public metadata, player authorization, Untrusted-content entry and asset, new or unknown-key Download and Save-a-copy acceptance, and report boundaries without title, Creator, Version, cover, tags, closure reason, governance state, or existence evidence. A Withdrawn listing, including Artifact- or account-deletion closure, MUST return a generic `410 Gone` across those listing-scoped boundaries even if a temporary governance block also exists. The `410` intentionally reveals only that the opaque address is permanently retired and MUST expose no metadata, closure cause, prior state, or historical content. Authenticated status reads or same-key replays for an already accepted copy operation use that operation identity rather than the public listing boundary and return only its durable operation state; they grant no new listing access.

When Gallery is disabled or deployment eligibility is lost, every Gallery index, Creator-profile, listing, metadata, player, content, new or unknown-key Download or Save-a-copy acceptance, and report entrypoint MUST return a generic `503 Service Unavailable` before resolving a public or listing identifier. That response MUST NOT reveal whether the requested resource exists or what state it has. Authenticated recovery of an already accepted operation remains a non-public operation read and is not a new Gallery entrypoint. The response precedence is: disabled or ineligible returns pre-lookup `503`; otherwise Withdrawn returns `410`; otherwise an effectively accessible Listed revision returns `200`; every other public listing state returns `404`.

#### Scenario: Viewer opens an eligible Listed revision

- **WHEN** Gallery is enabled and a Viewer opens a Listed revision with effective public access
- **THEN** the trusted listing page returns its public metadata and can authorize the revision-scoped player

#### Scenario: Viewer opens a non-public listing state

- **WHEN** Gallery is enabled and a Viewer requests an unknown, Pending, Removed, Restricted, taken-down, or otherwise temporarily inaccessible listing
- **THEN** the public boundary returns generic `404 Not Found` without listing or governance metadata

#### Scenario: Viewer opens a permanently withdrawn listing

- **WHEN** Gallery is enabled and a Viewer requests a listing closed as Withdrawn by the Creator, Artifact deletion, or account deletion
- **THEN** the public boundary returns generic `410 Gone` without listing, Creator, or closure metadata

#### Scenario: Viewer requests Gallery while deployment is ineligible

- **WHEN** Gallery is disabled or its deployment eligibility is lost
- **THEN** the public boundary returns generic `503 Service Unavailable` before resource lookup and exposes no listing-existence signal

### Requirement: Discover only publicly eligible listings

Gallery indexes, Newest, Featured, search, tag results, and Creator profile collections SHALL include only listings whose lifecycle is Listed, whose review status does not block public sharing, and whose complete effective-access projection remains eligible. A Listed and Reviewing listing SHALL remain discoverable until an authorized restriction, takedown, removal, or deployment decision changes its eligibility. Pending, Withdrawn, Removed, Restricted, taken-down, and otherwise effectively inaccessible listings MUST NOT appear in public discovery results.

#### Scenario: Listed content enters ordinary review

- **WHEN** a Listed listing changes from Clear to Reviewing without a Public-sharing restriction
- **THEN** the listing remains present in its otherwise applicable Gallery results

#### Scenario: Listing becomes Restricted

- **WHEN** a Listed listing receives a Restricted review status
- **THEN** the next public discovery response excludes it from Gallery, search, tags, Featured, Newest, and Creator profile collections

#### Scenario: Listing leaves the Listed lifecycle

- **WHEN** a listing becomes Withdrawn or Removed
- **THEN** no public discovery collection continues to return that listing

#### Scenario: Listed revision loses effective access

- **WHEN** a Listed revision becomes unavailable through Artifact takedown or another effective-access block without a lifecycle change
- **THEN** every public discovery collection excludes it until complete eligibility returns

### Requirement: Render static Gallery cards without executing Artifact content

Each Gallery card SHALL display only the static Gallery cover or its neutral placeholder, public title, Creator display name, tags, and immutable listing creation time. A card MUST NOT execute HTML, JavaScript, CSS, fonts, or other content from the fixed Version. Activating the card SHALL navigate to the trusted Gallery listing page rather than running the Artifact inside the collection view.

#### Scenario: Gallery cover is available

- **WHEN** an eligible listing with a completed Gallery cover appears in a Gallery collection
- **THEN** its card displays the static cover and public metadata without requesting executable Artifact content

#### Scenario: Gallery cover is unavailable

- **WHEN** an eligible listing's Gallery cover is pending, absent, or terminally failed
- **THEN** its card displays the neutral placeholder with the same public metadata and remains operable

#### Scenario: Viewer activates a card

- **WHEN** a Viewer activates a Gallery card
- **THEN** the Web navigates to `/gallery/{opaqueSlug}` before loading the Artifact player

### Requirement: Treat public Gallery metadata as bounded inert text

Gallery titles, descriptions, tags, Creator display names, and Creator biographies MUST be bounded plain-text values under contract-defined length and count limits. Trusted Gallery surfaces MUST render those values as escaped text and MUST NOT interpret embedded HTML, Markdown, URLs, URI schemes, event handlers, or other input as markup, navigation, or executable content.

A Creator avatar MUST be either platform-managed safe raster content or the neutral platform placeholder. Gallery MUST NOT accept or render a remote or tracking avatar URL, raw SVG, executable image content, or any avatar that causes the Viewer to fetch content from a Creator-controlled location.

#### Scenario: Listing metadata contains markup and script syntax

- **WHEN** a Creator submits a title or description containing HTML, an event handler, or script syntax within the allowed plain-text bounds
- **THEN** the trusted Gallery surface renders the submitted value only as escaped visible text and executes no markup or script

#### Scenario: Metadata contains a Markdown or URI payload

- **WHEN** a tag, Creator display name, or biography contains Markdown link syntax, a URL, or an executable URI scheme
- **THEN** the trusted Gallery surface renders the value as inert text and does not create a link, navigation, request, or executable action from it

#### Scenario: Metadata exceeds its bounds

- **WHEN** a submitted title, description, tag set, display name, or biography exceeds its contract-defined length or count limit
- **THEN** the write is rejected with field-specific validation and no unsafe or truncated public projection is published

#### Scenario: Creator supplies a remote tracking avatar

- **WHEN** a Creator supplies an external avatar URL that could identify or track a Viewer
- **THEN** the system rejects the URL and public surfaces request only a platform-managed safe raster avatar or display the neutral placeholder

#### Scenario: Creator supplies executable vector content

- **WHEN** a Creator attempts to use raw SVG or other executable image content as an avatar
- **THEN** the system rejects that avatar and does not expose or execute the submitted content on a public Gallery surface

### Requirement: Keep listing metadata trusted and Artifact execution isolated

The Gallery listing page SHALL render public metadata, navigation, Gallery download, Save a copy, Report, and Full screen controls in the trusted Web surface. It SHALL embed only the listing's currently committed fixed Version from the Untrusted-content origin. Entering or leaving Full screen MUST NOT change the fixed Version, listing lifecycle, review state, or Gallery permission grant.

#### Scenario: Viewer opens an active listing page

- **WHEN** a Viewer opens an eligible `/gallery/{opaqueSlug}` page
- **THEN** trusted metadata and controls render outside an embedded player that loads the listing's fixed Version from the Untrusted-content origin

#### Scenario: Viewer enters Full screen

- **WHEN** a Viewer activates the trusted Full screen control
- **THEN** the player presents the same fixed Version in Full screen without changing any listing or sharing state

#### Scenario: Owner updates a listing while a Viewer reloads

- **WHEN** an atomic Update Gallery operation commits before a Viewer reloads the trusted listing page
- **THEN** the page and player resolve the newly committed metadata and fixed Version under the unchanged listing URL

### Requirement: Create a privacy-preserving public Creator profile

The first explicit Share to Gallery operation for a User SHALL require the signed-in User to confirm a public Creator display name before the share commits and SHALL stage one Creator profile when none exists. The system MUST enforce one Creator profile per User and a profile concurrency revision. Concurrent first-share attempts MUST serialize profile staging before proposal acceptance: equivalent normalized confirmed fields MAY reuse the one staged profile, while different fields MUST return a profile-revision conflict and create no second profile or competing proposal. Profile PATCH MUST also use the expected revision and MUST NOT silently overwrite a concurrent edit. The profile MUST remain non-public while the initial listing is Pending and MUST become public only when any listing's first revision is promoted to Listed. A rejected initial proposal MUST NOT expose the staged profile. Once public, the profile SHALL remain public with an empty listing collection when the Creator has no publicly eligible listings, unless the account is deleted. The confirmation interface MAY prefill an existing non-email safe profile value, but it MUST NOT derive a display name from an email address or its local part. The profile SHALL use a stable system-generated opaque identifier, SHALL permit a non-unique Creator display name, an optional biography, and an optional platform-managed avatar, and SHALL list only the Creator's publicly eligible Listed Gallery revisions.

The authenticated Creator-profile management contract SHALL allow a signed-in Creator to `GET` and `PATCH` only their own staged or public profile. A successful change to a staged profile SHALL remain private. A successful change to an already public profile SHALL update the public profile and Gallery search projection without changing the Creator's opaque URL, a listing's stable identity or URL, or its immutable creation time. Public profile and discovery responses MUST NOT expose email, sign-in identifiers, credentials, private Artifact names, private management metadata, account identifiers, or private profile-management fields.

#### Scenario: User shares to Gallery for the first time

- **WHEN** a User with no Creator profile starts the first Share to Gallery operation
- **THEN** the system requires explicit confirmation of the public display name before committing the share or creating the public profile

#### Scenario: Existing safe profile value is available

- **WHEN** first-share confirmation opens for a User with a non-email safe profile name
- **THEN** the interface may prefill that value but still requires the User to confirm it for public Gallery use

#### Scenario: Only an email-derived identity value is available

- **WHEN** first-share confirmation opens and the only available account identity is an email address
- **THEN** the system leaves the public display name for the User to provide and does not prefill either the email address or its local part

#### Scenario: User confirms the first public profile

- **WHEN** a signed-in User confirms a valid public display name and the first Gallery listing revision is promoted to Listed
- **THEN** the system makes one profile public at an opaque `/creators/{opaqueSlug}` URL without exposing account identifiers

#### Scenario: Concurrent first shares confirm equivalent profile fields

- **WHEN** one User concurrently shares two Artifacts for the first time with equivalent normalized confirmed Creator-profile fields
- **THEN** the system creates or reuses exactly one staged profile and each otherwise valid share may reference it without creating duplicate profiles

#### Scenario: Concurrent first shares confirm different profile fields

- **WHEN** one User concurrently shares two Artifacts for the first time with different confirmed Creator-profile fields
- **THEN** the first profile transition advances the profile revision and the stale request returns a profile-revision conflict before creating its listing proposal or overwriting the profile

#### Scenario: Concurrent Creator profile edits conflict

- **WHEN** two profile updates compare against the same profile revision
- **THEN** the first valid update advances the revision and the stale update returns a revision conflict without overwriting public or staged fields

#### Scenario: Initial listing remains pending or is rejected

- **WHEN** the User's first Gallery proposal remains Pending or closes without a promoted public revision
- **THEN** the staged Creator profile and its fields remain unavailable through public Gallery and Creator routes

#### Scenario: Owner edits a staged profile

- **WHEN** the authenticated Owner updates a staged profile before any listing revision is promoted
- **THEN** the new fields remain private and absent from public Creator routes and search projection

#### Scenario: Creators use the same display name

- **WHEN** two Creator profiles choose the same display name
- **THEN** the system accepts both names and keeps the profiles distinct through their opaque identifiers

#### Scenario: Creator has private and public Artifacts

- **WHEN** a Viewer opens a Creator profile whose Creator owns unlisted, Pending, Restricted, or Withdrawn Artifacts
- **THEN** the profile returns only publicly eligible Listed revisions and reveals no private Artifact information

#### Scenario: Existing User has never shared to Gallery

- **WHEN** Gallery is enabled for an existing User who has not explicitly used Share to Gallery
- **THEN** no public Creator profile exists for that User

#### Scenario: Creator reads their own profile for management

- **WHEN** a signed-in Creator sends the authenticated `GET` operation for their own Creator profile
- **THEN** the system returns the editable public fields without including another User's profile or unrelated private account data

#### Scenario: Creator updates their own profile

- **WHEN** a signed-in Creator sends a valid authenticated `PATCH` for their own display name, avatar, or biography
- **THEN** the system updates public projection only if the profile is already public and always preserves the Creator URL and every existing listing identity, URL, and creation time

#### Scenario: Public Creator has no eligible listings

- **WHEN** a previously public Creator profile has zero publicly eligible listings
- **THEN** `/creators/{opaqueSlug}` returns `200` with the public profile and an empty collection without exposing private or closed Artifacts

#### Scenario: Creator profile is unknown or staged

- **WHEN** a Viewer requests an unknown or never-published staged Creator-profile slug while Gallery is enabled
- **THEN** the route returns generic `404 Not Found` without profile fields or an existence distinction

#### Scenario: User attempts to manage another Creator profile

- **WHEN** a signed-in User sends `GET` or `PATCH` against another Creator's management resource
- **THEN** the system denies access without disclosing private profile-management fields or account linkage

#### Scenario: Signed-out Viewer requests profile management

- **WHEN** a signed-out Viewer sends `GET` or `PATCH` to the authenticated Creator-profile management contract
- **THEN** the system requires authentication and returns no private profile-management data

#### Scenario: Creator account is deleted

- **WHEN** a Creator account deletion completes
- **THEN** its Creator route returns generic `404 Not Found` and does not expose the former display name, avatar, biography, email, or account data

### Requirement: Provide case-insensitive search and exact tag filtering

Gallery search SHALL match eligible listings without case sensitivity across public title, description, tags, and Creator display name. Tag filtering SHALL require an exact tag value rather than a substring. When a search query and tag filter are both supplied, the system MUST return only listings that satisfy both conditions.

#### Scenario: Viewer searches with different letter casing

- **WHEN** a Viewer searches for `QUARTERLY` and an eligible listing contains `Quarterly` in its public title, description, tag, or Creator display name
- **THEN** the search results include that listing regardless of the case difference

#### Scenario: Viewer filters by an exact tag

- **WHEN** a Viewer filters by tag `report`
- **THEN** results include eligible listings tagged `report` and exclude a listing tagged only `reporting`

#### Scenario: Viewer combines search and tag filter

- **WHEN** a Viewer supplies both a search query and an exact tag filter
- **THEN** every returned listing matches the query in at least one searchable field and has the exact requested tag

#### Scenario: Matching listing is not publicly eligible

- **WHEN** a Pending, Withdrawn, Removed, Restricted, taken-down, or otherwise effectively inaccessible listing matches the submitted search or tag
- **THEN** the public search response excludes that listing

### Requirement: Provide deterministic public discovery ordering

Gallery SHALL provide a default collection, a platform-curated Featured collection, and a Newest collection. The default Gallery, Newest, search results, exact-tag results, and Creator profile listing collections SHALL use the complete lexicographic order tuple `(listing creation time DESC, stable unique listing identifier DESC)`. Search SHALL use its query only to determine matches and MUST NOT reorder matches through relevance scores or another unstable ranking.

Featured SHALL include only listings placed by an authorized administrator that remain publicly eligible and SHALL use the complete lexicographic order tuple `(administrator position ASC, stable unique listing identifier ASC)`. A listing update MUST NOT change its immutable listing creation time or stable unique identifier.

View, Gallery download, Save a copy, and other engagement aggregates MUST NOT affect Featured, Newest, search ordering, or any automatic recommendation. The first release MUST NOT provide paid Featured placement or an algorithmic recommendation collection.

#### Scenario: Administrator features an eligible listing

- **WHEN** an authorized administrator adds a Listed and unrestricted listing to Featured
- **THEN** Featured includes it by administrator position and uses the stable listing identifier to break any position tie

#### Scenario: Featured listing becomes ineligible

- **WHEN** a Featured listing becomes Withdrawn, Removed, or Restricted
- **THEN** Featured excludes it because governance durably removes its placement, without requiring the Creator to change the listing

#### Scenario: Former Featured listing regains eligibility

- **WHEN** a listing becomes eligible after its prior Featured placement was removed
- **THEN** Featured continues to exclude it until an Administrator creates a new audited placement

#### Scenario: Listing is updated to another Version

- **WHEN** Update Gallery changes a listing's fixed Version or metadata
- **THEN** Newest keeps the listing at its original creation-time position

#### Scenario: Listings have the same creation time

- **WHEN** two eligible listings in the default Gallery, Newest, search, tag, or Creator collection have the same immutable creation time
- **THEN** the collection orders them by stable unique listing identifier descending

#### Scenario: Search matches have different relevance signals

- **WHEN** multiple eligible listings match the same search query with different match counts or fields
- **THEN** search orders them by listing creation time descending and stable unique listing identifier descending rather than by a relevance score

#### Scenario: Featured positions are equal

- **WHEN** two eligible Featured listings have the same administrator position
- **THEN** Featured orders them by stable unique listing identifier ascending

#### Scenario: Engagement changes

- **WHEN** a listing receives additional views, downloads, or saved copies
- **THEN** its ordering does not change because of those aggregates

### Requirement: Paginate public collections with stable cursors

Every public Gallery collection API, including Gallery indexes, Featured, Newest, search, exact-tag results, and Creator profile listings, SHALL use server-issued cursor pagination over its deterministic order. A cursor MUST resume after the last ordering key and stable unique tie-breaker from the preceding page. The public API MUST NOT use offset or page-number pagination for these collections.

#### Scenario: Viewer traverses an unchanged collection

- **WHEN** a Viewer follows successive cursors through an unchanged result set
- **THEN** every eligible listing appears at most once and no eligible listing between the first and final cursor is skipped

#### Scenario: Newer listing arrives after the first page

- **WHEN** a Viewer requests a later Newest page with a cursor after another listing is inserted ahead of that cursor
- **THEN** the later page resumes after the original boundary without repeating an item from the preceding page

#### Scenario: Viewer repeats a page request

- **WHEN** a Viewer repeats the same collection request with the same cursor against an unchanged result set
- **THEN** the API returns the same ordered page and next cursor

### Requirement: Index only trusted Gallery metadata after governance readiness

Before reporting, takedown, and administration are operational, the Web MUST mark Gallery indexes, Creator profiles, and trusted listing metadata pages as excluded from search-engine indexing. After those governance gates are operational, the Web SHALL allow eligible Gallery indexes, Creator profiles, and trusted listing metadata pages to be indexed. Artifact content responses from the Untrusted-content origin MUST remain excluded from indexing in every deployment state, and machine-discoverable links MUST point to the trusted listing page rather than directly to Artifact content.

#### Scenario: Governance is not ready

- **WHEN** a crawler requests a trusted Gallery, Creator profile, or listing metadata page before all indexing gates are operational
- **THEN** the response directs the crawler not to index the page

#### Scenario: Governance becomes operational

- **WHEN** reporting, takedown, and administration are all operational and Gallery indexing is enabled
- **THEN** eligible trusted Gallery indexes, Creator profiles, and listing metadata pages no longer carry the pre-readiness indexing prohibition

#### Scenario: Crawler requests Artifact content

- **WHEN** a crawler requests the fixed Version from the Untrusted-content origin
- **THEN** the response prohibits indexing and does not present that content URL as the canonical Gallery result

### Requirement: Present an explicit unsupported experience on mobile and tablet

Gallery SHALL support desktop browsers only in the first release. Response eligibility is resolved before device handling: disabled or ineligible routes return pre-lookup `503`, and unavailable listing or profile identities return their ordinary `404` or `410`. Only an otherwise accessible Gallery index, Creator profile, or Listed page returns the explicit mobile or tablet unsupported message instead of its desktop interface. ShareSlices MUST NOT imply a responsive player or rewrite or adapt Artifact layouts for those devices.

#### Scenario: Mobile Viewer opens Gallery

- **WHEN** a mobile browser opens an otherwise accessible Gallery index or Creator profile while Gallery is enabled and eligible
- **THEN** the Web presents the explicit unsupported experience instead of the desktop discovery or player interface

#### Scenario: Tablet Viewer opens a listing

- **WHEN** a tablet browser opens an otherwise accessible Listed Gallery URL while Gallery is enabled and eligible
- **THEN** the Web presents the explicit unsupported experience without loading the Artifact player as a supported tablet layout

#### Scenario: Desktop Viewer opens Gallery

- **WHEN** a supported desktop browser opens Gallery
- **THEN** the Web presents the public discovery experience and eligible listing pages

### Requirement: Limit first-release community interactions and public metrics

The trusted Gallery listing page SHALL expose View, Full screen, Save a copy, Gallery download, and Report as the first-release public interactions. Gallery cards, listing pages, search results, and Creator profiles MUST NOT display view, copy, or download counters. The first release MUST NOT expose likes, comments, follows, collections, private messages, paid promotion, algorithmic recommendations, private Gallery collections, or organization-scoped Gallery collections.

#### Scenario: Viewer opens a Gallery listing

- **WHEN** a Viewer opens an eligible listing page
- **THEN** the trusted surface presents the fixed-Version player and the Save a copy, Gallery download, Report, and Full screen controls without a social engagement control

#### Scenario: Listing has aggregate activity

- **WHEN** a listing has recorded views, downloads, or saved copies
- **THEN** Gallery cards, listing pages, search results, and Creator profiles do not expose those counters

#### Scenario: Viewer browses discovery collections

- **WHEN** a Viewer browses Gallery, Featured, Newest, search, tags, or Creator profiles
- **THEN** the Web presents no like, comment, follow, collection, private-message, paid-placement, or recommendation interaction

#### Scenario: User requests a non-public Gallery scope

- **WHEN** a User attempts to browse or create a private or organization-scoped Gallery collection
- **THEN** the first release provides no such discovery surface and leaves the public Gallery unchanged
