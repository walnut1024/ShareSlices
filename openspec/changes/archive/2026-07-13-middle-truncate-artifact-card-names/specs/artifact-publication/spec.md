# artifact-publication delta specification

## ADDED Requirements

### Requirement: Preserve identifying parts of grid card names

The Web Artifact grid card SHALL display a long Artifact name on one line while preserving both its beginning and approximately the final third, separated by one ellipsis. Hovering or focusing the displayed name SHALL expose the complete Artifact name. The card link's accessible name MUST remain the complete Artifact name. List view and Artifact detail naming behavior SHALL remain unchanged.

#### Scenario: Grid card has a long Artifact name

- **WHEN** an owned Artifact name does not fit in the grid card title width
- **THEN** the card shows the beginning and ending portions separated by one ellipsis and exposes the complete name through the title tooltip and card link accessible name

#### Scenario: Owner uses list or detail view

- **WHEN** the same Artifact appears in list view or on its detail page
- **THEN** those surfaces retain their existing name display behavior
