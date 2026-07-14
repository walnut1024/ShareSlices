# ShareSlices Context

ShareSlices turns local static web artifacts created by agents into stable public links. This glossary keeps product language precise while implementation details live in design docs and code.

## Language

**Artifact**:
The stable product object for one shareable static web artifact. It owns versions, publication state, and share links.
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

**Content bundle**:
An internal immutable set of validated and normalized Artifact files that one or more Versions owned by the same User may reference.
_Avoid_: Version, ZIP, shared Artifact

**Artifact thumbnail**:
The owner-facing visual summary of an artifact's latest ready version. It does not represent the version selected by the current publication.
_Avoid_: Publication thumbnail, share-link preview

**Upload**:
The user action that sends local Artifact content to ShareSlices, either as a new Artifact or as a new Version of an existing Artifact. Upload does not make content available to Viewers.
_Avoid_: Create, Publish, deploy

**Publish**:
The Owner action that makes a selected ready Version available to Viewers for a chosen duration. The first Publish creates the Share link; a later Publish reuses that link unless the Owner explicitly replaces it.
_Avoid_: Share, deploy, release

**Publication**:
The time-bounded state that makes one Version of an Artifact available to Viewers. It owns when that external availability ends.
_Avoid_: Deployment, release

**Publication status**:
The Owner-facing classification of an Artifact's external availability: Not published when it has never been published, Published while its current Publication is available, Expired after a scheduled end, and Unpublished after the Owner ends it early.
_Avoid_: Artifact status, Share-link status

**Unpublish**:
The Owner action that ends an Artifact's current Publication before its scheduled end without replacing its Share link.
_Avoid_: Delete, revoke link

**Preview**:
An owner-only rendering of one ready version before publication. It does not change publication state or make content available through the share link.
_Avoid_: Private share, draft publication

**Share link**:
The stable address through which Viewers reach an Artifact's current Publication. The address remains identifiable when no Publication is active and changes only when the Owner explicitly replaces it.
_Avoid_: Version link, upload link

**Replace share link**:
The Owner choice during Publish that permanently retires the previous Share link and creates a new one.
_Avoid_: Add link, link alias

**User**:
The account holder who signs in to ShareSlices.
_Avoid_: Owner when talking about account identity

**Owner**:
The role a user has while managing an artifact they own through authenticated management surfaces.
_Avoid_: Account, identity

**Viewer**:
A person who opens a share link, including an artifact owner when that owner follows the share link.
_Avoid_: Visitor, reader

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
A roadmap administrative actor who manages user account state.
_Avoid_: Owner

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
