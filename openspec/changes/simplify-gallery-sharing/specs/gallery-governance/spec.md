# Gallery Governance Delta

## MODIFIED Requirements

### Requirement: Record a versioned Gallery permission grant

The system SHALL require the Owner to explicitly accept the current Gallery permission grant before it accepts a Share to Gallery or Update Gallery proposal. The fixed product grant MUST authorize viewing, Gallery download, and creation of independently owned copies together for one listing and fixed Version. Gallery management MUST NOT offer per-listing switches that disable one of those permissions or a Creator-selected license. The Web MAY treat the affirmative Share to Gallery confirmation action as explicit acceptance only when the confirmation discloses all three permission effects and binds the exact current grant revision. The system MUST record the grant-text version, acceptance time, accepting User, listing, and fixed Version as durable evidence. If no current grant is configured, the system MUST reject Share to Gallery and Update Gallery before mutation with a stable no-current-grant result while preserving read-only listing state and historical acceptance evidence.

Selecting a different Version MUST require a new explicit acceptance for that Version. A later grant-text revision MUST NOT rewrite existing evidence. The API SHALL durably snapshot the applicable grant policy and acceptance evidence when it accepts a listing-revision proposal; successful promotion SHALL atomically install that proposal-bound evidence as the listing's current accepted grant. If current policy requires renewed acceptance at the next Share to Gallery or Update Gallery proposal, the system MUST obtain that acceptance before accepting the proposal, including for a metadata-only update. Gallery view, Withdraw from Gallery, and accepted-operation recovery MUST remain exempt. Once accepted, the proposal keeps that grant snapshot through its terminal decision; a later policy change applies to the next Share or Update proposal and MUST NOT strand, rewrite, or retroactively block the accepted proposal.

#### Scenario: Owner confirms the current grant for a new listing

- **WHEN** an Owner confirms Share to Gallery after the Web states that anyone may view, Gallery download, and Save a copy of the fixed Version
- **THEN** the system records acceptance of the exact current grant against the proposal, resulting listing, and fixed Version before that listing can become Listed

#### Scenario: Owner does not confirm the current grant

- **WHEN** an Owner dismisses Share to Gallery without invoking the affirmative confirmation action
- **THEN** the system creates or changes no listing, proposal, Creator profile, grant evidence, or public resource

#### Scenario: No current grant is configured

- **WHEN** an Owner views Gallery state or requests Share to Gallery or Update Gallery while no current permission grant exists
- **THEN** read-only state includes any listing and historical accepted-grant evidence but reports that current terms are unavailable
- **AND** the system accepts no proposal, presents no terms for acceptance, and changes no listing, profile, or grant evidence

#### Scenario: Owner updates the fixed Version

- **WHEN** an Owner submits Update Gallery to select another ready Version
- **THEN** the system durably records a new proposal-bound acceptance for that Version and atomically installs its reference as current with successful promotion of the listing update

#### Scenario: Owner attempts to narrow the fixed grant

- **WHEN** an Owner attempts to disable View, Gallery download, or Save a copy for one listing or substitute a Creator-selected license
- **THEN** the system rejects the customization without changing the fixed product grant or committed listing revision

#### Scenario: Permission text changes after acceptance

- **WHEN** ShareSlices publishes a new Gallery permission-grant version after a listing was accepted
- **THEN** the system preserves the listing's original grant record without silently replacing it and, when current policy requires renewed acceptance, blocks the next Share to Gallery or Update Gallery proposal until the Owner accepts the required grant

#### Scenario: Permission text changes while a proposal is open

- **WHEN** ShareSlices activates a new permission-grant version after a proposal was accepted under the then-applicable grant policy
- **THEN** the open proposal keeps its immutable acceptance evidence through its terminal decision and the new policy applies to the next Share to Gallery or Update Gallery proposal

#### Scenario: Owner changes only metadata under unchanged terms

- **WHEN** an Owner proposes changing only Gallery metadata for the same fixed Version and no renewed acceptance is required
- **THEN** the proposal references and preserves the existing grant evidence

#### Scenario: Metadata-only update requires renewed terms

- **WHEN** an Owner proposes changing only Gallery metadata and current policy requires acceptance at the next Share to Gallery or Update Gallery proposal
- **THEN** the system requires acceptance of the exact current grant revision before accepting the proposal and preserves the earlier grant evidence as history
