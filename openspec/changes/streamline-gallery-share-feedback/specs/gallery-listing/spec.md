# Gallery listing specification

## ADDED Requirements

### Requirement: Deliver non-blocking Web feedback for a fresh Gallery share

For an eligible fresh Gallery listing, the Web SHALL present a concise confirmation titled `Share “{Artifact name}” to Gallery?` with the single disclosure `Anyone can view, download, and save a copy of this Artifact in Gallery. Your Share link won’t change.` The confirmation SHALL provide only `Cancel` and `Share to Gallery` actions and SHALL NOT expose editable Version, Creator profile, or Gallery metadata fields. Invoking the affirmative action SHALL explicitly accept the current complete Gallery permission grant.

After the Server durably accepts the request, the Web SHALL close the confirmation and show a transient Sonner acknowledgement titled `Submitted to Gallery` with `We’ll let you know when it’s live.` The Web SHALL NOT present a separate submitting or completion screen and MUST NOT describe request acceptance as public Gallery availability.

The Web SHALL monitor only explicitly accepted fresh shares and SHALL derive later feedback from the current owner listing projection. It SHALL show a persistent success Alert only when the listing is Listed, effectively accessible, and has a current public URL. That Alert SHALL be titled `Now live in Gallery`, state that the named Artifact is visible to everyone in Gallery, and provide `View in Gallery` opening the trusted public listing in a new tab. A result under review or requiring correction SHALL instead show a persistent non-success Alert with `Manage Gallery` and MUST NOT expose a public View action.

#### Scenario: Owner opens the fresh-share confirmation

- **WHEN** an Owner selects Share to Gallery for an eligible ready Artifact
- **THEN** the Web shows the concise title, one complete permission disclosure, `Cancel`, and `Share to Gallery` without editable first-share fields or Gallery management state

#### Scenario: Owner cancels the confirmation

- **WHEN** the Owner selects `Cancel`
- **THEN** the Web closes the confirmation without creating or changing a listing, proposal, Creator profile, or permission evidence

#### Scenario: Server accepts the share request

- **WHEN** the Owner confirms and the Server returns an accepted Gallery operation
- **THEN** the Web closes the dialog, shows `Submitted to Gallery` with `We’ll let you know when it’s live.`, registers the Artifact for result monitoring, and does not show a separate completion screen

#### Scenario: Accepted share remains ordinarily pending

- **WHEN** the monitored listing remains Pending and Clear
- **THEN** the Web shows no public-completion Alert and continues only the bounded result-monitoring behavior

#### Scenario: Accepted share becomes public

- **WHEN** the monitored listing becomes Listed with effective access and a current public URL
- **THEN** the Web shows `Now live in Gallery`, identifies the Artifact as visible to everyone, and provides `View in Gallery` to that URL in a new tab

#### Scenario: Accepted share enters review

- **WHEN** the monitored initial listing is Pending and Reviewing
- **THEN** the Web shows `Gallery submission is under review.` with `Manage Gallery` and does not claim public availability

#### Scenario: Accepted share needs correction

- **WHEN** the monitored initial listing becomes Removed, Withdrawn, Restricted, or otherwise reaches a non-public terminal result
- **THEN** the Web shows `Gallery submission needs attention.` with `Manage Gallery` and no public View action

#### Scenario: Share request fails before acceptance

- **WHEN** the fresh-share request fails before the Server accepts it
- **THEN** the Web keeps the confirmation available, shows stable actionable inline feedback, registers no monitor, and emits no submitted Sonner message

#### Scenario: Unrecognized Server failure

- **WHEN** the request fails with an unrecognized Server error or raw internal error
- **THEN** the Web shows `We couldn’t submit this Artifact to Gallery. Try again.` without rendering the raw message or code
