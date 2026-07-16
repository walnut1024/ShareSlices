# Artifact publication delta specification

## MODIFIED Requirements

### Requirement: Manage owned Artifacts

The Web management surface SHALL present owned Artifacts and expose only state-valid Preview, Full-screen Preview, Share with link, Manage link, Copy link, Stop sharing link, Share to Gallery, Manage Gallery, Rename, Export, Delete, Retry, and Replace file actions. Share with link and Share to Gallery MUST remain separate controls and MUST NOT be collapsed into a generic Share action. For every ready Artifact with no Artifact takedown, Public-sharing restriction, or other effective public-sharing block, the Web SHALL preserve an explicit Share with link path when its link is active, Expired, or Link stopped so the Owner can select another ready Version or restore link access. An active-link card MAY present Manage link as its primary link action, but the card, Artifact detail, or Manage link surface MUST expose the distinct Share with link flow.

Pending and Listed Gallery listings SHALL expose Manage Gallery with only their state-valid actions. A Withdrawn predecessor SHALL not expose update or withdrawal and MAY expose Share to Gallery for a new listing when the Artifact is eligible. A Removed listing SHALL expose its governance result and Appeal path as applicable, but MUST NOT expose Gallery update, withdrawal, restoration, or replacement share while its governing decision remains in force or an Appeal remains pending. After a corrected `initial_policy_rejection` or fully cleared or reversed `initial_governance_block`, the Web SHALL expose Share to Gallery for a new listing when the Artifact is otherwise eligible. After `administrator_removal` is reversed but before the old listing is restored, the Web MAY expose replacement Share to Gallery only with a destructive warning and explicit confirmation that replacement permanently forfeits restoration of the old listing URL, identity, and counters. Publication history, Gallery governance history beyond the current actionable result, analytics, and link replacement outside Share with link SHALL NOT be exposed through ordinary Artifact actions.

#### Scenario: Owner uses a ready never-shared Artifact card

- **WHEN** a signed-in Owner opens the Artifact dashboard and a ready Artifact has no active link or Gallery listing and no effective public-sharing block
- **THEN** the grid card provides separate Share with link and Share to Gallery actions together with Preview, Full-screen Preview, Rename, Export, and Delete
- **AND** it exposes neither Copy link nor Gallery management

#### Scenario: Owner uses an Artifact with active link sharing

- **WHEN** a signed-in Owner opens an Artifact whose Publication is externally accessible
- **THEN** the Web presents Manage link, Copy link, and Stop sharing link plus only the independent state-valid Gallery action
- **AND** it preserves an explicit Share with link path for selecting another ready Version or other Publish choices

#### Scenario: Owner uses an Artifact whose link is no longer active

- **WHEN** a signed-in Owner opens a ready Artifact whose Link sharing status is Expired or Link stopped and no effective public-sharing block applies
- **THEN** the Web presents Share with link so the Owner can restore access using the existing Share link by default

#### Scenario: Owner uses a Gallery-listed Artifact

- **WHEN** a signed-in Owner opens an Artifact with a Pending or Listed Gallery listing
- **THEN** the Web presents Manage Gallery without replacing Share with link or Manage link

#### Scenario: Owner uses both public channels

- **WHEN** an Artifact has an active Share link and an active Gallery listing
- **THEN** its card and detail page expose separate Manage link and Manage Gallery controls rather than one generic Share menu

#### Scenario: Owner opens an Artifact after Gallery withdrawal

- **WHEN** an eligible ready Artifact has only a Withdrawn Gallery predecessor
- **THEN** the Web offers Share to Gallery for a new listing and exposes neither update nor withdrawal for the retired predecessor

#### Scenario: Owner opens an Artifact with an enforced Gallery removal

- **WHEN** an Artifact's latest Gallery listing is Removed under a decision that remains in force or a pending Appeal
- **THEN** the Web presents the governance result and available Appeal action without Gallery update, withdrawal, restoration, or replacement-share controls

#### Scenario: Owner opens an Artifact after eligible initial rejection

- **WHEN** an Artifact's latest listing closed with `initial_policy_rejection`, or with `initial_governance_block` whose every block and Appeal is cleared or reversed
- **THEN** the Web offers Share to Gallery for a new listing and does not offer update, withdrawal, or restoration of the old listing

#### Scenario: Owner chooses replacement after reversed removal

- **WHEN** an `administrator_removal` is reversed, the old listing remains Removed and restorable, and the Owner chooses replacement Share to Gallery
- **THEN** the Web warns that confirmation permanently forfeits the old URL, identity, counters, and restoration before submitting the new share

### Requirement: Delete an Artifact permanently

The Owner SHALL be able to permanently delete an Artifact that is not accepted or processing. When a Pending or Listed Gallery listing exists, confirmation MUST state that deletion permanently closes the listing and Gallery URL; for a previously public `administrator_removal`, it MUST state that deletion permanently ends restoration and retires the URL. Confirmed deletion SHALL atomically close every open proposal, move the Pending, Listed, or previously public `administrator_removal` listing to Withdrawn with closure reason `artifact_deleted`, and retire its URL before removing the Artifact's management resources and ending new public serving. A never-public Removed listing remains Removed and `404` but records source deletion and becomes non-restorable. The system MAY retain a minimum non-public governance tombstone. It MUST retain case-bound evidence and objects while an accepted governance hold remains active, committed source objects while an accepted-copy reference remains active, and committed Version objects while a bounded active-download source-read lease remains active. Every retained object MUST remain unavailable through new public and Owner management routes except to its already authorized Download stream and MUST be deleted after its last hold. Another User MUST NOT be able to delete the Artifact, and independently owned copies MUST remain available.

#### Scenario: Owner confirms deletion without a Gallery listing

- **WHEN** the Owner confirms Delete for a ready or failed Artifact that has no active Gallery listing
- **THEN** the Artifact disappears from management and its Viewer link no longer resolves

#### Scenario: Owner confirms deletion with a Gallery listing

- **WHEN** the Owner confirms Delete after being warned that an active Gallery listing and URL will close
- **THEN** the system atomically moves that listing to Withdrawn with closure reason `artifact_deleted`, retires its URL, and deletes the owned Artifact management graph
- **AND** it does not delete independently owned saved copies

#### Scenario: Owner attempts deletion during processing

- **WHEN** the Artifact is accepted or processing
- **THEN** the system rejects deletion without changing the Artifact or its public-channel state

### Requirement: Batch Publish eligible Artifacts

The Web SHALL present the existing batch link-Publish operation as batch Share with link for a non-empty Artifact selection. Before opening the dialog, the Web MUST verify that every selected Artifact currently exposes Share with link as a state-valid action, has a latest ready Version, and has no Artifact takedown, Public-sharing restriction, or other effective public-sharing block. A ready Artifact MAY remain eligible when its underlying Link sharing status is Not shared, Link active, Expired, or Link stopped. If any selection is ineligible, the Web MUST send no Publish request and MUST use Sonner to state that Share with link was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL collect one expiration choice, Publish each Artifact's latest ready Version with that choice, and reuse each Artifact's existing Share link. Batch Share with link MUST NOT offer Share-link replacement or Share to Gallery and MUST NOT run more than three single-Artifact Publish calls concurrently.

#### Scenario: Selection includes an Artifact that cannot share with a link

- **WHEN** an Owner clicks batch Share with link and at least one selected Artifact lacks that action or a latest ready Version
- **THEN** the Web sends no Publish requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Batch Share with link succeeds

- **WHEN** every selected Artifact is eligible and every single-Artifact Publish call succeeds with the chosen expiration
- **THEN** the Web updates all affected Link sharing statuses, summarizes success, and exits selection mode

#### Scenario: Batch Share with link partially succeeds

- **WHEN** eligibility preflight passes but one or more single-Artifact Publish calls fail
- **THEN** the Web keeps successful mutations, retains only failed Artifacts as selected, and reports success and failure counts plus the first concrete failure reason

### Requirement: Batch Delete eligible Artifacts permanently

The Web SHALL offer batch Delete for a non-empty Artifact selection. Before confirmation, the Web MUST verify that every selected Artifact currently exposes Delete as a state-valid action. If any selection is ineligible, the Web MUST send no Delete request and MUST use Sonner to state that Delete was blocked, the affected count, and the reason.

For an eligible selection, the Web SHALL require destructive confirmation that states the selected count and that deletion immediately removes the Artifacts, Versions, Publications, Share links, applicable Gallery listings and URLs, and stored files from management and new public serving. It SHALL state that physical cleanup can wait for an accepted governance review or copy, or an already authorized Download, to finish. The Web MUST use the existing single-Artifact Delete contract, MUST NOT run more than three calls concurrently, and MUST NOT automatically retry a failed destructive request. A successful response SHALL mean the Artifact is removed from management; the Web MUST NOT claim that backend object cleanup completed synchronously or that independently owned copies were deleted.

#### Scenario: Selection includes an Artifact that cannot be deleted

- **WHEN** an Owner clicks batch Delete and at least one selected Artifact lacks the Delete action
- **THEN** the Web sends no Delete requests, preserves the selection, and shows the blocking reason through Sonner

#### Scenario: Owner confirms batch Delete

- **WHEN** every selected Artifact is eligible and the Owner confirms permanent deletion
- **THEN** the Web submits the existing Delete operation for each selected Artifact with at most three calls in progress
- **AND** each successful operation closes every applicable Pending, Listed, or previously public `administrator_removal` listing according to the single-Artifact Delete contract before management removal

#### Scenario: Batch Delete partially succeeds

- **WHEN** one or more confirmed Delete calls succeed and one or more fail
- **THEN** successfully deleted Artifacts disappear, failed Artifacts remain selected, and Sonner reports success and failure counts plus the first concrete failure reason without automatic retry

### Requirement: Exclude batch Export

The first Web selection mode with Gallery SHALL expose Share with link and Delete batch actions only. It MUST NOT expose batch Export, Share to Gallery, or initiate multiple single-Artifact downloads from one batch action.

#### Scenario: Owner enters selection mode

- **WHEN** an Owner selects one or more Artifacts
- **THEN** the batch toolbar offers Share with link and Delete without Export or Share to Gallery

### Requirement: Project one Publication status

The management API SHALL continue to project exactly one underlying Publication status for each Artifact: Not published when no Publication has ever existed, Published while the latest Publication's schedule remains active, Expired after its scheduled end, or Unpublished after the Owner ends it early. The Web SHALL project those same facts as Not shared, Link active, Expired, or Link stopped respectively. An Artifact takedown or Public-sharing restriction SHALL be projected independently from that lifecycle and MUST NOT rewrite any of those four statuses. While a restriction blocks effective public access, the Web SHALL show the underlying Link sharing status together with a Restricted notice. Superseded Publications SHALL remain internal history and MUST NOT appear as another current state; Gallery listing and review status MUST remain separate fields.

#### Scenario: Artifact has never been shared with a link

- **WHEN** an Owner views a ready Artifact that has no Publication history
- **THEN** the API reports Not published while the Web shows Not shared and offers Share with link without exposing a Share link

#### Scenario: Publication reaches its scheduled end

- **WHEN** the latest Publication's effective expiration passes without a later Publish
- **THEN** both projections report Expired, preserve the Share link, and disable Copy link until the Owner shares with the link again

#### Scenario: Owner stops link access early

- **WHEN** the Owner uses Stop sharing link before the scheduled end
- **THEN** the API reports Unpublished, the Web shows Link stopped, and the unchanged Gallery listing status remains independently projected

#### Scenario: Governance blocks an active Publication

- **WHEN** an Artifact takedown or Public-sharing restriction applies while the underlying Publication schedule remains active
- **THEN** the API continues to report Published and the Web shows Link active together with a Restricted notice
- **AND** public Share-link serving is blocked without rewriting the Publication lifecycle

#### Scenario: Last public-access block clears before the Publication expires

- **WHEN** the last applicable Artifact takedown or Public-sharing restriction clears while the underlying Publication schedule remains active and no other effective-access block remains
- **THEN** the unchanged Link active Publication resumes serving through the same Share link

#### Scenario: Last public-access block clears after the Publication expires

- **WHEN** the last applicable Artifact takedown or Public-sharing restriction clears after the underlying Publication schedule has ended
- **THEN** the API reports Expired, the Web shows Expired, and Share-link serving does not resume automatically

#### Scenario: Restriction clears while takedown remains

- **WHEN** the last Public-sharing restriction clears but an Artifact takedown or another effective-access block remains
- **THEN** the underlying Publication status stays unchanged and public serving remains blocked

### Requirement: Manage an accessible Publication

The Owner SHALL use Manage link to view and copy the Share link and change an accessible Publication between permanent and an exact future expiration without publishing again. The system MUST reject a current or past expiration and leave the Publication unchanged. Manage link MUST NOT itself replace the Share link, select another Version, reactivate an Expired or Link stopped Publication, or change a Gallery listing; it MAY route the Owner to the distinct Share with link flow for those Publish choices. Stop sharing link SHALL invoke the existing Unpublish transition.

While an Artifact takedown or Public-sharing restriction blocks effective public access, Manage link SHALL continue to show the underlying Publication and Share-link settings together with a Restricted notice. The Web MUST disable Copy link, Share with link, Publication extension, and Version-changing Publish while blocked, but it SHALL continue to permit read-only management and Stop sharing link.

#### Scenario: Owner extends the current link availability

- **WHEN** the Owner changes the current Publication to a later future expiration through Manage link
- **THEN** the same Publication and Share link remain accessible until the new effective end

#### Scenario: Owner makes link availability permanent

- **WHEN** the Owner clears the current Publication expiration through Manage link
- **THEN** the same Publication and Share link remain accessible without a scheduled end

#### Scenario: Owner requests immediate expiration

- **WHEN** the Owner submits a current or past expiration
- **THEN** the system rejects it and directs immediate removal through Stop sharing link

#### Scenario: Owner selects another Version from link management

- **WHEN** the Owner chooses to Share with link another ready Version from the Manage link or Artifact detail surface
- **THEN** the Web opens the distinct Share with link flow rather than treating the selection as a Manage link edit

#### Scenario: Owner manages a restricted active Publication

- **WHEN** the Owner opens Manage link while a Public-sharing restriction blocks an otherwise Link active Publication
- **THEN** the Web shows the underlying status and settings with a Restricted notice and permits Stop sharing link
- **AND** it disables Copy link, Share with link, Publication extension, and Version change until the restriction clears

## ADDED Requirements

### Requirement: Keep link and Gallery sharing independent

Publish, Publication editing, Share-link replacement, and Unpublish SHALL NOT create, update, withdraw, remove, or otherwise change a Gallery listing. Gallery share, update, withdraw, restriction, and removal SHALL NOT create, edit, replace, expire, or stop a Share link or Publication. An Artifact takedown or Public-sharing restriction SHALL affect the independent effective public-access and restriction projection without rewriting the Publication lifecycle, Link sharing status, Gallery listing lifecycle, or their history.

#### Scenario: Owner stops link sharing while listed in Gallery

- **WHEN** an Owner stops an Artifact's link sharing while its Gallery listing remains active and unrestricted
- **THEN** the Share link stops serving content and the Gallery listing continues serving its fixed Version

#### Scenario: Creator withdraws Gallery while link sharing remains active

- **WHEN** a Creator withdraws an active Gallery listing while its Publication remains accessible
- **THEN** the Gallery URL retires and the Share link continues serving its selected Publication Version

#### Scenario: Platform performs Artifact takedown

- **WHEN** an authorized platform decision applies Artifact takedown
- **THEN** both Gallery and Share-link public serving stop while their independent lifecycle records and statuses remain unchanged and distinguishable
