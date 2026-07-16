# gallery-listing Specification

## Purpose

TBD - created by archiving change add-gallery-community-sharing. Update Purpose after archive.

## Requirements

### Requirement: Keep Gallery listing independent from link sharing

The system SHALL model a Gallery listing as a separate authorization for one fixed ready Version. Share to Gallery, Update Gallery, and Withdraw from Gallery MUST NOT create, replace, extend, expire, or stop an Artifact's Publication or Share link. Publish, Unpublish, Share with link, Manage link, and Stop sharing link MUST NOT create, update, withdraw, or restore a Gallery listing.

#### Scenario: Owner shares an unlisted Artifact to Gallery

- **WHEN** an Owner completes Share to Gallery for an Artifact with no Publication
- **THEN** the system creates a Gallery listing without creating a Publication or Share link

#### Scenario: Owner changes link sharing

- **WHEN** an Owner Publishes, Unpublishes, or replaces the Share link of an Artifact with an active Gallery listing
- **THEN** the listing keeps its fixed Version, Gallery listing URL, metadata, and lifecycle state unchanged

#### Scenario: Owner withdraws while a Share link is active

- **WHEN** an Owner withdraws an Artifact's active Gallery listing while its Publication is accessible
- **THEN** the system closes only the Gallery listing and leaves the Publication and Share link unchanged

### Requirement: Share one owned ready Version

The system SHALL let a signed-in Owner create at most one active Gallery listing for an owned Artifact. Share to Gallery SHALL target exactly one Artifact per operation, SHALL default to the Artifact's latest ready Version, and SHALL also let the Owner select any historical ready Version owned by that Artifact. The first release MUST NOT provide batch Share to Gallery. The system MUST reject missing, accepted, processing, failed, or foreign Versions without creating or changing a listing. Before the system accepts an initial proposal or stages a Creator profile, the request MUST satisfy the versioned Gallery permission-grant precondition owned by `gallery-governance`.

Pending and Listed listings, including Listed listings under review or restriction, SHALL count as active for the one-listing constraint. Withdrawn and Removed listings SHALL be inactive. Every transition to Withdrawn or Removed MUST record a stable closure reason. A Creator MUST NOT restore a Withdrawn listing, restore a never-public Removed listing, or bypass an Administrator Removal or Public-sharing restriction that remains in force or a pending Appeal by creating a replacement listing. A corrected `initial_policy_rejection` and a fully cleared or reversed `initial_governance_block` MAY start a normally validated fresh listing with a new slug. After an `administrator_removal` decision is reversed but before its old listing is restored, replacement Share to Gallery MUST require explicit irreversible confirmation that creating the replacement permanently forfeits restoration of the old listing URL, identity, and counters.

#### Scenario: Owner accepts the default Version

- **WHEN** an Owner opens Share to Gallery for an Artifact with multiple ready Versions and does not override the Version
- **THEN** the operation selects the latest ready Version

#### Scenario: Owner selects a historical ready Version

- **WHEN** an Owner selects an older ready Version owned by the target Artifact
- **THEN** the new listing fixes Gallery access to that selected immutable Version

#### Scenario: Owner selects an ineligible Version

- **WHEN** an Owner attempts to share a non-ready Version or a Version belonging to another Artifact
- **THEN** the system rejects the operation and leaves Gallery and link-sharing state unchanged

#### Scenario: Artifact already has an open listing

- **WHEN** an Owner attempts to create another Gallery listing for an Artifact whose listing is Pending or Listed
- **THEN** the system rejects creation of a second listing and directs management to the existing listing

#### Scenario: Owner corrects an initial policy rejection

- **WHEN** an eligible Owner submits a corrected Share to Gallery after `initial_policy_rejection`
- **THEN** the system applies normal current validation to a new listing and slug without restoring or reusing the rejected listing

#### Scenario: Initial governance block is fully cleared

- **WHEN** every takedown, restriction, and pending Appeal that caused `initial_governance_block` is cleared or reversed and the Owner submits Share to Gallery
- **THEN** the system applies normal current validation to a new listing and slug without restoring or reusing the blocked listing

#### Scenario: Owner chooses replacement after reversed Administrator Removal

- **WHEN** an eligible Owner confirms replacement Share to Gallery after `administrator_removal` is reversed but before the old listing is restored
- **THEN** the system creates a new listing through normal validation and permanently marks the old listing, URL, identity, and counters non-restorable

#### Scenario: Replacement after Administrator Removal lacks confirmation

- **WHEN** an Owner requests that replacement without confirming permanent forfeiture of the old listing's restoration
- **THEN** the system requires irreversible confirmation and creates or changes no listing

#### Scenario: Non-owner attempts to share an Artifact

- **WHEN** a signed-in User attempts Share to Gallery for an Artifact the User does not own
- **THEN** the system denies the operation without revealing or changing the Artifact's listing state

#### Scenario: Owner attempts a batch Gallery share

- **WHEN** an Owner attempts to create Gallery listings for multiple Artifacts in one operation
- **THEN** the first release rejects the batch operation without creating any listing

### Requirement: Maintain listing-specific public metadata

Share to Gallery SHALL require a public title, SHALL prefill that title from the Owner-facing Artifact name, SHALL accept an optional description, and SHALL require one through five tags. Gallery metadata SHALL remain independent from the Owner-facing Artifact name and other private management metadata. The system MUST reject a missing public title, zero tags, or more than five tags without changing the listing.

#### Scenario: Owner accepts the initial metadata defaults

- **WHEN** an Owner opens Share to Gallery for an Artifact named `Quarterly report`, provides one valid tag, and leaves the prefilled title unchanged
- **THEN** the listing uses `Quarterly report` as its public title without changing the Artifact name

#### Scenario: Owner supplies public metadata

- **WHEN** an Owner provides a public title, optional description, and one through five tags
- **THEN** the system stores those values as Gallery metadata for the listing

#### Scenario: Owner submits invalid tag count

- **WHEN** an Owner submits Share to Gallery or Update Gallery with zero tags or more than five tags
- **THEN** the system rejects the mutation and preserves the previously committed state

#### Scenario: Owner renames the source Artifact

- **WHEN** an Owner renames an Artifact after its Gallery listing has been created
- **THEN** the listing's public title remains unchanged until an explicit Update Gallery operation changes it

### Requirement: Expose separate listing and review classifications

The system SHALL classify Gallery listing lifecycle as Pending, Listed, Withdrawn, or Removed and SHALL classify review state independently as Clear, Reviewing, or Restricted. Pending SHALL represent a listing with no committed public revision whose initial proposal has not been promoted, and Listed SHALL represent an open listing with a committed public revision. Creator withdrawal SHALL move a Pending or Listed listing to Withdrawn. Artifact or account deletion SHALL move a Pending, Listed, or previously public `administrator_removal` listing to Withdrawn; a never-public Removed listing MUST remain Removed and record the source-deletion event. Removed SHALL otherwise represent an initial policy or governance block or an Administrator removal. Current closure reasons MUST distinguish `creator_withdrawal`, `artifact_deleted`, `account_deleted`, `initial_policy_rejection`, `initial_governance_block`, and `administrator_removal` and MUST be populated only while terminal. Every close and restore SHALL append immutable lifecycle history. Eligible restoration SHALL clear the current closure reason without erasing the prior event; a later close SHALL set the new reason. A review-state transition MUST NOT silently rewrite lifecycle history, and a pending update proposal MUST NOT move an already Listed listing back to Pending.

Restricted SHALL be the listing projection of an Artifact-level Public-sharing restriction. It MUST NOT become a second independently clearable restriction authority. Clear and Reviewing MAY remain publicly eligible, while Restricted MUST block effective access without rewriting lifecycle.

Every listing lifecycle transition MUST compare and advance the same listing concurrency revision. Ordinary competing terminal transitions from one base revision, including Creator withdrawal, initial rejection, initial governance block, and Administrator Removal, MUST serialize with first commit winning. A loser MUST return a stable current-state or revision-conflict result and MUST NOT overwrite lifecycle, closure reason, proposal closure, Appeal eligibility, restoration eligibility, or `404` versus `410` behavior. Artifact and account deletion use the same boundary; their specified conversion of a previously public `administrator_removal` is the only allowed terminal-state overwrite. If another terminal state commits first, deletion MAY append its source-deletion event and remove the source but MUST preserve that listing's existing terminal projection.

#### Scenario: Listing awaits a decision

- **WHEN** a submitted initial listing proposal has no promoted committed revision
- **THEN** the system reports the listing as Pending rather than Listed

#### Scenario: Listed content enters review

- **WHEN** a Gallery report moves a Listed and Clear listing into review without a restriction decision
- **THEN** the system reports lifecycle Listed and review status Reviewing as separate values

#### Scenario: Listed content has a pending update proposal

- **WHEN** an update proposal for a Listed listing requires review while the committed revision remains eligible
- **THEN** the system keeps lifecycle Listed, reports review status Reviewing, and does not expose the proposed revision

#### Scenario: Platform removes a listing

- **WHEN** an authorized governance decision removes a Gallery listing
- **THEN** the system reports lifecycle Removed with closure reason `administrator_removal` without representing the action as Creator withdrawal

#### Scenario: Platform restoration returns a listing to Listed

- **WHEN** an eligible `administrator_removal` is restored
- **THEN** the system returns the listing to Listed, clears its current closure reason, and preserves the removal and restoration as immutable lifecycle events

#### Scenario: Administrator Removal races Creator withdrawal

- **WHEN** Remove from Gallery and Withdraw from Gallery compare against the same Listed revision
- **THEN** exactly one terminal transition commits and the loser returns the resulting current state without changing its lifecycle, closure reason, URL response, or Appeal and restoration rights

#### Scenario: Pending withdrawal races initial closure

- **WHEN** Creator withdrawal races an initial policy rejection or governance block from the same Pending revision
- **THEN** the first committed transition closes the proposal and the stale transition cannot overwrite Withdrawn with Removed or Removed with Withdrawn

#### Scenario: Source deletion races another terminal transition

- **WHEN** Artifact or account deletion races an ordinary terminal transition
- **THEN** they serialize through the listing revision; deletion may perform the specified conversion of a previously public `administrator_removal`, but otherwise preserves a terminal state that committed first while still recording and applying source deletion

### Requirement: Stage proposed revisions before public promotion

Share to Gallery and Update Gallery SHALL stage the selected Version, Gallery metadata, applicable grant-evidence reference, and base listing revision as a non-public listing-revision proposal before changing Gallery authorization. A listing SHALL have at most one open proposal. An initial listing with no committed public revision SHALL remain Pending and non-public until its proposal passes all activation preconditions. A Listed listing with an open update proposal SHALL continue to authorize only its current committed revision until the proposal passes and is atomically promoted.

Promotion MUST verify that the listing is still active, the proposal's base revision still matches the current listing revision, the proposal satisfies the safety and permission-grant preconditions owned by `gallery-governance`, and no active Public-sharing restriction or Artifact takedown, Administrator Removal still in force, or pending Appeal blocks the transition. A successful promotion SHALL atomically replace the committed projection and advance the listing revision once without clearing an independent governance state. Rejection, failed checks, stale concurrency, a governance block, or failed persistence MUST leave any prior committed revision unchanged and MUST preserve or block public authorization according to the independent effective-access state.

A policy or review rejection of an initial proposal with no committed revision SHALL move the Pending listing to Removed with closure reason `initial_policy_rejection`, permanently keep its unexposed slug non-public, and permit only a corrected fresh Share to Gallery through normal validation rather than Appeal or restoration. A governance block applied to an initial Pending listing SHALL close its proposal and move the listing to Removed with closure reason `initial_governance_block`; only reversal or clearance that leaves no decision in force MAY permit a fresh Share to Gallery, and it MUST NOT restore or reuse the old listing or slug. Rejection or governance blocking of an update proposal SHALL close only that proposal and preserve the committed revision. Withdrawing, removing, otherwise closing a listing, or applying a governance block MUST atomically close every open proposal so that a later asynchronous check or review decision cannot promote it.

#### Scenario: Suspicious initial proposal awaits review

- **WHEN** an initial Share to Gallery proposal requires human review
- **THEN** the listing remains Pending and Reviewing, has no public Gallery authorization, and exposes none of the proposed Version or metadata

#### Scenario: Suspicious update preserves the committed revision

- **WHEN** an update proposal for a Listed listing requires human review
- **THEN** the current committed Version, metadata, and cover remain unchanged while the proposal remains non-public, and they continue serving only while effective access remains eligible

#### Scenario: Reviewer approves a current proposal

- **WHEN** an authorized review approves a proposal whose listing is active, whose base revision still matches, and whose effective-access governance state permits promotion
- **THEN** the system atomically promotes the complete proposal, advances the listing revision once, and exposes no mixture of old and new fields

#### Scenario: Initial proposal is rejected

- **WHEN** a deterministic policy check or authorized review rejects an initial proposal with no committed public revision
- **THEN** the system keeps the proposal non-public, records the listing as Removed with closure reason `initial_policy_rejection`, and never exposes, restores, or later reuses its slug

#### Scenario: Update proposal is rejected

- **WHEN** a deterministic check or authorized review rejects an update proposal for a Listed listing
- **THEN** the system closes only that proposal and leaves the listing's current committed revision and public authorization unchanged

#### Scenario: Owner submits a second update while one is open

- **WHEN** an Owner submits another Update Gallery request while the listing already has an open proposal
- **THEN** the system rejects the competing proposal and returns the current committed and proposal state without overwriting either

#### Scenario: Proposal becomes stale before promotion

- **WHEN** a proposal reaches approval after its base listing revision no longer matches the current revision
- **THEN** the system rejects promotion as stale and leaves the current committed revision unchanged

#### Scenario: Listing closes while a proposal is open

- **WHEN** a listing is Withdrawn, Removed, deleted with its Artifact, or closed with its Creator account while an initial or update proposal is open
- **THEN** the system closes the proposal atomically with the listing transition and prevents every later worker or reviewer result from promoting it

#### Scenario: Governance block begins while an update is open

- **WHEN** a Public-sharing restriction or Artifact takedown begins, an Administrator Removal remains in force, or an Appeal becomes pending while a Listed listing has an open update proposal
- **THEN** the system keeps the proposal non-public, closes it as governance-blocked, preserves the committed revision, and prevents later safety or review results from promoting it

#### Scenario: Governance block begins before initial promotion

- **WHEN** a Public-sharing restriction or Artifact takedown begins or an Appeal becomes pending while a Pending listing has no committed public revision
- **THEN** the system closes the proposal, moves the listing to Removed with closure reason `initial_governance_block`, and permanently keeps its slug non-public
- **AND** only reversal or clearance that leaves no decision in force can permit a fresh Share to Gallery with a new listing and slug

### Requirement: Generate a non-blocking Version-specific Gallery cover

Each committed Gallery listing revision SHALL resolve a Gallery cover for its fixed Version. Share to Gallery and Update Gallery MUST NOT wait for cover generation before promoting an otherwise eligible proposal. The Web SHALL use a neutral placeholder until the committed Version's cover is available, and a pending or terminally failed cover MUST NOT change listing lifecycle, review state, or Gallery authorization. A cover generated for a non-public proposal MUST remain non-public and MUST NOT replace the current committed cover before promotion.

#### Scenario: Initial cover is pending

- **WHEN** a listing becomes Listed before its fixed Version's Gallery cover is available
- **THEN** the listing remains available with a neutral cover placeholder

#### Scenario: Cover generation succeeds later

- **WHEN** the fixed Version's Gallery cover becomes available after listing creation
- **THEN** subsequent Gallery metadata reads resolve the generated cover without changing listing identity or lifecycle

#### Scenario: Cover generation fails terminally

- **WHEN** cover generation reaches a terminal failure
- **THEN** the listing remains in its current lifecycle and review states and continues to use the neutral placeholder

#### Scenario: Pending update cover completes before review

- **WHEN** a cover becomes ready for a non-public update proposal while the current revision remains Listed
- **THEN** public Gallery reads continue to resolve the current committed cover until the proposal is promoted

#### Scenario: Update proposal is rejected after cover generation

- **WHEN** an update proposal is rejected after its proposed cover has been generated
- **THEN** the proposed cover remains non-public and the current committed cover remains unchanged

### Requirement: Assign one opaque stable Gallery listing URL

Each Gallery listing SHALL reserve one stable URL at `/gallery/{opaqueSlug}`. The opaque slug MUST NOT contain or expose the Artifact ID, Version ID, Artifact name, public title, or Creator identity. The system MUST NOT expose the URL as active before the first committed revision becomes Listed. Updating the fixed Version, Gallery metadata, cover, or review state MUST NOT change the listing URL.

#### Scenario: Listing is created

- **WHEN** the system durably creates a Gallery listing
- **THEN** it reserves one opaque Gallery listing URL that does not reveal source resource identifiers and does not expose it as active while the listing remains Pending

#### Scenario: Listing is updated

- **WHEN** an Owner successfully updates the listing's fixed Version or metadata
- **THEN** the same Gallery listing URL identifies the updated committed listing

### Requirement: Update a Listed committed revision atomically

Update Gallery SHALL operate only on a Listed listing with a committed revision. It SHALL let the Owner propose replacing the fixed Version with another owned ready Version and changing editable Gallery metadata only while no active Public-sharing restriction or Artifact takedown, Administrator Removal still in force, or pending Appeal blocks Owner public-sharing changes. The proposal MUST satisfy the versioned Gallery permission-grant precondition owned by `gallery-governance` before promotion. The previous committed Version and metadata MUST remain unchanged until the complete proposal is atomically promoted, and Viewer requests SHALL continue to receive them only while effective access remains eligible. Any rejected, governance-blocked, or failed proposal MUST leave that committed state intact.

A successful update SHALL preserve listing identity, URL, creation time, and aggregate counters. Update Gallery MUST require the caller's expected listing revision and MUST reject a stale revision without overwriting the newer state.

#### Scenario: Owner updates Version and metadata

- **WHEN** an Owner supplies a new owned ready Version, valid metadata, evidence satisfying the governance grant precondition, and the current listing revision and the resulting proposal passes review
- **THEN** the system atomically commits the complete new listing projection and advances the revision once

#### Scenario: Update fails before commit

- **WHEN** any Version, metadata, permission, or persistence check fails during Update Gallery
- **THEN** the previous committed Version and metadata remain unchanged and Gallery Viewer requests continue to receive them only while effective access remains eligible

#### Scenario: Owner attempts update during a governance block

- **WHEN** an Owner requests Update Gallery while a Public-sharing restriction or Artifact takedown applies, an Administrator Removal remains in force, or an Appeal is pending
- **THEN** the system rejects the proposal without changing the committed listing, its review state, or its governance evidence

#### Scenario: Owner attempts update before initial promotion

- **WHEN** an Owner requests Update Gallery for a Pending listing with no committed revision
- **THEN** the system rejects Update Gallery and returns the Pending proposal and state-valid withdrawal action without creating a second proposal

#### Scenario: Concurrent client uses a stale revision

- **WHEN** a client submits Update Gallery with a revision older than the current listing revision
- **THEN** the system rejects the update and returns the current state without overwriting it

#### Scenario: Non-owner attempts to update a listing

- **WHEN** a signed-in User other than the Artifact Owner attempts Update Gallery
- **THEN** the system denies the operation and preserves the listing's Version, metadata, governance grant-evidence reference, and revision

#### Scenario: Updated Version cover is not ready

- **WHEN** an update commits a new fixed Version whose Gallery cover is pending
- **THEN** the listing preserves its identity and URL and shows the neutral placeholder until that Version's cover is available

### Requirement: Maintain private listing-scoped engagement aggregates

The system SHALL maintain separate non-identifying view, Gallery download, and Save a copy aggregates scoped to one Gallery listing identity. The trusted API SHALL atomically increment a view aggregate once when it authorizes and issues a new player authorization; replaying that authorization and requesting its entry or assets MUST NOT increment another view, and the Untrusted-content runtime MUST NOT write an aggregate. It SHALL increment a download aggregate only after a Gallery download authorization is accepted and a copy aggregate only after the independently owned copy reaches its ready committed state. Denied player authorization, rejected download, and failed or cancelled copy work MUST NOT increment the corresponding aggregate.

Listing updates SHALL preserve the same listing-scoped aggregates. A new listing created after withdrawal or another eligible replacement SHALL start each aggregate at zero and MUST NOT inherit predecessor values. These aggregates MUST NOT be exposed publicly or used for public ordering, search ranking, or Featured selection. Any raw Viewer signal supporting aggregation, rate limiting, or abuse investigation MUST remain pseudonymous and follow the maximum 30-day retention rule owned by `gallery-governance`.

#### Scenario: Viewer receives a player authorization

- **WHEN** the trusted API successfully issues a new player authorization for a listing revision
- **THEN** it atomically records the listing-scoped view event once without creating a public Viewer identity

#### Scenario: Authorized player credential is reused

- **WHEN** the player requests its entry or additional committed assets, including by replaying the same authorization
- **THEN** the content-only runtime validates access without incrementing the listing's view aggregate

#### Scenario: Viewer receives accepted download authorization

- **WHEN** a Viewer is accepted for a Gallery download of the listing's committed Version
- **THEN** the system increments that listing's download aggregate once for the accepted authorization

#### Scenario: Save a copy becomes ready

- **WHEN** a Save a copy job commits a ready independently owned Artifact
- **THEN** the system increments the source listing's copy aggregate once

#### Scenario: Save a copy fails before commit

- **WHEN** a Save a copy job fails or is cancelled before a ready Artifact is committed
- **THEN** the source listing's copy aggregate remains unchanged

#### Scenario: Update proposal is promoted

- **WHEN** a listing update is atomically promoted to the next committed revision
- **THEN** the listing preserves its existing view, download, and copy aggregates

#### Scenario: Artifact is shared again after withdrawal

- **WHEN** an eligible Artifact receives a new listing after its predecessor was Withdrawn
- **THEN** the new listing starts with zero view, download, and copy aggregates

#### Scenario: Public discovery reads a listing

- **WHEN** a Viewer browses, searches, or opens a Gallery listing
- **THEN** no public response exposes the engagement aggregates and no public ordering uses them

### Requirement: Make listing mutations idempotent

Share to Gallery, Update Gallery, and Withdraw from Gallery SHALL accept an Idempotency key scoped to the authenticated actor and operation. The system SHALL store a normalized target-and-input fingerprint with the accepted key. Repeating the same effective mutation with an already accepted key and fingerprint MUST return the immutable accepted-operation identity and historical outcome plus a separately labeled current resource projection, without creating a second listing, advancing a revision twice, or repeating a terminal transition. Historical outcome MUST NOT be presented as current lifecycle, effective access, or URL state. This authenticated read-only recovery MUST remain available after Gallery disablement or a later governance block and MUST NOT admit a new proposal or transition. A new or unknown-key request MUST satisfy current permission, governance, and eligibility gates. Reusing an accepted key for a different target or normalized input MUST return an idempotency conflict and MUST NOT execute another mutation. The system MUST NOT report a new listing or revision until that resource is durably committed.

#### Scenario: Client repeats Share to Gallery

- **WHEN** a client repeats the same Share to Gallery request with the same Idempotency key after an indeterminate response
- **THEN** the system returns the accepted operation's historical outcome and the listing's separately labeled current lifecycle, proposal, review, and effective-access projection without creating another listing
- **AND** it returns an active Gallery URL only if the current revision is Listed, effectively accessible, and Gallery remains enabled and eligible

#### Scenario: Client repeats Update Gallery

- **WHEN** a client repeats the same successful Update Gallery request with the same Idempotency key
- **THEN** the system returns the operation's originally committed revision as historical outcome plus the listing's separately labeled current projection without applying the update again or presenting stale lifecycle, access, or URL state as current

#### Scenario: Client repeats Withdraw from Gallery

- **WHEN** a client repeats the same Withdraw from Gallery request with the same Idempotency key
- **THEN** the system returns the same Withdrawn result and retired URL state

#### Scenario: Client reuses a listing key for different input

- **WHEN** a client reuses an accepted Share to Gallery, Update Gallery, or Withdraw from Gallery Idempotency key for a different target or normalized input
- **THEN** the system returns an idempotency conflict and preserves the original operation without executing the new mutation

### Requirement: Withdraw a listing permanently

Withdraw from Gallery SHALL atomically set the listing lifecycle to Withdrawn with closure reason `creator_withdrawal`, close every open proposal, remove it from public discovery, end Gallery authorization, and permanently retire its URL without changing its Artifact, Versions, Publication, or Share link. A retired listing URL MUST return a generic `410 Gone` response that exposes no title, Creator, Version, cover, tags, or historical content. A Withdrawn listing MUST NOT be restored. If the Artifact is shared to Gallery again, the system SHALL retain a non-public audit relationship to the predecessor without exposing that relationship through Gallery.

#### Scenario: Creator withdraws a Listed listing

- **WHEN** the Creator confirms Withdraw from Gallery for an active listing
- **THEN** the listing becomes Withdrawn, disappears from discovery, and stops authorizing new Gallery content requests atomically

#### Scenario: Creator withdraws while an update is pending

- **WHEN** the Creator confirms Withdraw from Gallery for a Listed listing with an open update proposal
- **THEN** the system withdraws the committed listing, closes the proposal, and prevents a later approval from restoring or updating the listing

#### Scenario: Creator withdraws an initial pending listing

- **WHEN** the Creator confirms Withdraw from Gallery before an initial proposal is promoted
- **THEN** the system closes the proposal, retires the listing URL, and prevents the listing from ever becoming public

#### Scenario: Viewer opens a withdrawn URL

- **WHEN** a Viewer requests the retired URL of a Withdrawn listing
- **THEN** the system returns a generic `410 Gone` response without listing or Creator metadata

#### Scenario: Non-owner attempts to withdraw a listing

- **WHEN** a signed-in User other than the Artifact Owner attempts Withdraw from Gallery
- **THEN** the system denies the operation and leaves Gallery and link-sharing state unchanged

#### Scenario: Creator shares the Artifact again after withdrawal

- **WHEN** the Creator later completes Share to Gallery for the same Artifact
- **THEN** the system creates a new listing with a new opaque URL after satisfying the then-current governance grant precondition, retains only a non-public audit relationship to the predecessor, and does not inherit its listing identity, URL, or counters

### Requirement: Retire restorable Gallery state before deleting its Artifact

The management surface SHALL warn that deleting an Artifact with a Pending or Listed Gallery listing permanently closes the listing and its Gallery listing URL. If the Artifact has a previously public Removed listing with current reason `administrator_removal`, it SHALL also warn that deletion ends restoration and permanently retires that URL. After explicit confirmation, the system SHALL atomically close every open proposal and move each Pending, Listed, or previously public `administrator_removal` listing to Withdrawn with closure reason `artifact_deleted`, retire its URL, close any pending Appeal of that listing removal as moot, and end new Gallery access before deleting the Artifact's management resources. A never-public Removed listing SHALL remain Removed and generic `404`, append an Artifact-deletion event, and become permanently non-restorable because its source no longer exists. The system SHALL retain permitted governance evidence, committed source objects referenced by accepted copy jobs, and committed Version objects covered by active bounded Download leases until their last holds end. Those objects MUST remain unavailable through new public or management access, and deletion MUST NOT remove independently owned copies. An unrelated takedown or restriction case MUST remain open when its decision still governs provenance-matching copies.

#### Scenario: Owner confirms deletion with an active listing

- **WHEN** an Owner confirms Delete after receiving the Gallery closure warning
- **THEN** the listing becomes Withdrawn with closure reason `artifact_deleted`, and its URL and Gallery access retire atomically before the Artifact is removed from management

#### Scenario: Owner deletes an Artifact with a previously public removal

- **WHEN** an Owner confirms deletion for an Artifact whose listing was previously public and is Removed with `administrator_removal`
- **THEN** the listing becomes Withdrawn with `artifact_deleted`, returns generic `410`, and can no longer be restored

#### Scenario: Owner deletes an Artifact with a never-public rejection

- **WHEN** an Owner deletes an Artifact whose only listing is a never-public `initial_policy_rejection` or `initial_governance_block`
- **THEN** the listing remains Removed and generic `404`, records source deletion, and can never be restored or used for a fresh share

#### Scenario: Owner cancels the deletion warning

- **WHEN** an Owner declines the deletion confirmation for an Artifact with an active listing
- **THEN** the system preserves the Artifact, listing, URL, Publication, and stored content unchanged

#### Scenario: Source Artifact has independent copies

- **WHEN** an Owner deletes an Artifact whose Gallery listing previously produced independently owned copies
- **THEN** the system retires the source listing without deleting or mutating those copies

### Requirement: Preserve existing sharing state during Gallery rollout

Introducing Gallery SHALL leave every existing Artifact unlisted, SHALL create no implicit Gallery listing or Creator profile, and MUST NOT change any existing Publication, Share link, or Link sharing status. Only an explicit Share to Gallery operation MAY stage the first listing and Creator profile, and only successful promotion of the first committed revision SHALL make that profile public.

#### Scenario: Deployment enables Gallery

- **WHEN** a deployment with existing Artifacts and Publications first enables Gallery
- **THEN** all existing Artifacts remain unlisted and every existing Publication and Share link retains its previous state

#### Scenario: Existing Owner opens Artifact management

- **WHEN** an Owner manages an existing Artifact after Gallery rollout without invoking Share to Gallery
- **THEN** the system does not create a listing or Creator profile as a side effect

### Requirement: Close listings when the Creator account is deleted

Deleting a Creator account SHALL close every open listing proposal and move every Pending, Listed, or previously public `administrator_removal` listing owned by that account to Withdrawn with closure reason `account_deleted`, close any pending Appeal of that listing removal as moot, end new Gallery authorization, and retire its listing URLs. A never-public Removed listing SHALL remain Removed and generic `404`, record account deletion, and become permanently non-restorable. Active governance evidence, accepted-copy source references, and bounded active-download source-read leases MUST retain only their required objects until the last hold ends without restoring management or new public access. An unrelated takedown or restriction case MUST remain open when its decision still governs provenance-matching copies. The public responses MUST NOT retain the deleted account's display name, email, sign-in identifiers, or profile data.

#### Scenario: Creator account with active listings is deleted

- **WHEN** account deletion completes for a Creator with Pending or Listed Gallery listings
- **THEN** those listings become Withdrawn with closure reason `account_deleted`, stop authorizing public access, and permanently retire their URLs without exposing deleted account data

#### Scenario: Creator account with a previously public removal is deleted

- **WHEN** account deletion completes for a Creator whose listing is Removed with `administrator_removal`
- **THEN** that listing becomes Withdrawn with `account_deleted`, returns generic `410`, and becomes permanently non-restorable
