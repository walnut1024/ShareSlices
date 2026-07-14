# artifact-publication delta specification

## ADDED Requirements

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
