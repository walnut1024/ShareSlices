# artifact-publication Delta Specification

## MODIFIED Requirements

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
