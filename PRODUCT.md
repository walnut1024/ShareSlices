# ShareSlices product

ShareSlices turns agent-generated HTML reports, presentations, and slice decks into stable links people can share and, when the Creator chooses, into public Gallery listings people can discover, download, and save as independent copies.

This document defines the product contract. Engineering choices belong in `AGENTS.md`.

## Product boundary

ShareSlices is the share layer for static web artifacts created by agents such as Claude, Codex, and similar tools.

An artifact has an HTML entry file and supporting assets such as JavaScript, CSS, images, fonts, and data files. ShareSlices turns that local static web artifact into a shareable web page or a discoverable Gallery listing without changing its immutable Version content.

The product starts where an agent finishes. ShareSlices takes local agent output, creates a stable Share link when requested, and can separately list a fixed Version in Gallery.

## Supported clients

ShareSlices-owned Web UI, Gallery, and Viewer surfaces support desktop browsers only. Mobile browsers, tablet layouts, touch-specific interaction, and responsive mobile layouts are outside the supported product scope and receive an explicit unsupported message. ShareSlices serves uploaded artifacts as provided and does not adapt their layouts for different devices.

## Who it is for

ShareSlices is for non-programmer users who ask an agent to create a report, presentation, or keynote-style slice deck.

The agent is the primary product entry point. The expected path is that the agent calls the ShareSlices Skill, the Skill calls the command-line interface (CLI), and the user receives a link or Gallery result matching the operation they requested.

Programmers and automation workflows can integrate directly, but product decisions prioritize non-programmer users.

## Agent and CLI execution

The official Skill preserves the user's requested operation. Upload-only intent remains Upload, explicit link sharing uses Publish, explicit Gallery intent uses the corresponding Gallery operation, and management requests use the corresponding management operation. The Skill does not make content externally accessible or discoverable merely because the user did not request an intermediate review.

The Skill selects user-authorized local inputs and may perform deterministic inspection, builds, or local repairs already implied by the Artifact-creation request. It asks before a choice would materially change the content, Artifact target, Entry file, link-sharing intent, Gallery intent, or an irreversible result. The CLI owns packaging, validation, authentication, transfer, retry policy, lifecycle defaults, and Server calls; the Server remains authoritative for account, authorization, Artifact, Version, Publication, Gallery listing, and validation state.

The installed CLI provides a separate Agent mode for the official Skill. Agent mode is non-interactive, suppresses transient progress, and returns one versioned Outcome envelope for each invocation. Capability discovery is local and does not require credentials or network access. The Skill selects a mutually supported Agent protocol version for operational commands and does not fall back to human output, selected-field JSON, or direct REST calls when negotiation fails. Existing human CLI output and selected-field JSON remain separate compatibility surfaces.

Agent outcomes distinguish completed, active, partial, action-required, failed, indeterminate, and cancelled work while preserving only known durable resources and Server evidence. A Next action can request authorization, ambiguity resolution, irreversible confirmation, installation or upgrade, local-input correction, state inspection, delayed retry, or support. Indeterminate mutations require state inspection before any replay, and retries require contract evidence that they are safe.

Browser authorization is the only resumable Agent operation in protocol version 1. Its Continuation identifies authorization state only; it contains no business command, local path, Artifact content, credential, or irreversible confirmation. The official Skill does not activate an Agent protocol release until every operation it advertises has passing contract and safety coverage.

## User accounts

Users sign up and sign in with email first. Product planning also includes phone, Google, and WeChat sign-in methods.

The Web uses `/sign-in`, `/sign-up`, and `/reset-password` as the dedicated account-entry addresses. The root path does not use query-selected account-entry views.

After a successful Web sign-in, ShareSlices follows a validated same-origin Gallery or management return destination when authentication originated there. Otherwise it opens the signed-in user's Artifact list without requiring a separate confirmation action.

A signed-in user can sign out of the current browser Session from the Web account menu. Sign out keeps an accessible public Gallery or Creator page in place with signed-out navigation; signing out from authenticated management returns to the Gallery root. Sign out leaves every other Session active; signing out all Sessions remains part of later account-management work.

The account identity is anchored by a ShareSlices user ID. Email, phone, Google identity, and WeChat identity are authentication methods attached to that user. ShareSlices maps a proven authentication method to one user instead of creating duplicate accounts for the same person.

Email verification is a deployment policy. A deployment or future administration setting can require or skip email verification for email sign up and sign in. Phone sign in requires a verified one-time code. Google sign in uses the Google provider subject as the external identity. WeChat sign in uses `unionid` when available and otherwise falls back to the current-app `openid`.

Signup rejects a normalized email already owned by either a verified or unverified account before creating verification work. The API returns `email_already_registered`, and the Web keeps the visitor on Signup with an Email-field message telling them to use a different address. This explicit occupied-email feedback is limited to Signup; login and password reset keep their existing neutral account-existence behavior.

External identity sign in should prove the provider account first, then resolve or create the ShareSlices user account through the same account resolution rules. Provider profile fields such as nickname and avatar do not prove ownership and must not merge accounts.

The first CLI sign-in method uses the browser. The CLI shows a short verification code and opens a ShareSlices Web page where the user signs in, confirms the same code, and explicitly approves or denies the CLI. Approval creates a CLI Session that is independent from the approving browser Session. Signing out from the CLI revokes only that CLI Session and leaves browser and other CLI Sessions active.

The CLI stores its credential only in the operating system credential store. It never asks for or stores the user's email password. The CLI sends its version and operating-system identifier to the API for compatibility checks; ShareSlices does not store that information as a device identity. An unsupported CLI version must be upgraded before authorization or authenticated submissions can continue. AK/SK credentials and other unattended sign-in methods remain future work.

## Roadmap: user administration

Administrative user account management covers user search, user deactivation, user reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit history.

Deactivating a user blocks future sign-in and revokes active management sessions. It does not automatically unpublish artifacts; artifact takedown is a separate product decision.

Deleting a user should start as soft deletion because artifacts and audit records can reference the user. Physical deletion requires a separate retention and export policy.

## Roadmap: enterprise organizations

Enterprise use introduces organizations as a separate scope from personal use. An organization groups users through memberships and owns organization-managed artifacts, settings, verified domains, and identity connections.

Enterprise SSO and directory provisioning map external identities to organization memberships. They do not replace the ShareSlices user ID. A person can keep one user account while belonging to personal and organization scopes.

Organization policy, private organization sharing, teams, and workspace administration are enterprise-scope product work.

## How people use ShareSlices

Sharing is the core user outcome. The Web keeps three actions explicit:

- **Upload**: Send a local artifact to ShareSlices
- **Share with link**: Choose the Version, make it externally accessible for a chosen duration, and receive the stable Share link
- **Share to Gallery**: Choose one ready Version and make that fixed Version publicly discoverable in Gallery

Upload creates Version history without making content externally accessible. Share with link invokes the existing Publish transition and controls what the Share link serves and for how long. Share to Gallery creates an independent Gallery listing and does not create or modify a Publication or Share link. There is no third generic Share lifecycle.

The Skill and CLI can complete the common link path by collecting local content, uploading it, waiting for a ready Version, publishing with explicit or default settings, and returning the Share link. Stepwise Upload and Publish remain available for CLI compatibility. Gallery management uses explicit `artifact gallery view`, `artifact gallery share`, `artifact gallery update`, and `artifact gallery withdraw` commands. The Web app shows separate Share with link and Share to Gallery actions, changing them to Manage link and Manage Gallery when the corresponding resource exists.

## Core workflow

The main workflow starts inside an agent session:

1. The user asks an agent to create slices
2. The agent creates a local static web artifact
3. The agent calls the ShareSlices Skill
4. The Skill finds or receives the entry file, then calls the CLI
5. The CLI uploads the Artifact to ShareSlices
6. ShareSlices creates a new immutable Version
7. The user or agent requests Share with link, and ShareSlices publishes that Version with a duration
8. ShareSlices makes the Version externally accessible and returns the Artifact's Share link

The first Publish creates an Artifact's Share link. Later Publish and Unpublish operations preserve that link unless the Owner explicitly replaces it during Publish:

```text
https://view.example.com/a/{share_slug}/
```

When the Artifact has a current accessible Publication, the Viewer opens its selected Version. When that Publication expires or the Owner ends it early, the same link opens a non-content status page until the Owner publishes again.

## Artifact rules

`CONTEXT.md` owns durable glossary definitions. This section records product rules for artifact behavior.

An Artifact name is trimmed and contains 1 to 120 characters. Names are mutable owner-facing labels and do not need to be unique; the Artifact ID is the stable identity.

Every upload creates a new version. A version never changes after creation.

Publishing preserves Version content and atomically creates a time-bounded Publication for the selected ready Version. A Publication is permanent by default; the Owner can instead choose a relative duration or an exact future end time.

Publishing an older Version creates a new Publication for that Version. Product language calls this publishing a historical Version.

Publishing while another Publication is accessible atomically replaces it. The new Publication reuses the previous duration policy by default: permanent stays permanent, a relative duration restarts from the new Publish time, and an exact end time is reused only while it remains in the future.

## Artifact limits

Upload validation enforces product limits on archive size, expanded size, file count, and allowed file types. The limits are deployment configuration with product-defined defaults.

The default upload limits are:

- ZIP archive size: 50 MiB
- Expanded total size: 200 MiB
- Expanded regular files: 1,000
- Single expanded file: 50 MiB

Account storage accounting is versioned independently from upload validation. Its initial safe
defaults are 100 owned Artifacts, 5 GiB of committed owned Content-bundle bytes, and 10 newly
accepted Save-a-copy operations per rolling hour. An accepted copy reserves one Artifact and its
fixed Version's committed bytes against the Copier before work starts. Ready commit converts the
reservation to usage; proven failure or cancellation releases it; an indeterminate operation keeps
the reservation until reconciliation establishes a terminal result. Operators change these limits
only by activating a new immutable policy revision; existing reservation evidence retains its
original revision.

The first upload capability sends one ZIP with an unambiguous root HTML entry to the server. In the Web app, a user may instead select one self-contained `.html` or `.htm` file; the Web app packages it as a ZIP with a root `index.html` before upload. This single-file convenience does not collect local CSS, JavaScript, images, fonts, or other referenced files. The capability accepts document-oriented static web resources and rejects audio, video, WebAssembly, arbitrary binary attachments, nested archives, links, and special files.

ShareSlices ignores known operating-system metadata that does not belong to Artifact content. When a safe normalization leaves no root `index.html`, ShareSlices may use the only unambiguous root HTML file as the entry file. It does not guess when multiple entry candidates remain. Validation failures identify the affected file, the violated rule, relevant actual and allowed values, and a user-actionable correction whenever that information is available.

The default enabled formats are:

| Kind | Extensions | Content type | Validation |
| --- | --- | --- | --- |
| HTML | `.html` | `text/html` | UTF-8 text |
| CSS | `.css` | `text/css` | UTF-8 text |
| JavaScript | `.js`, `.mjs` | `text/javascript` | UTF-8 text |
| JSON | `.json` | `application/json` | UTF-8 JSON |
| Plain text | `.txt` | `text/plain` | UTF-8 text |
| CSV | `.csv` | `text/csv` | UTF-8 text |
| TSV | `.tsv` | `text/tab-separated-values` | UTF-8 text |
| PNG | `.png` | `image/png` | PNG signature |
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` | JPEG signature |
| GIF | `.gif` | `image/gif` | GIF signature |
| WebP | `.webp` | `image/webp` | RIFF WebP signature |
| AVIF | `.avif` | `image/avif` | ISO base media file format AVIF brand |
| SVG | `.svg` | `image/svg+xml` | UTF-8 XML with an SVG root |
| Icon | `.ico` | `image/x-icon` | ICO signature |
| WOFF | `.woff` | `font/woff` | WOFF signature |
| WOFF2 | `.woff2` | `font/woff2` | WOFF2 signature |

Internal HTML, CSS, and JavaScript references must use relative URLs. For example, an entry page at `/a/{share_slug}/` resolves `assets/app.js` to `/a/{share_slug}/assets/app.js`; root-absolute references such as `/assets/app.js` are unsupported in version 0.0.1. ShareSlices does not rewrite uploaded HTML.

Artifact build tools must therefore produce relative base paths. Existing output that already uses relative references needs no modification; output that contains root-absolute asset paths must be rebuilt or corrected before upload.

Version 0.0.1 renders accepted packaged HTML, JavaScript, CSS, images, fonts, and data files. Advanced Viewer isolation and browser-capability restrictions are future hardening work rather than release blockers for the first complete link-sharing flow. That exception does not apply to Gallery: Gallery remains unavailable until the deployment satisfies the Gallery security boundary defined below.

## Artifact ownership and cleanup

Signed-in users manage only artifacts they own.

An Owner can Unpublish an Artifact before its scheduled end without changing its Share link or immutable Versions. Publishing again defaults to the previously published Version, duration policy, and Share link.

An owner can permanently delete an Artifact. If it has a Pending or Listed Gallery listing, deletion explicitly warns that the listing and Gallery URL will close; if it has a previously public `administrator_removal`, the warning states that deletion ends restoration and permanently retires that URL. Confirmed deletion atomically moves those listings to Withdrawn with `artifact_deleted` before removing the Artifact's management record, Versions, Publication, and Share link and making its objects unavailable to management or new public serving. A pending Appeal of that listing removal closes as moot because deletion makes restoration impossible; an unrelated takedown or restriction case can continue when its decision still governs provenance-matching copies. A never-public `initial_policy_rejection` or `initial_governance_block` listing remains Removed and `404`, records the source-deletion event, and becomes permanently ineligible for restoration or fresh sharing because its Artifact no longer exists.

ShareSlices retains only the minimum non-public governance tombstone plus evidence snapshots and objects held by an accepted governance case until the case and every accepted Appeal are terminal, every applicable snapshotted Appeal deadline has passed, and the approved governance-retention deadline has passed. A case with no appealable decision has no Appeal-deadline condition. It also retains committed source objects referenced by an accepted Save-a-copy job until every referencing job reaches a proven terminal state, and committed Version objects covered by an already authorized bounded Download lease until the stream finishes, aborts, or reaches its maximum duration. These retained objects are available only to authorized governance, internal job processing, or the already authorized Download and are deleted when their last hold ends. Deletion is unavailable while the Artifact is accepted or processing, and independently owned copies remain available. Version pruning without deleting the Artifact remains future work.

## Public sharing model

Anyone with the Share link can view the Artifact while it has a current accessible Publication. Password protection, private links, access keys, restricted sharing, allowlists, organizations, teams, and workspaces are roadmap product work.

Owner and Viewer are contextual roles, not separate account types. A person who follows a share link is treated as a Viewer even when the same browser is signed in as that artifact's owner. A share-link visit never implicitly reveals unpublished content; an owner starts Preview explicitly from the authenticated management surface.

Preview uses the owner's current signed-in management session to render one ready Version without changing publication state. Version 0.0.1 does not create a separate Preview session, grant, expiry, or shareable Preview link.

Preview and accessible Viewer content provide controls to enter and exit full-screen mode. Full-screen mode changes only how the effective Version is displayed: it does not select another Version, change Publication state, or grant access. The user can exit with the visible control or the browser's Escape behavior; leaving full-screen mode from a content page keeps that page open.

An eligible Artifact grid card provides a full-screen control for its latest ready Version. It enters full-screen Preview directly from the management page without replacing the card's existing Preview navigation. Leaving that full-screen Preview returns the Owner to the unchanged management page. List rows, selection mode, and non-content Viewer status pages do not provide this control.

The Artifact grid card may show an Artifact thumbnail for its latest ready Version. Thumbnail generation is asynchronous and does not delay ready state, Preview, Publish, or external access; while a thumbnail is unavailable or after generation fails, the card shows a neutral placeholder. A thumbnail summarizes Version content for the Owner and does not indicate which Version is currently published. The first thumbnail UI is limited to grid cards; list and detail surfaces do not show thumbnails.

An Artifact has no Share link before its first Publish. It then has at most one non-retired Share link. An Owner may explicitly replace that link only while publishing; replacement requires confirmation, creates a new link, and permanently retires the previous link. Existing links created before this policy remain reserved for their Artifact and are reused on its next Publish.

The Web presents `Not shared`, `Link active`, `Expired`, and `Link stopped` as distinct Link sharing statuses. They project the existing backend and CLI Publication lifecycle and schedule statuses `Not published`, `Published`, `Expired`, and `Unpublished`. A Public-sharing restriction is an independent effective-access projection: it does not rewrite the underlying status, and the Web presents a separate `Restricted` notice when it blocks access. The first version does not expose Publication history, but the backend retains the records needed for consistency and audit.

The Owner uses Manage link to view and copy the Share link, change its future end time, make it permanent, Stop sharing link, or enter the distinct Share with link flow to select another ready Version. Share with link remains available while the link is active and reactivates an Expired or Link stopped resource without changing the stable link unless the Owner explicitly confirms replacement. Setting a past or current end time is invalid; the underlying Unpublish transition remains the CLI-compatible way to stop access immediately. When no Publication is accessible, Manage link continues to show the stable link and its status but disables copying until the Owner shares with the link again.

While an Artifact takedown or Public-sharing restriction blocks effective access, the Web keeps the underlying Link sharing status visible beside the `Restricted` notice, disables Copy link and any operation that would start, extend, or move public sharing to another Version, and continues to allow read-only management and Stop sharing link. Clearing the last restriction or reversing the last takedown resumes a preserved Publication only while its schedule is still active and resumes an existing Listed committed revision only when no other effective-access block remains. It never recreates a Withdrawn, Removed, Expired, Link stopped, or deleted resource.

Viewer HTML routes represent known link state as follows:

- A link with an accessible Publication returns Artifact content with `200`.
- A link whose last Publication expired or was Unpublished returns a `200` status page explaining that content is unavailable and provides a generic route back to ShareSlices management.
- A retired link returns a `410` status page explaining that the link is no longer available.
- An unknown link returns `404`.

Non-content status pages do not expose the artifact name, owner, or historical content and are excluded from search indexing. Signed-in owners can preview ready versions without changing publication state.

Version 0.0.1 Viewer and Preview responses are not cached so Publish and Unpublish state changes are visible immediately.

## Gallery community

Gallery is ShareSlices' public community surface and the Web homepage for discovering Artifacts that Creators intentionally list. While Gallery is enabled and deployment-eligible, anyone can open the canonical `/` Gallery index, an eligible `/gallery/{opaqueSlug}` listing, or a `/creators/{opaqueSlug}` profile without signing in, and Gallery navigation remains visible before and after sign-in. The former `/gallery` index and root query-selected account-entry addresses are not supported or redirected. When Gallery is unavailable, the Web does not present it as an available destination and `/` plus every direct public Gallery route follows the generic `503` contract. `/artifacts` remains the authenticated personal management surface.

Gallery follows the same desktop-browser product boundary as the rest of the ShareSlices Web experience. Unsupported mobile and tablet clients receive an explicit unsupported message rather than an implied responsive-playback promise.

### Gallery listing lifecycle

A Gallery listing is independent from the Artifact's Publication and Share link. It directly authorizes one fixed ready Version for Gallery access, so Share to Gallery never creates or changes link availability and Stop sharing link never changes Gallery availability.

An Artifact has at most one open Gallery listing, meaning Pending or Listed. Share to Gallery uses the latest ready Version in the Web confirmation flow; the API and CLI can explicitly select a historical ready Version. The Web first-share flow requires one concise confirmation, defaults the public title from the Owner-facing Artifact name, uses an empty description and no tags, and does not ask the Owner to edit Version, Creator, or Gallery metadata. The confirmation states in one sentence that anyone can view, download, and save a copy of the Artifact in Gallery and that its Share link will not change; invoking its Share to Gallery action explicitly accepts the exact current Gallery permission grant. An accepted submission closes the confirmation and receives a brief `Submitted to Gallery` acknowledgement, but acceptance does not mean the listing is public. The authenticated management shell confirms the later Server result: it shows a persistent `Now live in Gallery` Alert with a Gallery link only when the listing is Listed, effectively accessible, and has a public URL; Reviewing or terminal non-public results instead receive a persistent management Alert, while an ordinary Pending Clear result stays quiet. Explicit clients may supply an optional description and zero through five tags. A User's first Share to Gallery initializes the public Creator display name from the signed-in non-email account name unless a Creator profile already exists; ShareSlices never derives or publishes that name from an email address.

Each listing records the accepted permission-grant version, acceptance time, accepting User, fixed Version, Creator, Gallery metadata, and an opaque stable Gallery listing URL. The grant is one fixed product permission bundle covering View, Gallery download, and Save a copy; the first release offers no per-listing permission switches or Creator-selected license. Updating to another ready Version requires a new grant confirmation. A later grant-text revision does not silently rewrite an existing acceptance, although ShareSlices may require acceptance before the next Share to Gallery or Update Gallery proposal, including a metadata-only update. Gallery view, Withdraw from Gallery, and accepted-operation recovery never require renewed grant acceptance. If no current grant is configured, read-only Gallery management still returns any listing and historical acceptance evidence, but Share to Gallery and Update Gallery fail before mutation with a stable no-current-grant result; clients never fabricate terms or ask the User to accept missing text.

The listing lifecycle is Pending while it has no committed public revision and Listed after the first proposal is promoted. Creator withdrawal closes a Pending or Listed listing as Withdrawn with `creator_withdrawal`. Artifact or account deletion moves a Pending, Listed, or previously public `administrator_removal` listing to Withdrawn with `artifact_deleted` or `account_deleted`; a never-public Removed listing instead remains Removed, records the source-deletion event, and stays `404`. Initial policy rejection, initial governance block, and Administrator removal close a listing as Removed with `initial_policy_rejection`, `initial_governance_block`, or `administrator_removal`. The current closure reason is populated only in a terminal state. Every lifecycle transition uses the listing revision: competing closures from the same base state serialize, the first commit advances the revision, and a loser cannot overwrite lifecycle, closure reason, or public response. The explicit later Artifact- or account-deletion conversion of a previously public `administrator_removal` remains the only terminal-state override. Every close and restore appends immutable lifecycle history; an allowed restoration clears the current closure-reason projection when it returns the listing to Listed, and a later closure sets a new current reason without erasing history. Clear, Reviewing, and Restricted form a separate listing-level review projection: an active direct Artifact takedown contributes Reviewing and blocks effective access, while an Artifact-level Public-sharing restriction takes precedence as Restricted rather than creating a second restriction authority. A report can move a Listed item to Reviewing without hiding it; a credible high-risk signal can apply the Artifact-level restriction and block public access while review continues.

Share to Gallery does not wait for Gallery cover generation. A neutral placeholder appears until the fixed Version's cover is ready, and cover failure does not change the listing lifecycle. Gallery cards never execute Artifact content.

Share to Gallery and Update Gallery first create a non-public candidate revision for the selected Version, metadata, permission evidence, and safety result. An initial suspicious candidate keeps the listing Pending and Reviewing. Initial policy rejection closes the never-public listing as Removed, provides a correction path, and permits a later fresh share to pass normal checks; it is not an Appeal and never restores or reuses the rejected slug. An initial governance block also closes the listing as Removed but permits a fresh share only after the takedown or restriction is reversed or cleared and no decision remains in force. When a Listed item receives a suspicious update, the current committed revision remains Listed and continues serving only while its effective access remains eligible. Accepting the proposal atomically promotes it; rejecting it leaves the current revision unchanged. A clear policy violation never replaces the current revision.

Update Gallery changes the fixed Version and editable metadata only through atomic proposal promotion while preserving listing identity, URL, creation time, and internal aggregates. A failed, rejected, or pending proposal leaves the previous committed revision intact. Viewer requests continue receiving that revision only while the listing remains publicly eligible. An active Public-sharing restriction, Artifact takedown, Administrator Removal still in force, or unresolved Appeal blocks both submission and promotion. If a governance block begins while an update is open, ShareSlices closes the proposal without changing the committed revision. The Creator may submit a fresh update only after the block is reversed or cleared and no governing decision remains in force, and a passing content check cannot clear an independent Reviewing or Restricted state. Listing revisions prevent concurrent management requests from silently overwriting one another.

Withdraw from Gallery removes the listing from discovery immediately and permanently retires its URL. The retired URL returns a generic `410` response that exposes no title, Creator, Version, or historical content. Sharing the Artifact to Gallery later creates a new listing and URL, requires a new permission grant, and does not inherit listing identity, URL, or counters from the withdrawn listing; the Creator profile remains the same.

Public response precedence is deterministic. If Gallery is disabled or deployment eligibility is absent, every Gallery index, Creator-profile, listing, interaction, and content route fails before resource resolution with generic `503`. Otherwise, every Withdrawn URL returns generic `410` across listing-scoped routes, including closure by Artifact or account deletion, even if a temporary governance block also exists. An effectively accessible Listed revision returns `200`; unknown, Pending, Restricted, taken-down, otherwise temporarily inaccessible, and Removed listings return generic `404`. These responses expose no listing, Creator, closure, or governance metadata. Mobile and tablet unsupported handling runs only after this availability and resource-state decision for an otherwise accessible route.

The Artifact management card and detail page keep Share with link and Share to Gallery as separate controls. The detail page uses complete labeled buttons, and cards retain separate actions instead of a generic Share menu. Pending and Listed resources use Manage Gallery with state-valid actions. Withdrawn resources use Share to Gallery when the Artifact remains eligible. Removed resources show governance and Appeal state while a decision remains in force or an Appeal is pending. After an initial policy rejection is corrected, or an initial governance block is fully cleared or reversed, the eligible Artifact can use Share to Gallery for a new listing and slug. After a previously public `administrator_removal` is reversed but the old listing has not been restored, a replacement share requires an explicit irreversible warning that the new listing permanently forfeits restoration of the old URL, identity, and counters; if replacement wins, the old listing remains non-public forever.

### Public discovery and Creator identity

Gallery cards show only the static Gallery cover, public title, Creator display name, tags, and immutable listing creation time. Opening a card loads a trusted metadata page whose Artifact player embeds the fixed Version from the Untrusted-content origin and supports trusted Full screen controls.

Gallery provides platform-curated Featured results, deterministic Newest results, case-insensitive search over title, description, tags, and Creator display name, and exact tag filtering. Featured uses an administrator-defined position plus a stable listing-identity tie-breaker. Newest, the default index, search, tag, and Creator collections order by immutable listing creation time descending plus stable listing identity; search does not use a changing relevance or engagement score. Public list APIs use stable cursor pagination. Version 1 does not use views, downloads, copies, or other engagement signals for automatic ranking.

Each User has at most one Creator profile. The first Gallery share stages it when none exists, and the first successful listing promotion makes it public. Profile staging and edits use a profile revision: concurrent first shares with the same normalized confirmed fields may reuse the one staged profile, while different confirmed fields produce a revision conflict before another profile or listing proposal is created. A Pending or rejected initial proposal does not expose the profile, and editing a staged profile updates no public or search projection. Once public, the profile remains available with an empty listing collection when it has no publicly eligible listings. An unknown, staged, or account-deleted profile returns generic `404`; a public profile returns `200`; Gallery disablement or ineligibility returns pre-lookup `503`. The Creator explicitly confirms a non-unique public display name and may add an optional platform-managed avatar and biography. A signed-in Creator can later update those fields without changing listing identity. ShareSlices may prefill a non-email profile value for confirmation but never derives a public name from email. The profile uses a system-generated opaque identifier and lists only publicly eligible Listed Gallery revisions. It never reveals email, sign-in identifiers, credentials, or private Artifact management information.

Listing titles, descriptions, tags, Creator display names, and biographies are bounded plain text. Trusted Gallery pages escape them and never interpret them as HTML, Markdown, or executable URLs. Avatar content is a platform-managed safe raster image or a neutral placeholder; a Creator cannot make trusted pages load a remote tracking URL or executable SVG.

Once reporting, takedown, and administration are operational, search engines may index Gallery indexes, Creator profiles, and trusted listing metadata pages. Artifact content responses remain excluded from indexing, and public search results point to the trusted Gallery listing page.

The first Gallery release exposes View, Full screen, Save a copy, Download, and Report. The trusted API records one listing-scoped non-identifying view when it atomically authorizes and issues a new player authorization, one download when Download is authorized, and one copy when a saved copy becomes ready. Reusing that player authorization or requesting its assets does not count another view, and the content-only runtime writes no aggregate. Updating a listing preserves those aggregates; a new listing after withdrawal starts from zero. ShareSlices does not display public counters or use them for ranking.

### Save a copy and Download

Save a copy requires sign-in. Before consuming the account rate limit or reserving quota, acceptance atomically verifies a publicly eligible current Listed revision; an inaccessible source follows the generic public response and creates no job, source reference, rate-limit charge, quota reservation, or existence signal. One successful acceptance transaction binds that listing revision and fixed Version, consumes the rate-limit unit, reserves the Copier's quota, acquires one durable source-retention reference, and starts an asynchronous Server operation whose accepted, processing, ready, failed, cancelled, and indeterminate outcomes preserve known resources honestly. Source deletion that wins first leaves no accepted operation or reference; acceptance that wins first retains the fixed source objects for the job. Success creates an independently owned Artifact, Version, and Content bundle inside the Copier's ownership boundary; it does not reuse the Creator's Content bundle, and it neither shares with a link nor enters Gallery automatically.

The new Artifact name defaults to the Gallery title, may be changed before confirmation or later, and need not be unique. A Copier may intentionally save the same listing more than once with different idempotency keys. New copy operations are rate-limited per Copier account in addition to Artifact and storage quotas, which are checked and reserved before acceptance. Replaying the same accepted key and input through authenticated operation recovery returns the original operation even if the source later closes or Gallery becomes unavailable; it grants no new source access and consumes no additional rate-limit unit or reservation. A new or unknown-key request still follows the current public listing response, and reusing an accepted key for different input is a conflict. Ready commit converts the reservation to usage, proven failure or cancellation releases it after cleanup, and an indeterminate result holds it until reconciliation proves a terminal outcome. The original Creator does not pay storage or product quota for other Users' copies.

Source attribution stores the immediate source listing and Version and preserves the root source listing, root Version, and original Creator across copy generations. A copied Artifact shared to Gallery presents the current Creator and states that it is based on the original Creator; public responses never expose private lineage identifiers. The attribution cannot be removed through ordinary Artifact management.

After acceptance, source updates, Creator withdrawal, source Artifact deletion, and deletion of a distinct source Creator account do not cancel the fixed copy snapshot. If the source Creator and Copier are the same account, Copier-account deletion takes precedence so processing cannot create an ownerless copy. Acceptance holds one durable source-retention reference; ready, failed, or cancelled terminal reconciliation releases it exactly once, and the last release resumes deletion of retained source objects. An Administrator Removal, Artifact takedown, Public-sharing restriction, Gallery disablement, deployment ineligibility, or Copier-account deletion that wins a race before ready commit cancels the job, cleans partial destination objects, and releases its quota reservation and source reference. If ready commit wins before Copier-account deletion, ordinary account-deletion cleanup includes the newly committed copy; if it wins before content governance, the independent copy completes and content-level governance can reach it through immutable provenance. Completed copies otherwise remain independent from source lifecycle changes. The retired source URL becomes unavailable for future copies and downloads. If the original Creator account is deleted, its listings close and profile disappears while copies retain the neutral attribution `Original Creator unavailable` without retaining account or email data.

Gallery download is available without sign-in and returns a normalized ZIP of exactly the fixed Version's Artifact files. It does not return the original upload archive or inject an attribution file into executable content. The trusted listing page and response metadata present the source and permission information.

Each download checks the complete effective-access state, fixes the immutable Version, and acquires a bounded source-read lease when the request begins. Withdrawal, Removal, Public-sharing restriction, Artifact takedown, Artifact or account deletion, or lost deployment eligibility blocks new downloads but does not revoke a completed download or interrupt an already authorized stream. The lease keeps only that Version's committed objects readable to the stream until it finishes, aborts, or reaches the maximum duration, then releases exactly once so deletion cleanup can continue. Anonymous downloads are rate-limited independently from Creator quotas.

### Gallery security and deployment eligibility

Gallery is disabled by default. A deployment can enable it only after configuration validation proves that the actual Web, API, Untrusted-content, cookie, and network topology provides the required isolation and that the permission terms, report flow, administrators, and governance operations are available. The same shared eligibility gate consumes live health for every required capability; losing one at runtime makes public Gallery routes fail pre-lookup with `503` without waiting for redeployment, and recovery resumes them only after every gate is healthy again. A force-enable flag cannot override an ineligible topology or capability. While Gallery is disabled or ineligible, authenticated Owners can still inspect listing state and permanently withdraw an existing Pending or Listed listing. Administration, notifications, and Appeals are not disabled merely because public Gallery is unavailable, but each remains usable only while its own trusted dependencies are operational; otherwise its API returns a stable unavailable result and Gallery stays disabled. Share to Gallery, Update Gallery, public report intake, discovery, interactions, and content serving remain unavailable.

Artifact content executes only through a dedicated Untrusted-content serving boundary outside the management Origin and credential boundary and on a different browser registrable site from the Web and API. That boundary cannot expose management operations or receive management credentials or mutation authority; ADR 0008 and the architecture design own its runtime shape. This registrable-site boundary is the domain boundary browsers use for site-wide cookies and same-site decisions; another port or a sibling subdomain is insufficient even when current management cookies are host-only. Same-origin and shared-host compatibility deployments are not Gallery-eligible. Trusted Gallery metadata, controls, authorization decisions, and management operations never execute inside Artifact content.

Gallery Artifacts must remain self-contained. Their browser responses permit requests without management credentials only for manifest-backed files under the same revision-scoped player or case-bound review authorization, including packaged module scripts and relative `fetch` requests. Content Security Policy and the Untrusted-content serving boundary block every external network target. Authorization, entry, and asset responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; player and review credentials are redacted from access, error, and header logs. The embedded player uses an opaque sandbox origin that permits scripts but not `allow-same-origin`, persistent storage, Service Workers, popups, top-level navigation, forms, automatic downloads, Artifact-initiated Full screen, clipboard access, camera, microphone, location, or other powerful capabilities. The same response-side restrictions apply when a content URL is opened outside the iframe. A trusted parent control uses its own Viewer activation to request Full screen for the player; trusted controls also own Download, Save a copy, Report, and navigation.

Before a listing becomes public, deterministic Gallery safety checks run a checked, versioned policy against the immutable candidate in addition to ordinary Artifact validation. The result records stable findings, reason codes, evidence, and a pass, reject, or review mapping; a later policy revision does not rewrite old evidence. Ordinary content proceeds without prior human approval, clear policy violations are rejected, and suspicious content remains Pending and Reviewing until an Administrator decides it. These checks reduce known risk but do not claim to prove that arbitrary HTML or JavaScript is harmless.

### Reports, moderation, and takedown

Signed-in and anonymous Viewers can report only a publicly accessible Listed current revision. Acceptance atomically binds its listing revision and fixed Version and creates the minimum private evidence snapshot and retention hold required to review the case after source update or deletion; a concurrent closure or restriction that wins first rejects the report without revealing listing state. Anonymous reporting uses a challenge and rate limit. Reports identify malicious code or phishing, copyright, privacy or personal data, illegal content, spam, or another explained concern and require enough detail for review.

Administrators receive a minimal auditable review queue containing the report, listing, fixed Version, Creator, Source attribution, and prior decisions. Executable review of non-public or suspicious candidate content uses a separate case-bound Gallery review authorization through the isolated Untrusted-content boundary, never the trusted administration Origin; if isolated review is unavailable, the queue shows static evidence and explicit preview unavailability. Administrators can dismiss a report, Remove a lifecycle-Listed listing with a committed revision from Gallery, apply or clear a Public-sharing restriction, perform or reverse Artifact takedown, restore an eligible platform-removed listing, and decide an Appeal. Remove from Gallery cannot overwrite Pending, Withdrawn, already Removed, or never-public lifecycle state. Restoration applies only to a listing that an Administrator removed after it had a committed public revision and whose decision is no longer in force. Reversing the removal decision succeeds independently; if another block prevents restoration, the listing remains non-public and restorable until a later explicit restoration or confirmed replacement. An initial policy or governance block, Creator withdrawal, Artifact deletion, or account deletion can never restore its old listing or URL. A restoration transaction must still satisfy the one-open-listing constraint; if the Creator has already created an eligible replacement after the governing block was reversed or cleared, the older Removed listing and URL cannot be restored.

Remove from Gallery closes only the listing. Artifact takedown is a separate action for serious safety, legal, or rights issues and blocks both Gallery and Share-link public access while preserving Owner management state and the evidence required for review. It does not silently delete the Artifact or suspend the whole account.

Creator withdrawal never affects completed saved copies. When a platform takedown concerns the content itself, direct and descendant Gallery-saved copies whose immutable copy provenance matches the governed source enter review and receive an Artifact-level Public-sharing restriction tied to that source decision. ShareSlices does not treat unrelated uploads as matches, expose the matching function as a content-existence oracle, or delete private management resources. A later independently uploaded Version remains reviewable through the affected Artifact rather than clearing the restriction automatically. If the source decision is reversed, ShareSlices closes only the propagated restriction bases derived from that decision, resolves Appeals that challenge those bases as reversed or moot, recomputes each affected copy, and preserves every unrelated report, takedown, restriction, and Appeal. The exact legal execution and retention policy remains subject to the applicable operating jurisdiction.

The affected Creator receives listing-Removal decisions, while the affected Artifact Owner receives Artifact takedown and Public-sharing-restriction decisions, even when that Owner has never published the saved copy. Each appealable decision atomically snapshots the approved Gallery Appeal policy version and a Server-time deadline; a later policy revision applies only to later decisions. Each affected party receives the applicable category, rule, effect, Appeal path, and deadline without reporter identity. ShareSlices accepts an Appeal only while the challenged decision remains active and in force and its snapshotted Appeal window is open; acceptance serializes with reversal, same-key retry returns the existing Appeal, and duplicate, late, or post-reversal submission changes no access state. If a direct reversal follows an accepted Appeal, the reversal atomically resolves that Appeal as reversed or moot and recomputes every dependent access, restoration, and replacement block. While the governing Removal or restriction remains in force or an Appeal remains pending, a Removed listing cannot be restored or replaced and a restricted Artifact cannot publicly share any Version. Featured eligibility requires a publicly eligible Listed revision. Ineligibility removes the Featured placement through an audited transition, and later clearance does not feature the listing again automatically. The first version has no paid placement.

Creators receive immediate results for Share to Gallery, Update Gallery, and Withdraw from Gallery. ShareSlices sends durable in-product notifications to the affected Creator for Administrator Removal and to the affected Artifact Owner for Takedown, Restriction, and related Appeal events. Asynchronous initial policy rejection also creates a durable result and notification with a correction path but no Appeal. Governance reports, Appeal explanations, decision rationales, and notifications are bounded escaped plain text: trusted surfaces do not execute markup, create links from submitted text, or load submitted remote resources. Email delivery is outside the first release, and ShareSlices does not send one notification for every view, copy, or download.

Gallery does not create public Viewer identities or permanent browsing histories. Raw pseudonymous signals needed for rate limiting and abuse investigation are retained for at most 30 days before deletion or aggregation; longer-lived aggregates do not identify individual Viewers.

### Gallery clients, migration, and scope

The Web owns public Gallery browsing, Creator profile management and viewing, Save a copy, Download, Report, and Gallery administration. The CLI and official Skill support owner-side `artifact gallery view`, `artifact gallery share`, `artifact gallery update`, and `artifact gallery withdraw` operations through versioned Agent protocol capabilities; a first Gallery share can supply the required Creator display name, but the first release does not add a separate CLI profile editor or public browse, copy, download, or report commands. Gallery view returns current grant text only when a current grant exists; otherwise it reports stable unavailability while preserving any listing and historical accepted-grant evidence. An idempotent replay of an already accepted Gallery share, update, or withdrawal remains a read-only recovery of that operation result during a later governance block or Gallery outage, not admission of a new mutation.

Existing Artifacts and Share links remain unlisted when Gallery is introduced. ShareSlices does not create Gallery listings or Creator profiles automatically and does not change any existing Publication, Share link, or Link sharing status.

The first Gallery release excludes mobile adaptation, likes, comments, follows, collections, private messages, algorithmic recommendations, paid promotion, custom license selection, organization Gallery, private Gallery, batch Share to Gallery, and restoration of a withdrawn listing.

## Reliability expectations

ShareSlices must tolerate client retries, network interruption, service restarts, and background worker crashes without creating duplicate versions, exposing partial files, or moving a share link to invalid content.

Account sign up, sign in, linking, and recovery flows must tolerate repeated submissions, provider callback replay, and concurrent attempts without creating duplicate users or binding an authentication method to the wrong user.

Upload and publish requests should be idempotent when the caller repeats the same operation with the same idempotency key.

Gallery share, update, withdraw, and Save a copy requests must also be idempotent. Each accepted key stores its normalized target and input; reusing it for different input returns a conflict without another mutation. Recovery returns the immutable accepted-operation outcome separately from the resource's current lifecycle, effective access, and URL projection, so a later closure or restriction is never shown as still active merely because the original operation succeeded. The Server enforces at most one open Gallery listing per Artifact, uses listing revision checks for concurrent updates and restoration, and never reports a new listing, promoted revision, Version, or copy until that durable resource is confirmed. Repeating a copy request with the same key and input does not consume another account rate-limit unit or quota reservation.

Processing can be asynchronous and at-least-once. Repeated processing attempts must either produce the same ready version or stop in a recoverable failed state.

Thumbnail generation is a separate non-blocking background lifecycle. It uses only committed Version content, never accesses external networks, retries transient failures a bounded number of times, and may end in a terminal failure without changing Version or Publication state.

Publishing is atomic: the Share link keeps showing the previous published Version until the selected Version, Publication duration, and retained or replacement link are committed successfully.

Updating Gallery is atomic: the listing keeps the previous fixed Version committed while a non-public update proposal is checked, serves it only while effective access remains eligible, and replaces it only when the new Version, metadata, permission acceptance, and listing revision commit together. A rejected proposal leaves the current revision unchanged. Withdrawing a listing atomically removes it from discovery, ends Gallery authorization, retires its URL, and closes any pending proposal. Save-a-copy processing is recoverable and must never expose a partial cross-User Content bundle.

Partial uploads, expired sessions, abandoned staging files, and expired processing leases must be recoverable through reconciliation instead of leaving the artifact permanently stuck.
