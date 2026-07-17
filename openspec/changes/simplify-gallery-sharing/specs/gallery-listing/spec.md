# Gallery Listing Delta

## MODIFIED Requirements

### Requirement: Share one owned ready Version

The system SHALL let a signed-in Owner create at most one active Gallery listing for an owned Artifact. Share to Gallery SHALL target exactly one Artifact per operation and SHALL use the Artifact's latest ready Version in the Web confirmation flow. The API and CLI SHALL continue to let an Owner explicitly select any historical ready Version owned by that Artifact. The first release MUST NOT provide batch Share to Gallery. The system MUST reject missing, accepted, processing, failed, or foreign Versions without creating or changing a listing. Before the system accepts an initial proposal or stages a Creator profile, the request MUST satisfy the versioned Gallery permission-grant precondition owned by `gallery-governance`.

Pending and Listed listings, including Listed listings under review or restriction, SHALL count as active for the one-listing constraint. Withdrawn and Removed listings SHALL be inactive. Every transition to Withdrawn or Removed MUST record a stable closure reason. A Creator MUST NOT restore a Withdrawn listing, restore a never-public Removed listing, or bypass an Administrator Removal or Public-sharing restriction that remains in force or a pending Appeal by creating a replacement listing. A corrected `initial_policy_rejection` and a fully cleared or reversed `initial_governance_block` MAY start a normally validated fresh listing with a new slug. After an `administrator_removal` decision is reversed but before its old listing is restored, replacement Share to Gallery MUST require explicit irreversible confirmation that creating the replacement permanently forfeits restoration of the old listing URL, identity, and counters.

#### Scenario: Owner confirms the Web default Version

- **WHEN** an Owner confirms Share to Gallery in the Web for an Artifact with multiple ready Versions
- **THEN** the operation selects the latest ready Version without asking the Owner to choose a Version

#### Scenario: Owner selects a historical ready Version through an explicit client

- **WHEN** an Owner uses the API or CLI to select an older ready Version owned by the target Artifact
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

Share to Gallery SHALL require a public title and SHALL default that title from the Owner-facing Artifact name. It SHALL accept an optional description and zero through five tags. The Web confirmation flow SHALL use the default title with an empty description and no tags without asking for metadata. Gallery metadata SHALL remain independent from the Owner-facing Artifact name and other private management metadata. The system MUST reject a missing public title or more than five tags without changing the listing.

#### Scenario: Owner confirms the initial metadata defaults

- **WHEN** an Owner confirms Share to Gallery in the Web for an Artifact named `Quarterly report`
- **THEN** the listing uses `Quarterly report` as its public title with an empty description and no tags without changing the Artifact name

#### Scenario: Owner supplies public metadata through an explicit client

- **WHEN** an Owner provides a public title, optional description, and zero through five tags
- **THEN** the system stores those values as Gallery metadata for the listing

#### Scenario: Owner submits invalid tag count

- **WHEN** an Owner submits Share to Gallery or Update Gallery with more than five tags
- **THEN** the system rejects the mutation and preserves the previously committed state

#### Scenario: Owner renames the source Artifact

- **WHEN** an Owner renames an Artifact after its Gallery listing has been created
- **THEN** the listing's public title remains unchanged until an explicit Update Gallery operation changes it
