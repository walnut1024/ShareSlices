# artifact-publication delta specification

## MODIFIED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts on the Artifacts page with grid and list view modes and expose only state-valid Preview, Share, Rename, Export, Delete, Retry, and Replace file actions. In grid view, each Artifact card SHALL preserve whole-card navigation while keeping its state-valid quick actions and overflow actions independently operable. Analytics and manual Share link revocation SHALL NOT be exposed.

#### Scenario: Owner uses a ready Artifact card

- **WHEN** a signed-in owner opens the Artifacts page in grid view
- **THEN** a ready Artifact card provides whole-card navigation plus Preview, Share, Rename, Export, and Delete actions as permitted by its state

#### Scenario: Owner switches collection view

- **WHEN** a signed-in owner switches between grid and list view
- **THEN** the same owned Artifact collection and state-valid actions remain available without changing Artifact state
