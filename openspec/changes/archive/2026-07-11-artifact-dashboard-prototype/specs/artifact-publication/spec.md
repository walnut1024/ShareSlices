# artifact-publication Specification Delta

## MODIFIED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts in the prototype dashboard and expose only state-valid Preview, Share, Rename, Export, Delete, Retry, and Replace file actions. Analytics and manual Share link revocation SHALL NOT be exposed.

#### Scenario: Owner uses a ready Artifact card

- **WHEN** a signed-in owner opens the Artifact dashboard
- **THEN** a ready Artifact card provides Preview, Share, Rename, Export, and Delete actions as permitted by its state

### Requirement: Maintain one active Share link

The system SHALL preserve one stable Share link per Artifact and SHALL let the owner set or clear its expiration. A missing expiration means permanent. Viewer requests after the expiration MUST return the expired-link state. Manual revocation and link rotation are outside this change.

#### Scenario: Owner creates a dated link

- **WHEN** the owner publishes a ready Version with a future expiration
- **THEN** the stable Share link serves that Version until the expiration and then returns the expired-link state

#### Scenario: Owner makes the link permanent

- **WHEN** the owner clears expiration on the active Share link
- **THEN** the link remains active without a time limit and its slug does not change

## ADDED Requirements

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
