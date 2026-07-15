# artifact-publication delta specification

## MODIFIED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts and expose only state-valid Preview, Full-screen Preview, Publish, Manage publication, Copy, Unpublish, Rename, Export, Delete, Retry, and Replace file actions. It MUST NOT expose Share as a separate lifecycle action. Publication history, analytics, and link replacement outside Publish SHALL NOT be exposed.

#### Scenario: Owner uses a ready never-published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and a ready Artifact is Not published
- **THEN** the grid card provides Preview, Full-screen Preview, Publish, Rename, Export, and Delete actions without a Share link or Copy action

#### Scenario: Owner uses a Published Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and an Artifact is Published
- **THEN** the grid card provides Preview, Full-screen Preview, Publish, Manage publication, Copy, Rename, Export, and Delete actions as permitted by its processing state

## ADDED Requirements

### Requirement: Control owner full-screen Preview

The Web SHALL present Full-screen Preview as a display state of the latest ready Version, not as a Version, Publication, or access transition. An eligible grid card SHALL show a persistent icon control beside its other thumbnail actions, while list rows and selection mode MUST NOT show that control. The existing card Preview navigation SHALL remain available independently.

Preview content SHALL be hosted inside a trusted player surface that provides visible `Enter full screen` and `Exit full screen` icon controls with accessible names and tooltips. The player SHALL request full screen only from a user activation, SHALL synchronize its control state from browser full-screen events, and SHALL permit Artifact content to make its own user-activated full-screen request.

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
