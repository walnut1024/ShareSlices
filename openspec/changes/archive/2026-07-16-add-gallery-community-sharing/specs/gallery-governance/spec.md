# Gallery governance delta specification

## ADDED Requirements

### Requirement: Record a versioned Gallery permission grant

The system SHALL require the Owner to explicitly accept the current Gallery permission grant before it accepts a Share to Gallery or Update Gallery proposal. The fixed product grant MUST authorize viewing, Gallery download, and creation of independently owned copies together for one listing and fixed Version. Gallery management MUST NOT offer per-listing switches that disable one of those permissions or a Creator-selected license. The system MUST record the grant-text version, acceptance time, accepting User, listing, and fixed Version as durable evidence. If no current grant is configured, the system MUST reject Share to Gallery and Update Gallery before mutation with a stable no-current-grant result while preserving read-only listing state and historical acceptance evidence.

Selecting a different Version MUST require a new explicit acceptance for that Version. A later grant-text revision MUST NOT rewrite existing evidence. The API SHALL durably snapshot the applicable grant policy and acceptance evidence when it accepts a listing-revision proposal; successful promotion SHALL atomically install that proposal-bound evidence as the listing's current accepted grant. If current policy requires renewed acceptance at the next Share to Gallery or Update Gallery proposal, the system MUST obtain that acceptance before accepting the proposal, including for a metadata-only update. Gallery view, Withdraw from Gallery, and accepted-operation recovery MUST remain exempt. Once accepted, the proposal keeps that grant snapshot through its terminal decision; a later policy change applies to the next Share or Update proposal and MUST NOT strand, rewrite, or retroactively block the accepted proposal.

#### Scenario: Owner accepts the current grant for a new listing

- **WHEN** an Owner submits Share to Gallery for a ready Version and accepts the current Gallery permission grant
- **THEN** the system records the acceptance against the proposal, resulting listing, and fixed Version before that listing can become Listed and applies View, Gallery download, and Save a copy permission together

#### Scenario: Owner does not accept the current grant

- **WHEN** an Owner submits Share to Gallery without accepting the current Gallery permission grant
- **THEN** the system rejects the request and creates or changes no listing, proposal, Creator profile, grant evidence, or public resource

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

### Requirement: Check proposed Gallery content before publication

The system SHALL run deterministic Gallery safety checks in addition to ordinary Artifact validation before a new or updated listing-revision proposal becomes publicly available. Each check MUST execute a checked, versioned `GallerySafetyPolicy` against an immutable candidate snapshot. That policy MUST define its input limits, stable finding and reason codes, deterministic mapping to pass, reject, or review, evidence-digest format, and replay rules. The result MUST identify the policy version, candidate identity, evidence digest, findings, and mapped outcome. A policy revision MUST NOT silently reinterpret or rewrite an earlier result; a new evaluation records new evidence. A terminal proposal approval, rejection, or closure MUST close the proposal-specific review basis and recompute Clear, Reviewing, or Restricted from every remaining report, decision, takedown, and restriction basis.

The check MUST distinguish content that passes, content with a clear policy violation, and suspicious content that requires review; it MUST NOT claim that passing the check proves arbitrary HTML or JavaScript is harmless. Checks and human decisions MUST apply to the non-public proposal rather than mutating the committed public revision in place. A passing proposal result MUST NOT clear an independent Reviewing or Restricted state, Public-sharing restriction, Artifact takedown, Removal still in force, or pending Appeal.

#### Scenario: Proposed content passes the safety check

- **WHEN** a proposed Gallery Version passes ordinary Artifact validation and the deterministic Gallery safety check
- **THEN** the system permits the proposal to proceed without prior human approval and, after every other activation precondition passes, atomically promotes it
- **AND** the safety result alone does not clear any independent review or governance state

#### Scenario: Proposed content has a clear policy violation

- **WHEN** the Gallery safety check identifies a clear policy violation in a proposed Version
- **THEN** the system rejects the proposal with a policy result, does not expose it through Gallery, and leaves any prior committed revision unchanged
- **AND** when no committed revision exists, it closes the Pending listing as Removed with closure reason `initial_policy_rejection`, keeps its slug permanently non-public, and creates a durable result for the Creator

#### Scenario: Suspicious initial proposal requires review

- **WHEN** the Gallery safety check classifies an initial listing proposal as suspicious rather than clearly acceptable or clearly disallowed
- **THEN** the system keeps the listing Pending and Reviewing with no committed public revision until an Administrator records a decision

#### Scenario: Suspicious update requires review

- **WHEN** the Gallery safety check classifies an update proposal for a Listed listing as suspicious
- **THEN** the system keeps the proposal non-public, leaves the current committed revision unchanged and available only while effective access permits, and reports the listing as Listed and Reviewing

#### Scenario: Administrator approves a suspicious proposal

- **WHEN** an authorized Administrator approves a suspicious proposal and its listing remains active at the proposal's base revision with every permission and governance precondition still satisfied
- **THEN** the system records the approval, closes the proposal-review basis, atomically promotes the complete proposal, and recomputes review status from any remaining independent basis

#### Scenario: Administrator rejects a suspicious proposal

- **WHEN** an authorized Administrator rejects a suspicious initial or update proposal
- **THEN** the system records the rejection, closes the proposal-review basis, keeps the proposal non-public, preserves any prior committed revision, and recomputes review status from any remaining independent basis
- **AND** when the rejected initial proposal has no committed revision, it closes the Pending listing as Removed with closure reason `initial_policy_rejection`, keeps its slug permanently non-public, and creates a durable result for the Creator

#### Scenario: Approved proposal is no longer promotable

- **WHEN** an Administrator approves a proposal after the listing closed or its base revision became stale
- **THEN** the system records the review decision but rejects promotion without changing the current or closed listing state

#### Scenario: Safety execution fails without a policy result

- **WHEN** the safety job exhausts an attempt or reaches an infrastructure failure without an evidenced pass, reject, or review result
- **THEN** the system keeps the proposal non-public, preserves any committed revision subject to effective access, and reports recoverable processing state without treating the failure as a policy rejection

#### Scenario: Safety policy changes after an evaluation

- **WHEN** ShareSlices activates a new `GallerySafetyPolicy` after a candidate was evaluated under an earlier version
- **THEN** the system preserves the earlier evidence unchanged and records a separate evaluation if current policy requires the candidate to be checked again

### Requirement: Accept structured Gallery reports

The system SHALL allow signed-in and anonymous Viewers to report only a publicly accessible Listed current revision for malicious code or phishing, copyright, privacy or personal-data exposure, illegal content, spam, or another explained concern. Report acceptance MUST atomically verify effective public access, bind the report to the then-current listing revision and fixed Version, and create the minimum private evidence snapshot and object-retention hold required for authorized review. A concurrent update MAY bind the report to either complete committed revision, but closure, restriction, or loss of eligibility before acceptance MUST reject it without creating a report or hold.

The evidence hold MUST survive source update and Artifact or account deletion while remaining unavailable to public and Owner management routes. It MUST end only after the case and every accepted Appeal reach a terminal state, every applicable decision's snapshotted Appeal deadline passes, and the approved governance-retention deadline passes, at which point reconciliation releases the hold and deletes evidence objects with no other legal or job reference. A non-appealable dismissal or other terminal case with no appealable decision has no Appeal-deadline condition. Passing an Appeal submission deadline MUST NOT release the hold while an accepted Appeal remains non-terminal.

Report detail MUST be contract-bounded escaped plain text. Trusted and administrative surfaces MUST NOT execute it as HTML or Markdown, automatically convert it into links, or fetch a remote resource named by it. Every accepted Gallery report MUST identify its category, listing, listing revision, fixed Version, submitted detail, submission time, and review state; anonymous submissions MUST pass a challenge and a dedicated rate limit.

#### Scenario: Signed-in Viewer submits a sufficiently detailed report

- **WHEN** a signed-in Viewer selects a supported report category and supplies enough detail to review a publicly accessible Listed revision
- **THEN** the system accepts one report tied to the listing and fixed Version, creates its private evidence hold, and places it in the governance review queue

#### Scenario: Anonymous Viewer passes abuse controls

- **WHEN** an anonymous Viewer supplies a supported category and sufficient detail, passes the anonymous challenge, and remains within the report rate limit
- **THEN** the system accepts the report without creating a public Viewer identity

#### Scenario: Anonymous Viewer fails abuse controls

- **WHEN** an anonymous report fails its challenge or exceeds the report rate limit
- **THEN** the system rejects the submission without creating a governance report

#### Scenario: Report lacks reviewable detail

- **WHEN** a Viewer submits an unsupported category or omits the explanation required to evaluate the concern
- **THEN** the system rejects the report with a correction that identifies the missing or invalid field

#### Scenario: Listing closes while report acceptance races

- **WHEN** a listing becomes inaccessible before a report transaction can bind its current revision and fixed Version
- **THEN** the system rejects the report without exposing the listing metadata or creating a governance record

#### Scenario: Owner deletes an Artifact under review

- **WHEN** the Owner deletes the source Artifact after a report and evidence hold were accepted
- **THEN** public and Owner management resources close while authorized Administrators retain the immutable case snapshot until its hold expires

#### Scenario: Non-appealable case reaches a terminal result

- **WHEN** an Administrator dismisses a case without creating an appealable decision
- **THEN** the system requires no synthetic Appeal deadline and releases the evidence hold only after the case is terminal, the approved governance-retention deadline has passed, and no other legal or job reference remains

#### Scenario: Accepted Appeal outlives its submission deadline

- **WHEN** an Appeal was accepted before its deadline and remains pending after that deadline passes
- **THEN** the evidence hold remains until the Appeal reaches a terminal result and every other applicable case, deadline, retention, and reference condition is satisfied

### Requirement: Keep review state separate from listing lifecycle

The system SHALL track Clear, Reviewing, and Restricted review status independently from Pending, Listed, Withdrawn, and Removed listing status. Restricted SHALL be the listing projection of an Artifact-level Public-sharing restriction and MUST NOT be independently cleared. An active direct Artifact takedown SHALL contribute a Reviewing basis when no restriction applies while independently blocking effective public access; if any Public-sharing restriction applies, Restricted takes precedence. Reversing a takedown MUST close only that takedown basis and recompute review status from every remaining report, proposal, takedown, and restriction basis. An accepted report MUST NOT automatically hide a Listed item; the system SHALL keep it available in Reviewing state unless a credible high-risk signal or an Administrator applies a Public-sharing restriction.

#### Scenario: Ordinary report starts review without automatic removal

- **WHEN** the system accepts a Gallery report that has no credible high-risk signal requiring immediate restriction
- **THEN** the listing enters Reviewing while remaining Listed and publicly accessible until an Administrator decides otherwise

#### Scenario: Credible high-risk signal requires immediate protection

- **WHEN** an automated or reviewed signal establishes a credible high-risk concern while investigation continues
- **THEN** the system applies a Public-sharing restriction to the affected Artifact, projects its listing as Restricted, and blocks public access without deleting the Owner's private Artifact

#### Scenario: Direct Artifact takedown projects review state

- **WHEN** an Artifact takedown becomes active without an Artifact-level Public-sharing restriction for a Listed listing with a committed revision
- **THEN** the listing remains Listed, projects Reviewing, and becomes effectively inaccessible through both Gallery and Share link

#### Scenario: Direct Artifact takedown reaches a Pending listing

- **WHEN** an Artifact takedown becomes active while an initial Pending listing has no committed revision
- **THEN** the system closes its proposal and lifecycle as Removed with `initial_governance_block`, retains the takedown review basis and effective block until reversal, and never exposes or later restores that listing or slug

#### Scenario: Direct Artifact takedown is reversed

- **WHEN** the active takedown is reversed
- **THEN** the system closes only its review basis and recomputes Clear, Reviewing, or Restricted from every remaining basis without implicitly recreating a closed lifecycle resource

#### Scenario: Review finds no actionable concern

- **WHEN** an Administrator dismisses the actionable concern and no other open review basis or active Public-sharing restriction applies
- **THEN** the system returns the affected content to Clear while preserving its independent listing lifecycle state

### Requirement: Distinguish Gallery removal from other public-access actions

Only an authorized Administrator SHALL be able to Remove from Gallery or restore a platform-removed listing. Remove from Gallery MUST accept only a lifecycle-Listed listing with a previously promoted committed revision, close it as Removed with closure reason `administrator_removal`, and MUST NOT stop its Share link, delete its Artifact, remove independently owned copies, or suspend its Creator's account. It MUST reject Pending, Withdrawn, already Removed, or otherwise never-public listings without overwriting their lifecycle or closure reason. A Creator MUST NOT create a replacement listing while the Removal or restriction remains in force or an Appeal remains pending.

Restoration MUST be limited to an otherwise eligible listing that was previously public and closed with `administrator_removal`. It MUST NOT restore a never-public initial rejection, an initial governance block, Creator withdrawal, Artifact deletion, or account deletion. The restoration transaction MUST verify and preserve the one-active-listing constraint and MUST fail if a replacement listing is active or if any replacement listing was created after Removal. Once a replacement listing exists, the old Removed listing and URL MUST remain non-public and MUST NOT later be restored, even if the replacement becomes inactive.

#### Scenario: Administrator removes a listing

- **WHEN** an authorized Administrator chooses Remove from Gallery for a lifecycle-Listed listing with a committed revision and a recorded governance basis
- **THEN** the system marks the listing Removed with closure reason `administrator_removal`, stops Gallery discovery and access, and leaves the Artifact's management state and Share-link Publication unchanged

#### Scenario: Administrator attempts to remove a non-Listed lifecycle

- **WHEN** an Administrator requests Remove from Gallery for a Pending, Withdrawn, already Removed, or never-public listing
- **THEN** the system rejects the transition without changing its lifecycle, closure reason, proposal, or URL state

#### Scenario: Administrator restores an eligible removal

- **WHEN** an authorized Administrator reverses a platform removal after the listing and fixed Version are eligible for public access and no replacement listing has been created
- **THEN** the system restores the listing to Listed, clears its current closure reason, and appends the reversal to immutable lifecycle and governance history without creating a replacement listing

#### Scenario: Creator attempts to relist while removal remains in force

- **WHEN** a Creator attempts Share to Gallery for the affected Artifact while its Removal or restriction remains in force or its Appeal remains pending
- **THEN** the system rejects the replacement listing without changing the Removed listing or governance case

#### Scenario: Restoration races with replacement creation

- **WHEN** an eligible restoration and an eligible replacement-listing creation race after the Removal is reversed and no block remains in force
- **THEN** the system atomically permits only one transition to claim the active-listing constraint and rejects the other without exposing two active listings

#### Scenario: Replacement exists before restoration

- **WHEN** an Administrator attempts to restore a Removed listing after any replacement listing has been created for its Artifact
- **THEN** the system rejects restoration and keeps the old listing and URL non-public even if the replacement is now Withdrawn, Removed, or otherwise inactive

#### Scenario: Administrator attempts to restore Creator withdrawal

- **WHEN** an Administrator requests restoration of a listing whose lifecycle state is Withdrawn
- **THEN** the system rejects restoration because Creator withdrawal permanently retired that listing

#### Scenario: Administrator attempts to restore a never-public rejection

- **WHEN** an Administrator requests restoration of a Removed listing whose closure reason is `initial_policy_rejection` or `initial_governance_block`
- **THEN** the system rejects restoration of that listing and slug; a policy rejection permits a corrected fresh share, while a governance block permits one only after clearance or reversal

### Requirement: Support Artifact takedown for serious content concerns

The system SHALL provide Artifact takedown as a governance action distinct from Remove from Gallery. While active, a takedown MUST block the affected Artifact's public access through both Gallery and its Share link while preserving Owner management state and the evidence required for review; it MUST NOT silently delete the Artifact or suspend the entire User account.

Content-level propagation MUST match only direct and descendant Gallery-saved copies through immutable provenance rooted in the governed source listing and fixed Version. It MUST exclude unrelated independent Uploads, even when bytes or content digests happen to match. The matching predicate and its results MUST remain privileged and MUST NOT expose a cross-User content-existence oracle. Every propagated restriction basis MUST reference the source takedown decision that created it. A later independently uploaded Version requires ordinary review and MUST NOT silently clear that restriction.

#### Scenario: Administrator applies Artifact takedown

- **WHEN** an authorized Administrator determines that a serious safety, legal, or rights concern requires Artifact takedown
- **THEN** the system blocks Gallery and Share-link public access for the affected Artifact, preserves private Owner management access and review evidence, and records the decision

#### Scenario: Content-level takedown reaches independently saved copies

- **WHEN** an Artifact takedown decision establishes that the concern applies to the underlying content and the system identifies independently owned copies of that content
- **THEN** the system opens a review basis and applies a source-decision-linked Artifact-level Public-sharing restriction to each provenance-matching direct and descendant copy, so any listing projects Restricted while preserving each Copier's private Artifact and ownership state
- **AND** it does not include an unrelated independent Upload solely because its content is equivalent

#### Scenario: Takedown does not become account deletion

- **WHEN** the system applies an Artifact takedown to one User-owned Artifact
- **THEN** the system neither deletes that Artifact nor suspends or deletes the owning User solely as a side effect of the takedown

#### Scenario: Administrator reverses Artifact takedown

- **WHEN** an authorized Administrator reverses the last Artifact takedown and no other effective-access block remains
- **THEN** an existing Listed committed revision and a still-scheduled Publication resume access through their unchanged lifecycle resources
- **AND** the reversal does not recreate a withdrawn, removed, expired, unpublished, or deleted resource

#### Scenario: Source takedown reversal reaches propagated copies

- **WHEN** an authorized Administrator reverses a source takedown that created restriction bases on direct or descendant Gallery-saved copies
- **THEN** the system closes only the propagated bases that reference that source decision, resolves Appeals challenging those bases as reversed or moot, and recomputes each affected Artifact
- **AND** it preserves every unrelated report, takedown, restriction, Appeal, private Artifact, and lifecycle state

### Requirement: Enforce Public-sharing restrictions

A Public-sharing restriction SHALL prevent the affected Artifact from starting or restoring Share with link and Share to Gallery operations and from submitting or promoting Update Gallery while the restriction is active. A governed Artifact or listing MUST NOT return to Gallery while the decision remains in force or an Appeal is pending, and ordinary Owner management or a passing safety result MUST NOT clear the restriction or delete its audit evidence. Applying a restriction while a Gallery proposal is open SHALL close that proposal as governance-blocked while preserving the committed listing revision and review evidence. If the listing has no committed revision, the restriction SHALL instead move it to Removed with closure reason `initial_governance_block` and permanently keep its slug non-public.

#### Scenario: Owner attempts public sharing while restricted

- **WHEN** an Owner requests Share with link, Share to Gallery, or Update Gallery for an Artifact under an active Public-sharing restriction
- **THEN** the system rejects the public-sharing mutation, preserves private management access, and identifies that the governing block must be cleared or reversed

#### Scenario: Restriction reaches a never-public proposal

- **WHEN** a Public-sharing restriction applies while an initial Pending listing has no committed public revision
- **THEN** the system closes the proposal, moves the listing to Removed with closure reason `initial_governance_block`, and permits only a fresh listing and slug after the block is cleared or reversed

#### Scenario: Safety pass arrives after restriction

- **WHEN** an open proposal's safety job reports pass after a Public-sharing restriction or Artifact takedown applies or an Appeal becomes pending
- **THEN** the system records the stale result as appropriate, does not promote the proposal or clear the governance state, and keeps the committed listing revision unchanged

#### Scenario: Owner retries governed content during appeal

- **WHEN** an Owner attempts to list or update the governed Artifact or listing revision while its Appeal is pending or the challenged decision remains in force
- **THEN** the system rejects the request without creating another listing or changing the governing decision

#### Scenario: Administrator clears a restriction

- **WHEN** an authorized Administrator clears the last active Public-sharing restriction after review or Appeal
- **THEN** the system records the decision and, if no takedown or other block remains, resumes a still-scheduled Publication and an existing Listed committed revision without creating or restoring a lifecycle resource
- **AND** it makes later public-sharing mutations eligible for normal validation without creating a new Publication or listing automatically

### Requirement: Provide a bounded Appeal process

The system SHALL allow the affected Creator to Appeal an Administrator Removal with closure reason `administrator_removal` and the affected Artifact Owner to Appeal an Artifact takedown or Public-sharing restriction, including an Owner of a private saved copy who has never become a Creator. An initial proposal rejection, whether mapped directly by deterministic policy or decided after suspicious-content review, is not appealable in the first release and MUST provide a correction and fresh-share path instead. An approved versioned `GalleryAppealPolicy` MUST define the appealable decision categories and window duration. Every appealable decision MUST atomically snapshot that policy version and a Server-time Appeal deadline; activating a later policy MUST affect only later decisions and MUST NOT shorten, extend, or reinterpret an existing deadline. Appeal acceptance MUST atomically verify that the challenged decision remains active and in force, the requester is the affected party, the snapshotted deadline has not passed, and no prior Appeal for that party and decision is already open or resolved. It MUST serialize with decision reversal so no Appeal can attach after reversal. A same-key retry SHALL return the existing Appeal; another duplicate, late, or post-reversal submission SHALL return a stable non-mutating result. An accepted Appeal MUST reference the challenged decision, policy version, and deadline, preserve the governing public-access block until resolution, support an authorized uphold or reversal decision, and never reveal the reporter's identity. If the challenged decision is directly reversed after Appeal acceptance, the reversal transaction MUST resolve that Appeal as reversed or moot and recompute every dependent access, restoration, and replacement block so no pending Appeal remains attached to an inactive decision. Appeal explanations and decision rationales MUST be contract-bounded escaped plain text and MUST NOT execute markup, become automatic links, or trigger remote-resource retrieval on any trusted or administrative surface.

#### Scenario: Affected party submits an Appeal

- **WHEN** the affected Creator Appeals an active `administrator_removal` or the affected Artifact Owner Appeals an active takedown or Public-sharing restriction within its Appeal window and with the required explanation
- **THEN** the system records the Appeal against that decision and keeps the existing public-access restriction in force pending review

#### Scenario: Appeal policy changes after a decision

- **WHEN** ShareSlices activates a new `GalleryAppealPolicy` after an appealable decision recorded its policy version and deadline
- **THEN** the existing decision keeps its original deadline and rules while later decisions snapshot the new policy

#### Scenario: Appeal races with decision reversal

- **WHEN** Appeal acceptance and reversal of the challenged decision race
- **THEN** the system serializes them so a reversal committed first causes the Appeal to return stable post-reversal ineligibility, while Appeal acceptance committed first creates the Appeal and the later reversal atomically resolves it as reversed or moot and recomputes every dependent block

#### Scenario: Party repeats or submits an ineligible Appeal

- **WHEN** an affected party retries with the accepted idempotency key, submits another Appeal for the same decision, submits after the window, or submits after the decision is no longer in force
- **THEN** a same-key retry returns the existing Appeal and every other duplicate, late, or post-reversal submission returns a stable non-mutating result without reapplying a block

#### Scenario: Administrator upholds an Appeal

- **WHEN** an authorized Administrator decides that the challenged governance action remains necessary
- **THEN** the system records the rationale, keeps the applicable removal, takedown, or restriction in force, and provides the affected Creator or Artifact Owner the resulting decision

#### Scenario: Administrator reverses an Appeal

- **WHEN** an authorized Administrator decides that an eligible challenged governance action must be reversed
- **THEN** the system records the reversal and clears only the challenged takedown or restriction, or closes the challenged `administrator_removal` decision independently from any restoration attempt
- **AND** if no other block remains, a preserved still-scheduled Publication and existing Listed committed revision resume effective access, while an otherwise eligible `administrator_removal` may use the explicit restoration transition
- **AND** if another block prevents restoration, the reversed listing remains non-public and restorable until a later explicit restoration or confirmed replacement, and no closed lifecycle resource reappears implicitly

#### Scenario: Artifact deletion wins over listing-removal Appeal

- **WHEN** Artifact or Creator-account deletion converts a previously public `administrator_removal` listing to Withdrawn while an Appeal of that listing removal is pending
- **THEN** the system closes that restoration-only Appeal as moot, records that deletion permanently prevents restoration, and preserves its evidence under the applicable governance hold
- **AND** it does not close an unrelated takedown or restriction case whose decision still governs provenance-matching copies

### Requirement: Provide an auditable administration queue

The system SHALL provide authorized Administrators a review queue containing suspicious initial and update proposals, Gallery reports, listings, fixed Versions, Creators, Source attribution, and prior governance decisions required to evaluate each case. Executable review of a non-public candidate MUST use the separate case-bound Administrator review authorization and isolated content boundary owned by `gallery-security`; if that preview is unavailable, the queue MUST show static evidence and stable preview unavailability and MUST NOT execute candidate content on a trusted Origin. Proposal approval or rejection, report dismissal, Removal, restriction or clearance, Artifact takedown, eligible restoration, Featured changes, and Appeal decisions MUST each produce a durable audit record identifying the administrative actor, time, governed resources, decision basis, and prior and resulting states.

#### Scenario: Administrator opens a queued report

- **WHEN** an authorized Administrator opens a Gallery report awaiting review
- **THEN** the system presents the report, listing, fixed Version, Creator, available Source attribution, and prior decisions without granting Artifact content management ownership

#### Scenario: Administrator opens a queued proposal

- **WHEN** an authorized Administrator opens a suspicious initial or update proposal awaiting review
- **THEN** the system presents its metadata, base listing revision, Creator, grant-evidence reference, safety result, prior committed revision, and either an isolated case-bound preview or explicit preview-unavailable state needed for a decision

#### Scenario: Administrator records a governance decision

- **WHEN** an authorized Administrator approves or rejects a proposal, dismisses, removes, restricts, clears, takes down, restores, features, removes from Featured, upholds, or reverses an eligible governed resource
- **THEN** the system applies only that authorized transition and appends its actor, time, basis, affected resources, and prior and resulting states to the governance audit history

#### Scenario: Unauthorized User attempts an administrative action

- **WHEN** a User without Gallery governance authority requests a review-queue record or administrative mutation
- **THEN** the system denies the request without exposing report, reporter, evidence, or non-public Creator information and without changing governance state

### Requirement: Curate Featured listings through audited administration

Featured SHALL contain only publicly eligible Listed Gallery revisions. Only authorized Administrators SHALL add or remove Featured placement, every change MUST be audited, and the first release MUST NOT sell placement or derive Featured membership automatically from views, downloads, copies, or other engagement signals. If a Featured listing becomes ineligible, the system MUST durably remove its placement rather than only hiding it; later eligibility MUST NOT restore Featured placement automatically.

#### Scenario: Administrator features an eligible listing

- **WHEN** an authorized Administrator selects a publicly eligible Listed revision for Featured
- **THEN** the system adds the listing to Featured and records the administrative action

#### Scenario: Listing becomes ineligible while featured

- **WHEN** a Featured listing becomes Withdrawn, Removed, Restricted, taken down, or otherwise effectively inaccessible
- **THEN** the system durably removes its Featured placement and records the eligibility-driven change

#### Scenario: Former Featured listing becomes eligible again

- **WHEN** a listing whose Featured placement was removed for ineligibility later becomes eligible
- **THEN** it remains outside Featured until an authorized Administrator creates a new audited placement

#### Scenario: Ineligible listing is submitted for Featured

- **WHEN** an Administrator attempts to feature a listing that is not a publicly eligible Listed revision
- **THEN** the system rejects the request and leaves Featured unchanged

### Requirement: Deliver Creator results and governance notifications

The system SHALL provide the Creator with immediate or durable results for Share to Gallery, Update Gallery, and Withdraw from Gallery operations, including an asynchronous initial policy rejection. It SHALL create a durable in-product notification for each material Removal and Appeal decision for the affected Creator and for each Artifact takedown, Public-sharing restriction, and related Appeal decision for the affected Artifact Owner. Authenticated management SHALL let each affected party read only their notifications. Governance notifications MUST state the decision category, applicable rule, current effect, and available Appeal path without identifying the reporter; an appealable decision MUST also state its snapshotted deadline, while a non-appealable result MUST say that no Appeal is available. Their User-controlled and administrative text MUST be rendered as bounded escaped plain text without executable markup, automatic links, or remote-resource retrieval. Email delivery is outside the first release, and the system MUST NOT generate a notification for every Gallery view, copy, or download.

#### Scenario: Creator completes a Gallery management operation

- **WHEN** Share to Gallery, Update Gallery, or Withdraw from Gallery reaches a known successful or failed result
- **THEN** the system provides the Creator that result and does not imply a state that the operation did not durably reach

#### Scenario: Material governance action affects a Creator

- **WHEN** an Administrator records Removal, Artifact takedown, Public-sharing restriction, or an Appeal decision
- **THEN** the system creates a durable in-product notification readable through the affected Creator's or Artifact Owner's authenticated management surface, as applicable, with the category, applicable rule, current effect, and available Appeal path and no reporter identity

#### Scenario: Initial safety check rejects asynchronously

- **WHEN** an accepted initial Gallery proposal later closes as `initial_policy_rejection`
- **THEN** the system creates a durable Creator-visible result that identifies the policy category and correction path without exposing unsafe evidence or offering Appeal or restoration

#### Scenario: Viewer engages with a listing

- **WHEN** a Viewer views, downloads, or saves a copy of a Gallery listing
- **THEN** the system records only the permitted operational event and sends no per-engagement notification to the Creator

### Requirement: Limit Gallery Viewer data and retention

Gallery MUST NOT create public Viewer identities or permanent browsing histories. The system SHALL retain raw pseudonymous Viewer signals used for Gallery engagement aggregation, rate limiting, or abuse investigation for no more than 30 days, after which it MUST delete them or convert them into aggregates that cannot identify or be linked back to an individual Viewer. Longer-lived Gallery engagement aggregates MUST remain non-identifying, MUST NOT be exposed publicly, and MUST NOT be used for public ordering, search ranking, or Featured selection.

#### Scenario: Gallery operation generates a raw Viewer signal

- **WHEN** a view, download, Save a copy, or report operation generates an additional raw signal for aggregation, rate limiting, or abuse investigation
- **THEN** the system keeps that additional signal pseudonymous with a retention deadline no later than 30 days and does not expose it as a public Viewer identity or browsing history

#### Scenario: Raw signal reaches its retention limit

- **WHEN** a raw pseudonymous Gallery signal reaches 30 days of retention
- **THEN** the system deletes it or irreversibly aggregates it so that the retained data cannot identify or be linked back to the Viewer

#### Scenario: Gallery retains aggregate engagement metrics

- **WHEN** the system retains view, copy, or download aggregates beyond the raw-signal retention window
- **THEN** those aggregates contain no individual Viewer identity, durable browsing history, or reversible pseudonymous identifier and remain unavailable to public responses and ranking
