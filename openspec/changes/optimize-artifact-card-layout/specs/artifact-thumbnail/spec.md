# artifact-thumbnail Delta Specification

## MODIFIED Requirements

### Requirement: Render thumbnails in an isolated deterministic environment

The Worker SHALL render the committed Version entry in a bounded Chromium child process using a fixed `1440x810` viewport. The Worker container MUST run as a non-root user, drop all capabilities, forbid privilege escalation, and retain the runtime-default seccomp profile. Rendering MUST use only manifest-listed Version content, MUST block external network access, MUST request reduced motion and disable animation and transition, and MUST complete `load`, font readiness, and two animation frames within one 10-second deadline.

#### Scenario: Artifact requests an external resource

- **WHEN** thumbnail rendering attempts to load a resource outside the target Version manifest
- **THEN** the request is blocked and rendering continues using the page's available fallback behavior

#### Scenario: Artifact does not become render-ready

- **WHEN** the shared 10-second deadline expires before the readiness sequence completes
- **THEN** the attempt ends with a deterministic render-timeout failure

### Requirement: Store and retry immutable thumbnail output

Successful rendering SHALL produce an `800x450` WebP stored as a private immutable object belonging to one Content bundle and renderer revision. Each Version SHALL pin its renderer revision when it becomes ready. Classified transient failures SHALL receive no more than three automatic retries with backoff; deterministic failures MUST NOT be retried automatically. Removing one Version MUST preserve the thumbnail while another Version references its Content bundle; final bundle cleanup MUST include every renderer-revision thumbnail.

#### Scenario: Transient rendering dependency fails

- **WHEN** Chromium, the internal render route, or object storage reports a classified transient failure
- **THEN** the shared thumbnail job is retried within the bounded policy without changing any Version state

#### Scenario: Renderer revision advances

- **WHEN** a later Version pins `renderer-v2` for a Content bundle that has output under an earlier renderer revision
- **THEN** it receives independent `800x450` thumbnail work and earlier Version URLs continue resolving the bytes for their pinned revision

#### Scenario: Referencing Version is removed

- **WHEN** one Version is deleted while another Version still references the same Content bundle and renderer revision
- **THEN** the shared thumbnail object remains available to the surviving Version

### Requirement: Show the latest ready thumbnail on Artifact grid cards

The Artifacts Page grid card SHALL reserve a 16:9 preview region independent from its metadata footer and show the Artifact thumbnail belonging to the latest ready Version when available. The Web MUST display the complete `800x450` thumbnail without cropping, letterboxing, or geometric distortion. While the thumbnail is loading, pending, absent, or terminally failed, the card SHALL retain a neutral placeholder with the same preview geometry and without layout movement. List view and Artifact detail view SHALL remain unchanged.

#### Scenario: Latest ready Version has a thumbnail

- **WHEN** an Artifact grid card renders and its latest ready Version thumbnail is available
- **THEN** the card shows the complete 16:9 thumbnail even when Publication points to an older Version

#### Scenario: Thumbnail is unavailable

- **WHEN** the latest ready Version has no available thumbnail
- **THEN** the grid card shows the neutral 16:9 placeholder and all state-valid card actions remain available

#### Scenario: Card metadata needs its own height

- **WHEN** the card renders its Artifact name and modified time
- **THEN** the metadata footer uses its independent reserved region without reducing or overlapping the 16:9 preview
