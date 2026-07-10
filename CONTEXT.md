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
An immutable content snapshot created after ShareSlices validates and expands an uploaded artifact.
_Avoid_: Upload, build, revision

**Publication**:
The current pointer from an artifact to the version viewers should see.
_Avoid_: Deployment, release

**Preview**:
An owner-only rendering of one ready version before publication. It does not change publication state or make content available through the share link.
_Avoid_: Private share, draft publication

**Share link**:
An address that resolves an artifact according to the link lifecycle and the artifact's publication state. A link can be active, expired, or retired.
_Avoid_: Version link, upload link

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
