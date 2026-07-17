# Gallery listing specification

## ADDED Requirements

### Requirement: Complete the concise Web first-share interaction

For an eligible fresh Gallery listing, the Web SHALL present a dedicated Share to Gallery confirmation rather than Gallery management controls or editable Gallery fields. The confirmation SHALL identify the Artifact, state that anyone can view it in Gallery, disclose that people can also download it and save an independently owned copy, and state that Share with link does not change. The affirmative `Share to Gallery` action SHALL be the Owner's explicit acceptance of the current Gallery permission grant.

After the Server accepts that action, the Web SHALL show a dedicated completion state rather than immediately switching the same dialog to Manage Gallery. If the refreshed listing is Listed, the completion state SHALL say that the Artifact is now visible in Gallery. If it is Pending or cannot be refreshed, the completion state SHALL say that the Artifact was submitted and is being checked before it appears in Gallery. The Web MUST NOT present a Gallery URL as active before the listing is Listed.

The confirmation's `Cancel` action SHALL close it without mutation. A failed mutation SHALL preserve the confirmation and render actionable, stable product copy; unrecognized Server errors MUST NOT be shown verbatim.

#### Scenario: Owner confirms a fresh share

- **WHEN** an Owner opens Share to Gallery for an eligible ready Artifact
- **THEN** the Web shows `Share to Gallery?`, concise public-access disclosure, `Cancel`, and `Share to Gallery` without editable Version, profile, or metadata fields

#### Scenario: Owner cancels confirmation

- **WHEN** an Owner selects `Cancel` from the fresh-share confirmation
- **THEN** the Web closes the dialog without creating or changing a listing, proposal, Creator profile, or permission evidence

#### Scenario: Accepted share is still pending

- **WHEN** the Server accepts a fresh share and the refreshed listing is Pending
- **THEN** the Web shows that the Artifact was submitted and is being checked before it appears in Gallery instead of showing a public-availability claim or Manage Gallery controls

#### Scenario: Accepted share is already listed

- **WHEN** the Server accepts a fresh share and the refreshed listing is Listed
- **THEN** the Web shows that the Artifact is now visible in Gallery and does not expose the management state in the completion view

#### Scenario: Unrecognized share failure

- **WHEN** a fresh Gallery share fails with an unrecognized Server error
- **THEN** the Web keeps the confirmation available and shows a stable retry message without rendering the raw Server error text
