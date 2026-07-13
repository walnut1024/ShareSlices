# artifact-thumbnail Specification

## ADDED Requirements

### Requirement: Generate a non-blocking Version thumbnail

The system SHALL enqueue one independent thumbnail job after committing a ready Version. Thumbnail pending, retry, or terminal failure MUST NOT delay or change Version readiness, Preview, Publication, Share-link behavior, or processing-job completion.

#### Scenario: Version becomes ready before its thumbnail

- **WHEN** processing commits a ready Version
- **THEN** the Version is immediately available for owner actions and a separate thumbnail job is pending

#### Scenario: Thumbnail generation fails terminally

- **WHEN** all permitted attempts finish without a valid thumbnail
- **THEN** the Version remains ready and usable and the thumbnail job records a terminal failure

### Requirement: Render thumbnails in an isolated deterministic environment

The Worker SHALL render the committed Version entry in a bounded Chromium child process using a fixed `1440x900` viewport. The Worker container MUST run as a non-root user, drop all capabilities, forbid privilege escalation, and retain the runtime-default seccomp profile. Rendering MUST use only manifest-listed Version content, MUST block external network access, MUST request reduced motion and disable animation and transition, and MUST complete `load`, font readiness, and two animation frames within one 10-second deadline.

#### Scenario: Artifact requests an external resource

- **WHEN** thumbnail rendering attempts to load a resource outside the target Version manifest
- **THEN** the request is blocked and rendering continues using the page's available fallback behavior

#### Scenario: Artifact does not become render-ready

- **WHEN** the shared 10-second deadline expires before the readiness sequence completes
- **THEN** the attempt ends with a deterministic render-timeout failure

### Requirement: Restrict internal capture access

The internal render route MUST require a short-lived, single-use capture grant scoped to exactly one Version. It MUST NOT accept the grant for management APIs, another Version, or public Viewer access, and the route MUST NOT be exposed through public ingress.

#### Scenario: Capture grant is reused or targets another Version

- **WHEN** a consumed, expired, or mismatched capture grant is presented
- **THEN** the render route denies access without returning Version content

### Requirement: Store and retry immutable thumbnail output

Successful rendering SHALL produce an approximately `480x300` WebP stored as a private immutable object belonging to the Version. Classified transient failures SHALL receive no more than three automatic retries with backoff; deterministic failures MUST NOT be retried automatically. Removing the owning Version or Artifact MUST include its thumbnail object in cleanup.

#### Scenario: Transient rendering dependency fails

- **WHEN** Chromium, the internal render route, or object storage reports a classified transient failure
- **THEN** the thumbnail job is retried within the bounded policy without changing Version state

### Requirement: Authorize and cache Version thumbnail reads

The management API SHALL expose a Version-scoped thumbnail response only to the owning User and MUST stream the private stored object without exposing an object-storage URL. A successful immutable response MAY use private long-lived browser caching. A thumbnail that is pending, absent, or terminally failed SHALL remain distinguishable from an authorization failure at the API contract seam.

#### Scenario: Owner requests a generated thumbnail

- **WHEN** the owning User requests the thumbnail for a Version with completed output
- **THEN** the API streams the WebP with private immutable cache headers

#### Scenario: Another User requests the thumbnail

- **WHEN** a signed-in User requests a Version they do not own
- **THEN** the API returns the same not-found boundary used for other owner-scoped Version resources

### Requirement: Show the latest ready thumbnail on Artifact grid cards

The Artifacts Page grid card SHALL reserve a 16:10 preview region and show the Artifact thumbnail belonging to the latest ready Version when available. While the thumbnail is loading, pending, absent, or terminally failed, the card SHALL retain the neutral placeholder without layout movement. List view and Artifact detail view SHALL remain unchanged.

#### Scenario: Latest ready Version has a thumbnail

- **WHEN** an Artifact grid card renders and its latest ready Version thumbnail is available
- **THEN** the card shows that thumbnail even when Publication points to an older Version

#### Scenario: Thumbnail is unavailable

- **WHEN** the latest ready Version has no available thumbnail
- **THEN** the grid card shows the existing neutral placeholder and all card actions remain available
