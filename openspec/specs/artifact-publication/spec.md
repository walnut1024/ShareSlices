# artifact-publication Specification

## Purpose

TBD - created by archiving change v0-0-1-first-share-flow. Update Purpose after archive.

## Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts and expose only state-valid Preview, Full-screen Preview, Publish, Manage publication, Copy, Unpublish, Rename, Export, Delete, Retry, and Replace file actions. It MUST NOT expose Share as a separate lifecycle action. Publication history, analytics, and link replacement outside Publish SHALL NOT be exposed.

#### Scenario: Owner uses a ready never-published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and a ready Artifact is Not published
- **THEN** the grid card provides Preview, Full-screen Preview, Publish, Rename, Export, and Delete actions without a Share link or Copy action

#### Scenario: Owner uses a Published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and an Artifact is Published
- **THEN** the grid card provides Preview, Full-screen Preview, Publish, Manage publication, Copy, Rename, Export, and Delete actions as permitted by its processing state

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

The owner SHALL be able to permanently delete an Artifact that is not accepted or processing. Deletion SHALL remove its database resources and make all associated stored objects unavailable. Another user MUST NOT be able to delete it.

#### Scenario: Owner confirms deletion

- **WHEN** the owner confirms Delete for a ready or failed Artifact
- **THEN** the Artifact disappears from management and its Viewer link no longer resolves

#### Scenario: Owner attempts deletion during processing

- **WHEN** the Artifact is accepted or processing
- **THEN** the system rejects deletion without changing the Artifact

### Requirement: Preserve identifying parts of grid card names

The Web Artifact grid card SHALL display a long Artifact name on one line while preserving both its beginning and approximately the final third, separated by one ellipsis. Hovering or focusing the displayed name SHALL expose the complete Artifact name. The card link's accessible name MUST remain the complete Artifact name. List view and Artifact detail naming behavior SHALL remain unchanged.

#### Scenario: Grid card has a long Artifact name

- **WHEN** an owned Artifact name does not fit in the grid card title width
- **THEN** the card shows the beginning and ending portions separated by one ellipsis and exposes the complete name through the title tooltip and card link accessible name

#### Scenario: Owner uses list or detail view

- **WHEN** the same Artifact appears in list view or on its detail page
- **THEN** those surfaces retain their existing name display behavior

### Requirement: Browse owned Artifacts in grid and list views

The Web Artifacts Page SHALL present the Owner's current filtered collection in grid and list views. Grid SHALL be the default when no local view preference exists, and the Web SHALL preserve the browser-local view preference across reloads. The grid SHALL add bounded-width columns as desktop space permits and SHALL retain the existing grid-only thumbnail behavior. The list SHALL show Artifact name, processing state, Publication status, last modified time, and state-valid actions without adding thumbnails.

The Web SHALL provide a case-insensitive Artifact-name search and the existing processing and Publication filters. Activating a list row SHALL open Artifact detail, while its checkbox and action controls MUST operate without row navigation.

#### Scenario: Owner switches Artifact views

- **WHEN** an Owner switches from grid to list and reloads the Web app in the same browser
- **THEN** the Artifacts Page restores list view over the same owned Artifact collection

#### Scenario: Owner searches by Artifact name

- **WHEN** an Owner enters a partial Artifact name with different letter casing
- **THEN** both grid and list show owned Artifacts whose names contain that value without case sensitivity

#### Scenario: Owner activates a list action

- **WHEN** an Owner activates a checkbox or state-valid action in an Artifact list row
- **THEN** that control performs its behavior without opening Artifact detail

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

The Web SHALL offer batch Publish for a non-empty Artifact selection. Before opening the Publish dialog, the Web MUST verify that every selected Artifact currently exposes Publish as a state-valid action and has a latest ready Version. If any selection is ineligible, the Web MUST send no Publish request and MUST use Sonner to state that Publish was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL collect one expiration choice, Publish each Artifact's latest ready Version with that choice, and reuse each Artifact's existing Share link. Batch Publish MUST NOT offer Share-link replacement and MUST NOT run more than three single-Artifact Publish calls concurrently.

#### Scenario: Selection includes an Artifact that cannot Publish

- **WHEN** an Owner clicks batch Publish and at least one selected Artifact lacks the Publish action or a latest ready Version
- **THEN** the Web sends no Publish requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Batch Publish succeeds

- **WHEN** every selected Artifact is eligible and every single-Artifact Publish call succeeds with the chosen expiration
- **THEN** the Web updates all affected Publication states, summarizes success, and exits selection mode

#### Scenario: Batch Publish partially succeeds

- **WHEN** eligibility preflight passes but one or more single-Artifact Publish calls fail
- **THEN** the Web keeps successful mutations, retains only failed Artifacts as selected, and uses Sonner to report success and failure counts plus the first concrete failure reason

### Requirement: Batch Delete eligible Artifacts permanently

The Web SHALL offer batch Delete for a non-empty Artifact selection. Before confirmation, the Web MUST verify that every selected Artifact currently exposes Delete as a state-valid action. If any selection is ineligible, the Web MUST send no Delete request and MUST use Sonner to state that Delete was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL require destructive confirmation that states the selected count and that deletion permanently removes the Artifacts and their Versions, Publications, Share links, and stored files. The Web MUST use the existing single-Artifact Delete contract, MUST NOT run more than three calls concurrently, and MUST NOT automatically retry a failed destructive request. A successful response SHALL mean the Artifact is removed from management; the Web MUST NOT claim that backend object cleanup completed synchronously.

#### Scenario: Selection includes an Artifact that cannot be deleted

- **WHEN** an Owner clicks batch Delete and at least one selected Artifact lacks the Delete action
- **THEN** the Web sends no Delete requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Owner confirms batch Delete

- **WHEN** every selected Artifact is eligible and the Owner confirms permanent deletion
- **THEN** the Web submits the existing Delete operation for each selected Artifact with at most three calls in progress

#### Scenario: Batch Delete partially succeeds

- **WHEN** one or more confirmed Delete calls succeed and one or more fail
- **THEN** successfully deleted Artifacts disappear, failed Artifacts remain selected, and Sonner reports success and failure counts plus the first concrete failure reason without automatic retry

### Requirement: Exclude batch Export

The first Web selection mode SHALL expose Publish and Delete batch actions only. It MUST NOT expose batch Export or initiate multiple single-Artifact downloads from one batch action.

#### Scenario: Owner enters selection mode

- **WHEN** an Owner selects one or more Artifacts
- **THEN** the batch toolbar offers Publish and Delete without an Export action

### Requirement: Project one Publication status

The management API and Web SHALL project exactly one Owner-facing Publication status for each Artifact: Not published when no Publication has ever existed, Published while the latest Publication is externally accessible, Expired after its scheduled end, or Unpublished after the Owner ends it early. Superseded Publications SHALL remain internal history and MUST NOT appear as another current state.

#### Scenario: Artifact has never been published

- **WHEN** an Owner views a ready Artifact that has no Publication history
- **THEN** management reports Not published and offers Publish without exposing a Share link

#### Scenario: Publication reaches its scheduled end

- **WHEN** the latest Publication's effective expiration passes without a later Publish
- **THEN** management reports Expired, preserves the Share link, and disables Copy until the Owner publishes again

#### Scenario: Owner ends access early

- **WHEN** the Owner Unpublishes before the scheduled end
- **THEN** management reports Unpublished, preserves the Share link, and disables Copy until the Owner publishes again

### Requirement: Manage an accessible Publication

The Owner SHALL be able to view and copy the Share link and change an accessible Publication between permanent and an exact future expiration without publishing again. The system MUST reject a current or past expiration and leave the Publication unchanged. Publication management MUST NOT replace the Share link or select another Version.

#### Scenario: Owner extends the current Publication

- **WHEN** the Owner changes the current Publication to a later future expiration
- **THEN** the same Publication and Share link remain accessible until the new effective end

#### Scenario: Owner makes the current Publication permanent

- **WHEN** the Owner clears the current Publication expiration
- **THEN** the same Publication and Share link remain accessible without a scheduled end

#### Scenario: Owner requests immediate expiration

- **WHEN** the Owner submits a current or past expiration
- **THEN** the system rejects it and directs immediate removal through Unpublish

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
