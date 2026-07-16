# artifact-publication Specification

## Purpose

TBD - created by archiving change v0-0-1-first-share-flow. Update Purpose after archive.

## Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts and expose only state-valid Preview, Full-screen Preview, Share with link, Manage link, Copy link, Stop sharing link, Share to Gallery, Manage Gallery, Rename, Export, Delete, Retry, and Replace file actions. Share with link and Share to Gallery MUST remain separate controls and MUST NOT be collapsed into a generic Share action. For every ready Artifact with no Artifact takedown, Public-sharing restriction, or other effective public-sharing block, the Web SHALL preserve an explicit Share with link path when its link is active, Expired, or Link stopped so the Owner can select another ready Version or restore link access. An active-link card MAY present Manage link as its primary link action, but the card, Artifact detail, or Manage link surface MUST expose the distinct Share with link flow.

Pending and Listed Gallery listings SHALL expose Manage Gallery with only their state-valid actions. A Withdrawn predecessor SHALL not expose update or withdrawal and MAY expose Share to Gallery for a new listing when the Artifact is eligible. A Removed listing SHALL expose its governance result and Appeal path as applicable, but MUST NOT expose Gallery update, withdrawal, restoration, or replacement share while its governing decision remains in force or an Appeal remains pending. After a corrected `initial_policy_rejection` or fully cleared or reversed `initial_governance_block`, the Web SHALL expose Share to Gallery for a new listing when the Artifact is otherwise eligible. After `administrator_removal` is reversed but before the old listing is restored, the Web MAY expose replacement Share to Gallery only with a destructive warning and explicit confirmation that replacement permanently forfeits restoration of the old listing URL, identity, and counters. Publication history, Gallery governance history beyond the current actionable result, analytics, and link replacement outside Share with link SHALL NOT be exposed through ordinary Artifact actions.

#### Scenario: Owner uses a ready never-shared Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and a ready Artifact has no active link or Gallery listing and no effective public-sharing block
- **THEN** the grid card provides separate Share with link and Share to Gallery actions together with Preview, Full-screen Preview, Rename, Export, and Delete
- **AND** it exposes neither Copy link nor Gallery management

#### Scenario: Owner uses an Artifact with active link sharing

- **WHEN** a signed-in Owner opens an Artifact whose Publication is externally accessible
- **THEN** the Web presents Manage link, Copy link, and Stop sharing link plus only the independent state-valid Gallery action
- **AND** it preserves an explicit Share with link path for selecting another ready Version or other Publish choices

#### Scenario: Owner uses an Artifact whose link is no longer active

- **WHEN** a signed-in Owner opens a ready Artifact whose Link sharing status is Expired or Link stopped and no effective public-sharing block applies
- **THEN** the Web presents Share with link so the Owner can restore access using the existing Share link by default

#### Scenario: Owner uses a Gallery-listed Artifact

- **WHEN** a signed-in Owner opens an Artifact with a Pending or Listed Gallery listing
- **THEN** the Web presents Manage Gallery without replacing Share with link or Manage link

#### Scenario: Owner uses both public channels

- **WHEN** an Artifact has an active Share link and an active Gallery listing
- **THEN** its card and detail page expose separate Manage link and Manage Gallery controls rather than one generic Share menu

#### Scenario: Owner opens an Artifact after Gallery withdrawal

- **WHEN** an eligible ready Artifact has only a Withdrawn Gallery predecessor
- **THEN** the Web offers Share to Gallery for a new listing and exposes neither update nor withdrawal for the retired predecessor

#### Scenario: Owner opens an Artifact with an enforced Gallery removal

- **WHEN** an Artifact's latest Gallery listing is Removed under a decision that remains in force or a pending Appeal
- **THEN** the Web presents the governance result and available Appeal action without Gallery update, withdrawal, restoration, or replacement-share controls

#### Scenario: Owner opens an Artifact after eligible initial rejection

- **WHEN** an Artifact's latest listing closed with `initial_policy_rejection`, or with `initial_governance_block` whose every block and Appeal is cleared or reversed
- **THEN** the Web offers Share to Gallery for a new listing and does not offer update, withdrawal, or restoration of the old listing

#### Scenario: Owner chooses replacement after reversed removal

- **WHEN** an `administrator_removal` is reversed, the old listing remains Removed and restorable, and the Owner chooses replacement Share to Gallery
- **THEN** the Web warns that confirmation permanently forfeits the old URL, identity, counters, and restoration before submitting the new share

### Requirement: Use a mutable Artifact name

The system SHALL trim an Artifact name and require 1 through 120 characters. Names SHALL be mutable, SHALL NOT need to be unique for one Owner, and MUST NOT change Artifact ID or Share link identity.

#### Scenario: Owner changes Artifact name

- **WHEN** the owner updates an Artifact with a valid trimmed name
- **THEN** the system changes the owner-facing name without changing Artifact ID, Versions, Publication, or Share link

#### Scenario: Owner reuses an Artifact name

- **WHEN** the owner assigns a name already used by another owned Artifact
- **THEN** the system accepts the duplicate label because Artifact ID remains the identity

#### Scenario: Artifact name is invalid

- **WHEN** the trimmed Artifact name is empty or exceeds 120 characters
- **THEN** the system rejects the update and keeps the previous name

### Requirement: Maintain one active Share link

The system SHALL create the first Share link atomically with the Artifact's first Publish and SHALL preserve that link across later Publish, expiration, and Unpublish by default. The Owner MAY explicitly replace the link only during Publish by supplying irreversible confirmation. Replacement MUST atomically retire the previous link, create one new link, and MUST NOT retain the previous link as an alias.

An Artifact created before this behavior MAY have one reserved existing link before its next Publish. The system SHALL preserve and reuse that link without exposing the migration exception as a second active link.

#### Scenario: Owner publishes for the first time

- **WHEN** the Owner Publishes a ready Version for an Artifact with no Share link
- **THEN** the system creates one Share link with the Publication and returns it in the successful Publish result

#### Scenario: Owner republishes with the default link choice

- **WHEN** the Owner Publishes after expiration or Unpublish without requesting replacement
- **THEN** the new Publication reuses the previous Share link

#### Scenario: Owner replaces the link during Publish

- **WHEN** the Owner Publishes with replacement and explicit irreversible confirmation
- **THEN** the new Publication uses one new link and the previous link becomes permanently retired

#### Scenario: Owner requests replacement without confirmation

- **WHEN** the Owner requests a new link without the required irreversible confirmation
- **THEN** the system rejects Publish and leaves the existing Publication and link unchanged

### Requirement: Preview the ready Version

The system SHALL let the signed-in Owner Preview the Artifact's ready Version without changing Publication. Preview SHALL be served from authenticated API Origin routes. Each Preview page and asset request MUST validate the current management session, Artifact ownership, ready-Version state, and normalized manifest path.

Version 0.0.1 MUST NOT create a separate Preview session, grant, expiry policy, or shareable Preview link.

#### Scenario: Owner previews before first Publish

- **WHEN** the signed-in Owner opens Preview for a ready Version of a Not published Artifact
- **THEN** the system renders that Version without creating a Publication or Share link

#### Scenario: User previews another Owner's Version

- **WHEN** a signed-in user requests Preview for an Artifact they do not own
- **THEN** the system denies the Preview request

#### Scenario: Owner previews a Version that is not ready

- **WHEN** the Owner requests Preview before a ready Version exists
- **THEN** the system rejects the request without exposing staged or raw objects

### Requirement: Publish atomically

The Owner SHALL be able to Publish only a ready Version owned by the target Artifact. Publish SHALL atomically create a new Publication, create or select the effective Share link, and supersede any accessible Publication so Viewer requests never resolve to partial state or an invalid Version.

Publish SHALL accept permanent, positive relative-duration, or exact future-time expiration policy. It SHALL default to permanent on first Publish and otherwise inherit the previous Version, expiration policy, and link unless the Owner explicitly selects replacements. A relative duration restarts at the new Publish time; an exact time MUST be selected again after it has passed.

Publish requests MUST be idempotent for the same Owner, Artifact, effective Version, expiration policy, link choice, and idempotency key.

#### Scenario: Owner publishes a ready Version permanently

- **WHEN** the Owner first Publishes an owned ready Version without an expiration selection
- **THEN** the system atomically creates a permanent Publication and Share link and returns both

#### Scenario: Owner publishes with a relative duration

- **WHEN** the Owner Publishes with a positive relative duration
- **THEN** the Publication expires that duration after its successful Publish time

#### Scenario: Owner publishes another Version while accessible

- **WHEN** the Owner Publishes another owned ready Version while one Publication is accessible
- **THEN** Viewer requests keep receiving the previous Version until one transaction supersedes it and commits the new Publication and effective link

#### Scenario: Owner repeats Publish

- **WHEN** the Owner repeats the same effective Publish operation with the same idempotency key
- **THEN** the system returns the original Publication and link without creating another effective transition

#### Scenario: Owner publishes a non-ready Version

- **WHEN** the Owner attempts to Publish a Version that is missing, failed, staged, or belongs to another Artifact
- **THEN** the system rejects the operation and leaves Publication and link state unchanged

### Requirement: Unpublish and republish

The Owner SHALL be able to Unpublish an accessible Artifact by ending its current Publication early without changing the Share link or immutable Version. Repeating the same operation MUST return the same effective Unpublished state. Publishing after Expired or Unpublished SHALL default to the previous Version, expiration policy, and Share link.

#### Scenario: Owner unpublishes

- **WHEN** the Owner Unpublishes a Published Artifact
- **THEN** the system records its early end, reports Unpublished, and makes the unchanged Share link return the Unpublished status page

#### Scenario: Owner republishes after Unpublish

- **WHEN** the Owner Publishes an Unpublished Artifact without overriding defaults
- **THEN** the system creates a new Publication for the previous Version and expiration policy and reuses the same Share link

#### Scenario: Owner republishes an expired relative duration

- **WHEN** the Owner Publishes an Expired Artifact whose previous policy was a relative duration
- **THEN** the system starts that duration again from the new successful Publish time

#### Scenario: Owner republishes an expired exact time

- **WHEN** the Owner attempts to reuse an exact expiration that has already passed
- **THEN** the system requires a new expiration selection and leaves the Artifact Expired

#### Scenario: Non-owner changes Publication

- **WHEN** a user who does not own the Artifact attempts to Publish, manage, or Unpublish it
- **THEN** the system denies the operation and leaves Publication and link state unchanged

### Requirement: Export a ready Artifact

The owner SHALL be able to download a ZIP containing every committed asset of the ready Version with normalized relative paths. Export MUST require a signed-in owner and MUST NOT expose object-storage locations.

#### Scenario: Owner exports ready content

- **WHEN** the owner selects Export for a ready Artifact
- **THEN** the API streams a ZIP named from the Artifact without changing its Version or Publication

### Requirement: Delete an Artifact permanently

The Owner SHALL be able to permanently delete an Artifact that is not accepted or processing. When a Pending or Listed Gallery listing exists, confirmation MUST state that deletion permanently closes the listing and Gallery URL; for a previously public `administrator_removal`, it MUST state that deletion permanently ends restoration and retires the URL. Confirmed deletion SHALL atomically close every open proposal, move the Pending, Listed, or previously public `administrator_removal` listing to Withdrawn with closure reason `artifact_deleted`, and retire its URL before removing the Artifact's management resources and ending new public serving. A never-public Removed listing remains Removed and `404` but records source deletion and becomes non-restorable. The system MAY retain a minimum non-public governance tombstone. It MUST retain case-bound evidence and objects while an accepted governance hold remains active, committed source objects while an accepted-copy reference remains active, and committed Version objects while a bounded active-download source-read lease remains active. Every retained object MUST remain unavailable through new public and Owner management routes except to its already authorized Download stream and MUST be deleted after its last hold. Another User MUST NOT be able to delete the Artifact, and independently owned copies MUST remain available.

#### Scenario: Owner confirms deletion without a Gallery listing

- **WHEN** the Owner confirms Delete for a ready or failed Artifact that has no active Gallery listing
- **THEN** the Artifact disappears from management and its Viewer link no longer resolves

#### Scenario: Owner confirms deletion with a Gallery listing

- **WHEN** the Owner confirms Delete after being warned that an active Gallery listing and URL will close
- **THEN** the system atomically moves that listing to Withdrawn with closure reason `artifact_deleted`, retires its URL, and deletes the owned Artifact management graph
- **AND** it does not delete independently owned saved copies

#### Scenario: Owner attempts deletion during processing

- **WHEN** the Artifact is accepted or processing
- **THEN** the system rejects deletion without changing the Artifact or its public-channel state

### Requirement: Preserve identifying parts of grid card names

The Web Artifact grid card SHALL display a long Artifact name on one line while preserving both its beginning and approximately the final third, separated by one ellipsis. Hovering or focusing the displayed name SHALL expose the complete Artifact name. The card link's accessible name MUST remain the complete Artifact name. List view and Artifact detail naming behavior SHALL remain unchanged.

#### Scenario: Grid card has a long Artifact name

- **WHEN** an owned Artifact name does not fit in the grid card title width
- **THEN** the card shows the beginning and ending portions separated by one ellipsis and exposes the complete name through the title tooltip and card link accessible name

#### Scenario: Owner uses list or detail view

- **WHEN** the same Artifact appears in list view or on its detail page
- **THEN** those surfaces retain their existing name display behavior

### Requirement: Browse owned Artifacts in grid and list views

The Web Artifacts Page SHALL present the Owner's current filtered collection in grid and list views. Grid SHALL be the default when no local view preference exists, and the Web SHALL preserve the browser-local view preference across reloads. The complete Artifacts Page content SHALL remain centered within a maximum width of `1920` CSS pixels. Within that surface, the grid SHALL use a `20` CSS-pixel gap and automatically fill columns with a minimum width of `310` CSS pixels, producing three to five columns over the supported desktop acceptance range. Sparse collections MUST preserve the same bounded track sizing instead of stretching their cards across unused columns. The grid SHALL retain grid-only thumbnail behavior and each card SHALL pair one 16:9 preview with an independent `60-64` CSS-pixel metadata footer.

The list SHALL show Artifact name, processing state, Publication status, last modified time, and state-valid actions without adding thumbnails. The Web SHALL provide a case-insensitive Artifact-name search and the existing processing and Publication filters. Activating a list row SHALL open Artifact detail, while its checkbox and action controls MUST operate without row navigation.

#### Scenario: Owner switches Artifact views

- **WHEN** an Owner switches from grid to list and reloads the Web app in the same browser
- **THEN** the Artifacts Page restores list view over the same owned Artifact collection

#### Scenario: Owner searches by Artifact name

- **WHEN** an Owner enters a partial Artifact name with different letter casing
- **THEN** both grid and list show owned Artifacts whose names contain that value without case sensitivity

#### Scenario: Owner activates a list action

- **WHEN** an Owner activates a checkbox or state-valid action in an Artifact list row
- **THEN** that control performs its behavior without opening Artifact detail

#### Scenario: Minimum supported desktop shows three cards per row

- **WHEN** the Artifacts Page renders in Grid view at a `1280x720` CSS-pixel viewport
- **THEN** the grid shows three columns without horizontal page overflow and keeps every existing card action operable

#### Scenario: Default desktop shows four cards per row

- **WHEN** the Artifacts Page renders in Grid view at a `1440x900` CSS-pixel viewport
- **THEN** the grid shows four columns with the preview and metadata footer geometry unchanged across the row

#### Scenario: Large desktop remains bounded

- **WHEN** the Artifacts Page renders in Grid view at or above a `1920` CSS-pixel viewport width, including a 2K or 4K physical display under any operating-system scale that yields that CSS width
- **THEN** the content surface does not exceed `1920` CSS pixels and the grid shows no more than five columns

#### Scenario: Sparse collection uses normal card scale

- **WHEN** fewer Artifacts exist than the number of tracks that fit in the current grid row
- **THEN** each rendered card retains the same track width it would have in a full row and unused tracks remain empty

### Requirement: Present distinct Artifact empty states

The Web Artifacts Page SHALL distinguish an Owner with no Artifacts from a search or filter with no matching results. The first-use state SHALL offer New artifact and accept a file drop through the existing Artifact creation flow. The no-results state SHALL explain that no Artifacts match and SHALL offer to clear current search and filter conditions. Loading and request failure MUST NOT render as either empty state.

Displayed upload formats and limits MUST follow current product behavior and deployment configuration rather than fixed values copied from design examples.

#### Scenario: Owner has no Artifacts

- **WHEN** the owned Artifact request succeeds with an empty collection and no search or filter is active
- **THEN** the Web shows the first-use empty state with New artifact and the creation drop target

#### Scenario: Current conditions have no matches

- **WHEN** owned Artifacts exist but the active search or filters produce no matches
- **THEN** the Web shows `No artifacts found` and lets the Owner clear the active conditions without presenting the first-use drop target

#### Scenario: Artifact request fails

- **WHEN** the owned Artifact request fails
- **THEN** the Web shows its request failure state rather than claiming the Owner has no Artifacts

### Requirement: Select Artifacts consistently across views

The Web SHALL provide one selection mode for grid and list views. Selected Artifact identities SHALL persist when the Owner switches views or changes search and filter conditions, including when selected Artifacts become hidden. The selected count SHALL include hidden selections. Select all and Deselect all SHALL affect only the current filtered result set. Closing selection mode or pressing Escape SHALL clear all selection.

Grid cards SHALL expose a selection checkbox and visible selected treatment. List rows SHALL expose a selection column and visible selected treatment. Checkbox activation MUST NOT open Artifact detail or invoke a card action.

#### Scenario: Owner switches view with a selection

- **WHEN** an Owner selects Artifacts in grid view and switches to list view
- **THEN** the same Artifacts remain selected and the selected count is unchanged

#### Scenario: Filter hides a selected Artifact

- **WHEN** an Owner changes search or filters so a selected Artifact is no longer visible
- **THEN** the Artifact remains selected and included in the selected count

#### Scenario: Owner selects all filtered results

- **WHEN** an Owner activates Select all while search or filters are active
- **THEN** the Web selects every current filtered result and does not select owned Artifacts outside those results

#### Scenario: Owner exits selection mode

- **WHEN** an Owner closes selection mode or presses Escape
- **THEN** the Web clears the selection and restores the ordinary Artifact toolbar

### Requirement: Batch Publish eligible Artifacts

The Web SHALL present the existing batch link-Publish operation as batch Share with link for a non-empty Artifact selection. Before opening the dialog, the Web MUST verify that every selected Artifact currently exposes Share with link as a state-valid action, has a latest ready Version, and has no Artifact takedown, Public-sharing restriction, or other effective public-sharing block. A ready Artifact MAY remain eligible when its underlying Link sharing status is Not shared, Link active, Expired, or Link stopped. If any selection is ineligible, the Web MUST send no Publish request and MUST use Sonner to state that Share with link was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL collect one expiration choice, Publish each Artifact's latest ready Version with that choice, and reuse each Artifact's existing Share link. Batch Share with link MUST NOT offer Share-link replacement or Share to Gallery and MUST NOT run more than three single-Artifact Publish calls concurrently.

#### Scenario: Selection includes an Artifact that cannot share with a link

- **WHEN** an Owner clicks batch Share with link and at least one selected Artifact lacks that action or a latest ready Version
- **THEN** the Web sends no Publish requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Batch Share with link succeeds

- **WHEN** every selected Artifact is eligible and every single-Artifact Publish call succeeds with the chosen expiration
- **THEN** the Web updates all affected Link sharing statuses, summarizes success, and exits selection mode

#### Scenario: Batch Share with link partially succeeds

- **WHEN** eligibility preflight passes but one or more single-Artifact Publish calls fail
- **THEN** the Web keeps successful mutations, retains only failed Artifacts as selected, and reports success and failure counts plus the first concrete failure reason

### Requirement: Batch Delete eligible Artifacts permanently

The Web SHALL offer batch Delete for a non-empty Artifact selection. Before confirmation, the Web MUST verify that every selected Artifact currently exposes Delete as a state-valid action. If any selection is ineligible, the Web MUST send no Delete request and MUST use Sonner to state that Delete was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL require destructive confirmation that states the selected count and that deletion immediately removes the Artifacts, Versions, Publications, Share links, applicable Gallery listings and URLs, and stored files from management and new public serving. It SHALL state that physical cleanup can wait for an accepted governance review or copy, or an already authorized Download, to finish. The Web MUST use the existing single-Artifact Delete contract, MUST NOT run more than three calls concurrently, and MUST NOT automatically retry a failed destructive request. A successful response SHALL mean the Artifact is removed from management; the Web MUST NOT claim that backend object cleanup completed synchronously or that independently owned copies were deleted.

#### Scenario: Selection includes an Artifact that cannot be deleted

- **WHEN** an Owner clicks batch Delete and at least one selected Artifact lacks the Delete action
- **THEN** the Web sends no Delete requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Owner confirms batch Delete

- **WHEN** every selected Artifact is eligible and the Owner confirms permanent deletion
- **THEN** the Web submits the existing Delete operation for each selected Artifact with at most three calls in progress
- **AND** each successful operation closes every applicable Pending, Listed, or previously public `administrator_removal` listing according to the single-Artifact Delete contract before management removal

#### Scenario: Batch Delete partially succeeds

- **WHEN** one or more confirmed Delete calls succeed and one or more fail
- **THEN** successfully deleted Artifacts disappear, failed Artifacts remain selected, and Sonner reports success and failure counts plus the first concrete failure reason without automatic retry

### Requirement: Exclude batch Export

The first Web selection mode with Gallery SHALL expose Share with link and Delete batch actions only. It MUST NOT expose batch Export, Share to Gallery, or initiate multiple single-Artifact downloads from one batch action.

#### Scenario: Owner enters selection mode

- **WHEN** an Owner selects one or more Artifacts
- **THEN** the batch toolbar offers Share with link and Delete without Export or Share to Gallery

### Requirement: Project one Publication status

The management API SHALL continue to project exactly one underlying Publication status for each Artifact: Not published when no Publication has ever existed, Published while the latest Publication's schedule remains active, Expired after its scheduled end, or Unpublished after the Owner ends it early. The Web SHALL project those same facts as Not shared, Link active, Expired, or Link stopped respectively. An Artifact takedown or Public-sharing restriction SHALL be projected independently from that lifecycle and MUST NOT rewrite any of those four statuses. While a restriction blocks effective public access, the Web SHALL show the underlying Link sharing status together with a Restricted notice. Superseded Publications SHALL remain internal history and MUST NOT appear as another current state; Gallery listing and review status MUST remain separate fields.

#### Scenario: Artifact has never been shared with a link

- **WHEN** an Owner views a ready Artifact that has no Publication history
- **THEN** the API reports Not published while the Web shows Not shared and offers Share with link without exposing a Share link

#### Scenario: Publication reaches its scheduled end

- **WHEN** the latest Publication's effective expiration passes without a later Publish
- **THEN** both projections report Expired, preserve the Share link, and disable Copy link until the Owner shares with the link again

#### Scenario: Owner stops link access early

- **WHEN** the Owner uses Stop sharing link before the scheduled end
- **THEN** the API reports Unpublished, the Web shows Link stopped, and the unchanged Gallery listing status remains independently projected

#### Scenario: Governance blocks an active Publication

- **WHEN** an Artifact takedown or Public-sharing restriction applies while the underlying Publication schedule remains active
- **THEN** the API continues to report Published and the Web shows Link active together with a Restricted notice
- **AND** public Share-link serving is blocked without rewriting the Publication lifecycle

#### Scenario: Last public-access block clears before the Publication expires

- **WHEN** the last applicable Artifact takedown or Public-sharing restriction clears while the underlying Publication schedule remains active and no other effective-access block remains
- **THEN** the unchanged Link active Publication resumes serving through the same Share link

#### Scenario: Last public-access block clears after the Publication expires

- **WHEN** the last applicable Artifact takedown or Public-sharing restriction clears after the underlying Publication schedule has ended
- **THEN** the API reports Expired, the Web shows Expired, and Share-link serving does not resume automatically

#### Scenario: Restriction clears while takedown remains

- **WHEN** the last Public-sharing restriction clears but an Artifact takedown or another effective-access block remains
- **THEN** the underlying Publication status stays unchanged and public serving remains blocked

### Requirement: Manage an accessible Publication

The Owner SHALL use Manage link to view and copy the Share link and change an accessible Publication between permanent and an exact future expiration without publishing again. The system MUST reject a current or past expiration and leave the Publication unchanged. Manage link MUST NOT itself replace the Share link, select another Version, reactivate an Expired or Link stopped Publication, or change a Gallery listing; it MAY route the Owner to the distinct Share with link flow for those Publish choices. Stop sharing link SHALL invoke the existing Unpublish transition.

While an Artifact takedown or Public-sharing restriction blocks effective public access, Manage link SHALL continue to show the underlying Publication and Share-link settings together with a Restricted notice. The Web MUST disable Copy link, Share with link, Publication extension, and Version-changing Publish while blocked, but it SHALL continue to permit read-only management and Stop sharing link.

#### Scenario: Owner extends the current link availability

- **WHEN** the Owner changes the current Publication to a later future expiration through Manage link
- **THEN** the same Publication and Share link remain accessible until the new effective end

#### Scenario: Owner makes link availability permanent

- **WHEN** the Owner clears the current Publication expiration through Manage link
- **THEN** the same Publication and Share link remain accessible without a scheduled end

#### Scenario: Owner requests immediate expiration

- **WHEN** the Owner submits a current or past expiration
- **THEN** the system rejects it and directs immediate removal through Stop sharing link

#### Scenario: Owner selects another Version from link management

- **WHEN** the Owner chooses to Share with link another ready Version from the Manage link or Artifact detail surface
- **THEN** the Web opens the distinct Share with link flow rather than treating the selection as a Manage link edit

#### Scenario: Owner manages a restricted active Publication

- **WHEN** the Owner opens Manage link while a Public-sharing restriction blocks an otherwise Link active Publication
- **THEN** the Web shows the underlying status and settings with a Restricted notice and permits Stop sharing link
- **AND** it disables Copy link, Share with link, Publication extension, and Version change until the restriction clears

### Requirement: Control owner full-screen Preview

The Web SHALL present Full-screen Preview as a display state of the latest ready Version, not as a Version, Publication, or access transition. An eligible grid card SHALL show a persistent icon control beside its other thumbnail actions, while list rows and selection mode MUST NOT show that control. The existing card Preview navigation SHALL remain available independently.

Preview content SHALL be hosted inside a trusted player surface that provides visible `Enter full screen` and `Exit full screen` icon controls with accessible names and tooltips. The player SHALL request full screen only from a user activation, SHALL synchronize its control state from browser full-screen events, and SHALL permit Artifact content to make its own user-activated full-screen request.

When Artifact content itself owns a nested full-screen session, the browser places that iframe above trusted sibling controls. In that nested case the user exits through Escape or browser-provided full-screen UI; after exit, the trusted player's synchronized control becomes visible again.

#### Scenario: Owner enters directly from a grid card

- **WHEN** the Owner activates Full-screen Preview on an eligible grid card
- **THEN** the player requests full screen directly for that card's latest ready Version without first navigating away from the management page

#### Scenario: Owner exits a card Full-screen Preview

- **WHEN** the Owner uses the exit icon or Escape, or the browser otherwise ends the grid card's full-screen session
- **THEN** the player closes and the unchanged management page retains its search, filter, selection, view, and scroll state

#### Scenario: Owner controls a Preview content page

- **WHEN** the Owner opens ordinary Preview and activates its full-screen control
- **THEN** the trusted player displays that ready Version full screen and changes the visible control to `Exit full screen`

#### Scenario: Owner exits a Preview content page

- **WHEN** the Owner exits full screen from an ordinary Preview page
- **THEN** the same Preview page and Version remain open in normal display mode

#### Scenario: Browser rejects Card full screen

- **WHEN** the browser does not support or rejects the grid card's full-screen request
- **THEN** the temporary player closes, the management page remains unchanged, and the Web reports that full screen could not be opened without automatically retrying

#### Scenario: Browser rejects content-page full screen

- **WHEN** the browser rejects the ordinary Preview page's full-screen request
- **THEN** the Preview remains usable in normal display mode and reports that full screen could not be opened without navigating or automatically retrying

#### Scenario: Artifact is not eligible for Preview

- **WHEN** an Artifact has no latest ready Version or does not expose Preview as a state-valid action
- **THEN** its grid card does not expose Full-screen Preview

### Requirement: Keep link and Gallery sharing independent

Publish, Publication editing, Share-link replacement, and Unpublish SHALL NOT create, update, withdraw, remove, or otherwise change a Gallery listing. Gallery share, update, withdraw, restriction, and removal SHALL NOT create, edit, replace, expire, or stop a Share link or Publication. An Artifact takedown or Public-sharing restriction SHALL affect the independent effective public-access and restriction projection without rewriting the Publication lifecycle, Link sharing status, Gallery listing lifecycle, or their history.

#### Scenario: Owner stops link sharing while listed in Gallery

- **WHEN** an Owner stops an Artifact's link sharing while its Gallery listing remains active and unrestricted
- **THEN** the Share link stops serving content and the Gallery listing continues serving its fixed Version

#### Scenario: Creator withdraws Gallery while link sharing remains active

- **WHEN** a Creator withdraws an active Gallery listing while its Publication remains accessible
- **THEN** the Gallery URL retires and the Share link continues serving its selected Publication Version

#### Scenario: Platform performs Artifact takedown

- **WHEN** an authorized platform decision applies Artifact takedown
- **THEN** both Gallery and Share-link public serving stop while their independent lifecycle records and statuses remain unchanged and distinguishable
