# ShareSlices Context

ShareSlices turns local static web artifacts created by agents into stable public links and discoverable Gallery listings. This glossary keeps product language precise while implementation details live in design docs and code.

## Language

**Artifact**:
The stable product object for one shareable static web artifact. It owns Versions, link-sharing state, Share links, and Gallery listings.
_Avoid_: Upload, site, project

**Artifact name**:
The mutable owner-facing label used to identify an artifact in management surfaces. It does not determine identity or the share link.
_Avoid_: ZIP filename, share slug

**Share slug**:
The server-generated public path segment that identifies one share link.
_Avoid_: Artifact ID, artifact slug

**Entry file**:
The HTML file ShareSlices opens first when rendering an artifact.
_Avoid_: Homepage, main file

**Slice deck**:
A keynote-style static web artifact whose content is organized as sequential slices.
_Avoid_: Slideshow, presentation file

**Version**:
An immutable Artifact history record that identifies one validated and normalized content snapshot.
_Avoid_: Upload, build, revision

**Artifact thumbnail**:
The owner-facing visual summary of an artifact's latest ready version. It does not represent the version selected by the current publication.
_Avoid_: Publication thumbnail, share-link preview

**Upload**:
The user action that sends local Artifact content to ShareSlices, either as a new Artifact or as a new Version of an existing Artifact. Upload does not make content available to Viewers.
_Avoid_: Create, Publish, deploy

**Share with link**:
The Owner-facing action that makes a selected ready Version available through the Artifact's Share link for a chosen duration without adding it to Gallery.
_Avoid_: Share to Gallery, generic Share

**Publish**:
The domain transition behind Share with link that creates or replaces a Publication for a selected ready Version.
_Avoid_: Share to Gallery, Gallery listing

**Publication**:
The time-bounded state that makes one Version of an Artifact available through its Share link. It does not control Gallery availability.
_Avoid_: Gallery listing, deployment, release

**Publication status**:
The domain and CLI classification of an Artifact's Publication lifecycle and schedule: Not published, Published, Expired, or Unpublished. A Public-sharing restriction can separately block effective access without rewriting this status. The Web presents the same lifecycle facts through Link sharing status.
_Avoid_: Link sharing status in Web, Gallery listing status

**Link sharing status**:
The Web projection of an Artifact's Publication lifecycle and schedule: Not shared, Link active, Expired, or Link stopped. A separate Public-sharing restriction notice identifies when effective access is blocked.
_Avoid_: Publication status in Web, Gallery listing status

**Manage link**:
The Owner-facing action for viewing and copying an Artifact's Share link, changing its future end, stopping link sharing, or entering the distinct Share with link flow to select another ready Version.
_Avoid_: Manage Gallery, Publish

**Stop sharing link**:
The Owner-facing action that ends an Artifact's current link availability before its scheduled end without replacing its Share link or changing Gallery availability.
_Avoid_: Withdraw from Gallery, Delete, revoke link

**Unpublish**:
The domain and CLI transition behind Stop sharing link that ends the current Publication early.
_Avoid_: Withdraw from Gallery, Delete

**Preview**:
An owner-only rendering of one ready Version. It does not change Publication or Gallery listing state or make content publicly available.
_Avoid_: Private share, draft publication

**Share link**:
The stable address through which Viewers reach an Artifact's current Publication. The address remains identifiable when no Publication is active and changes only when the Owner explicitly replaces it.
_Avoid_: Gallery listing URL, Version link, upload link

**Replace share link**:
The Owner choice during Share with link that permanently retires the previous Share link and creates a new one.
_Avoid_: Add link, link alias

**Gallery**:
The public discovery surface where anyone can browse publicly eligible Listed Gallery revisions without first receiving a Share link.
_Avoid_: Artifact dashboard, Share-link directory

**Gallery listing**:
A record that can authorize Gallery access to one current fixed ready Version and its Gallery metadata. Its current committed revision can be public, while proposals and closed state remain non-public; the listing is independent of the Artifact's Publication and Share link.
_Avoid_: Publication, Gallery post, Share link

**Gallery update proposal**:
A non-public candidate Version, Gallery metadata, and permission acceptance awaiting safety checks or review before it can atomically replace a Gallery listing's current revision.
_Avoid_: Gallery listing, automatic update, draft Publication

**Gallery listing URL**:
The stable address reserved for one Gallery listing and identified by an opaque slug. ShareSlices exposes it only for a Listed revision; accepted updates preserve it, while a Withdrawn closure permanently retires it.
_Avoid_: Share link, Artifact URL, Version URL

**Gallery listing status**:
The lifecycle classification of a Gallery listing: Pending while it has no committed public revision, Listed after its first proposal is promoted, Withdrawn after Creator withdrawal or after Artifact or account deletion closes a Pending, Listed, or previously public Administrator-removed listing, and Removed after an initial policy rejection, initial governance block, or Administrator removal. Artifact or account deletion leaves a never-public Removed listing Removed and records the source-deletion event. Gallery review status and effective access separately determine whether a Listed revision is currently public.
_Avoid_: Publication status, Artifact status

**Gallery closure reason**:
The nullable current-terminal projection explaining why a Gallery listing is Withdrawn or Removed. It is cleared from the current projection when an allowed restoration returns the listing to Listed, while immutable lifecycle history preserves every close and restore event; `PRODUCT.md` owns the transition-to-reason mapping.
_Avoid_: Gallery listing status, Gallery review status

**Gallery review status**:
The listing-level governance projection: Clear when no review basis applies, Reviewing while a concern or Artifact takedown basis is evaluated and no Public-sharing restriction applies, and Restricted when an Artifact-level Public-sharing restriction blocks the listing. Effective access remains separate, so an active takedown can block a Reviewing listing.
_Avoid_: Gallery listing status, Publication status

**Gallery safety check**:
A deterministic pre-publication evaluation of one immutable candidate under a versioned Gallery safety policy. It returns pass, reject, or review evidence without claiming that arbitrary code is harmless.
_Avoid_: Artifact validation, human approval, antivirus guarantee

**Gallery safety policy**:
The checked versioned rules, input limits, stable findings, outcome mapping, evidence format, and replay behavior used by Gallery safety checks. A later policy version does not rewrite earlier evidence.
_Avoid_: Artifact validation policy, Administrator decision

**Gallery Appeal policy**:
The approved versioned rule that defines which governance decisions are appealable and the duration of their Appeal window. Each appealable decision snapshots the policy version and deadline; a later policy change affects only later decisions.
_Avoid_: Appeal decision, Gallery report policy

**Gallery metadata**:
The public title, description, tags, and Gallery cover committed by one Gallery listing revision. Creator profile fields are projected separately, and Gallery metadata remains independent of the Owner-facing Artifact name.
_Avoid_: Artifact metadata, account profile

**Gallery cover**:
The public visual summary of the fixed Version selected by a Gallery listing.
_Avoid_: Artifact thumbnail, account avatar

**Share to Gallery**:
The Owner action that creates a Gallery listing for one selected ready Version without creating or changing a Publication or Share link.
_Avoid_: Share with link, Publish

**Update Gallery**:
The Owner action that proposes a change to a governance-eligible Listed Gallery listing's selected ready Version or editable Gallery metadata while preserving the listing and its Gallery listing URL. The current revision remains committed and continues serving only while effective access stays eligible; the proposal cannot clear or bypass governance state.
_Avoid_: Upload, Publish, automatic update

**Manage Gallery**:
The Owner-facing action for inspecting a Pending or Listed Gallery listing and invoking only its currently allowed update or withdrawal operations.
_Avoid_: Share to Gallery, Manage link

**Withdraw from Gallery**:
The Creator action that permanently closes a Pending or Listed Gallery listing and retires its URL without changing the Artifact's Publication or Share link.
_Avoid_: Unpublish, Delete, Remove from Gallery

**Remove from Gallery**:
The platform-governance action that closes a lifecycle-Listed Gallery listing with a committed revision independently of Creator withdrawal.
_Avoid_: Withdraw from Gallery, Unpublish, Delete

**Gallery permission grant**:
The versioned permission a Creator accepts for one Gallery listing and fixed Version so others may view, download, and save independent copies.
_Avoid_: Ownership transfer, account permission

**Save a copy**:
The signed-in User action that creates an independently owned Artifact and Version from the fixed Version in a Gallery listing. The copy is neither link-shared nor Gallery-listed automatically.
_Avoid_: Copy link, bookmark, shared Artifact

**Gallery download**:
The normalized archive of the fixed Version in a Gallery listing that a Viewer downloads. It contains the Artifact content without injected attribution files.
_Avoid_: Original upload, Export

**Source attribution**:
The immutable provenance stored for a saved copy that identifies its immediate source Gallery listing and fixed Version while preserving the root source listing and Version and original Creator across later copies. Gallery displays only the approved attribution if the copied Artifact is later listed publicly; lineage identifiers remain private.
_Avoid_: Ownership, endorsement

**Untrusted-content origin**:
The public Origin dedicated to serving Artifact content without management-session privileges.
_Avoid_: Management Origin, Gallery metadata page

**Gallery player authorization**:
A short-lived opaque authorization bound to one Gallery listing, committed listing revision, and fixed Version. The entry file and every relative asset request use the same binding without carrying management credentials or exposing storage locations.
_Avoid_: Share link, management Session, object-storage URL

**Gallery review authorization**:
A short-lived opaque authorization bound to one Administrator, governance case or proposal, and candidate Version. It renders non-public review content only through the isolated Untrusted-content boundary and grants no public listing or management authority.
_Avoid_: Gallery player authorization, management Session, public Preview link

**Gallery-eligible deployment**:
A deployment whose configured topology places the Untrusted-content origin on a separate browser site and registrable-domain boundary from the Web and API, outside every management credential boundary. A sibling subdomain, another port, or a feature flag alone is insufficient.
_Avoid_: Shared-host compatibility mode, Gallery feature flag

**Gallery report**:
A Viewer request for ShareSlices to review the publicly accessible current revision of one Gallery listing for a safety, rights, privacy, legality, or spam concern.
_Avoid_: Appeal, support request

**Artifact takedown**:
The platform-governance action that stops an Artifact's public availability through both Gallery and its Share link while preserving Owner management state and review evidence.
_Avoid_: Remove from Gallery, Withdraw from Gallery, Delete

**Public-sharing restriction**:
A governance block on an Artifact that stops effective access through its Share link and Gallery and prevents new public-expanding operations. A Gallery listing projects the block as Restricted without rewriting Publication or Gallery lifecycle records or removing the Owner's private management resource.
_Avoid_: Artifact takedown, account suspension, Delete

**Appeal**:
An affected Creator or Artifact Owner request for ShareSlices to reconsider an Administrator Removal, Artifact takedown, or Public-sharing restriction. An initial proposal rejection, whether deterministic or decided after review, is a correction flow rather than an Appeal.
_Avoid_: Gallery report, retry

**User**:
The account holder who signs in to ShareSlices.
_Avoid_: Owner when talking about account identity

**Owner**:
The role a user has while managing an artifact they own through authenticated management surfaces.
_Avoid_: Account, identity

**Creator**:
The public role a User has as the source of a Gallery listing or a saved copy's Source attribution.
_Avoid_: Owner when referring to public attribution, author identity

**Creator display name**:
The public name shown for a Creator in Gallery. It is separate from email and other sign-in identifiers.
_Avoid_: Email, username, account credential

**Creator profile**:
The public Gallery identity that presents one Creator's display name, optional profile details, and publicly eligible Listed Gallery revisions.
_Avoid_: Account profile, authentication identity

**Featured**:
The platform-curated collection of publicly eligible Listed Gallery revisions.
_Avoid_: Trending, algorithmic ranking, paid placement

**Viewer**:
A person who opens publicly shared Artifact content through a Share link or Gallery listing, including its Owner or Creator.
_Avoid_: Visitor, reader

**Agent mode**:
The explicit non-interactive CLI execution surface used by the official Skill. It returns an Outcome envelope instead of human-readable or selected-field output.
_Avoid_: JSON mode, headless mode

**Agent protocol**:
The versioned machine contract that defines Agent-mode capability discovery, operations, Outcome envelopes, and compatibility rules independently of the CLI release version.
_Avoid_: CLI version, REST API

**Outcome envelope**:
The single Agent-protocol JSON document that reports one operation's outcome, known resources, data, and any structured error, Next action, or Continuation.
_Avoid_: Command output, API response

**Next action**:
The one structured follow-up supported by current command evidence when an Agent operation cannot finish without another action or a safe continuation step.
_Avoid_: Retry permission, Server action

**Continuation**:
An opaque, non-sensitive identifier that lets a later Agent invocation check resumable authentication state. It does not store or replay business intent.
_Avoid_: Session, job, command token

**Sign-in identifier**:
A configured email address or phone number that can identify a user account during sign-in.
_Avoid_: Contact point, username

**Credential**:
A secret or possession proof used to authenticate a user, such as a password or one-time code.
_Avoid_: Identity

**Authentication proof**:
A completed provider or credential check that proves the current actor controls a sign-in method.
_Avoid_: Profile data

**External identity**:
A provider-scoped identity from Google, WeChat, enterprise SSO, or another identity provider.
_Avoid_: Social account, provider account

**Provider subject**:
The stable account identifier returned by an external identity provider, such as Google `sub` or WeChat `unionid`.
_Avoid_: Email, nickname, avatar

**Session**:
The server-side signed-in state created after successful authentication.
_Avoid_: Browser cookie

**Recovery token**:
A one-time token used to complete account recovery or password reset.
_Avoid_: Session token

**Administrator**:
An authorized platform actor who reviews Gallery governance cases, records platform decisions, and curates Featured listings; later administration work also includes User account state.
_Avoid_: Owner, Creator, moderator when the role is not separately defined

**Idempotency key**:
A caller-supplied key that lets ShareSlices collapse retried requests into one durable result.
_Avoid_: Request ID when the value is only for tracing

**Upload session**:
The durable server-side record that tracks one upload from acceptance through processing to a committed version or a terminal failure.
_Avoid_: Upload (the user action), processing job

**Lease**:
A time-limited claim that lets one worker process a job while allowing recovery after worker failure.
_Avoid_: Lock

**Reconciliation**:
A background recovery process that repairs stale states and removes abandoned storage objects.
_Avoid_: Cleanup when the process also repairs state

**Staging object**:
An internal object storage file that is not visible through a share link until version commit.
_Avoid_: Published file
