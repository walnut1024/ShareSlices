# artifact-thumbnail Delta Specification

<!-- cspell:words secretless ungranted -->

## MODIFIED Requirements

### Requirement: Render thumbnails in an isolated deterministic environment

The Worker SHALL render the committed Version entry in a bounded Chromium child process using a fixed `1440x810` viewport. The execution environment MUST run the Worker image as a non-root user, expose no additional Linux capabilities or host authority, prevent privilege escalation, and enforce a system-call and process-isolation boundary. An operator-managed container runtime MUST drop all capabilities, forbid privilege escalation, and retain the runtime-default seccomp profile. A managed container target that cannot express those controls directly MUST provide verifiable platform-enforced isolation that is equal to or stricter than those outcomes; otherwise deployment verification MUST classify thumbnail processing as unavailable.

Rendering MUST use only manifest-listed Version content, MUST block external network access, MUST request reduced motion and disable animation and transition, and MUST complete `load`, font readiness, and two animation frames within one 10-second deadline.

The Kubernetes resident Worker and bounded Cloudflare thumbnail Container MUST preserve the same Chromium, font, viewport, readiness, output, request-blocking, capture-grant, and renderer-revision identity. Queue delivery MAY wake thumbnail processing but MUST NOT supply authoritative render input.

On Kubernetes, the resident Runner SHALL continue to claim the immutable Version, renderer revision, attempt, lease, and fence from PostgreSQL. It SHALL read authorized manifest content through the private internal capture path.

On Cloudflare, the Jobs Worker SHALL establish that authoritative claim and fence before starting a secretless thumbnail Container. A private execution broker SHALL bind the Container identity to two audience-scoped authority families: a short-lived single-use bootstrap grant that can establish only a read-only browser capture session for the immutable Version, and a controller/output capability for heartbeat, output upload, and fenced commit. The derived capture session MAY authorize the browser's subsequent manifest-listed `GET` requests but MUST NOT make the bootstrap grant reusable.

The controller/output capability MUST NOT enter a page URL, Cookie, document, browser-visible header, or other Artifact-readable surface. The broker MUST reject cross-audience or cross-operation use. The capture/broker path MUST NOT become a public Viewer or content route.

The Cloudflare Container and Chromium child MUST NOT receive a database credential, R2 credential, direct PostgreSQL path, public R2 URL, or general Worker authority. Every database and R2 operation SHALL execute in the broker outside the Container.

Container cold-start time SHALL be observed separately. Once the Chromium readiness attempt begins, the existing single 10-second deadline remains unchanged.

Container memory, CPU, wall time, concurrency, and temporary disk SHALL be bounded. Temporary disk MUST NOT contain the sole durable input, output, attempt, or completion state. Termination SHALL stop new claims and prevent an unfenced late screenshot or upload from becoming successful.

#### Scenario: Artifact requests an external resource

- **WHEN** thumbnail rendering attempts to load a resource outside the target Version manifest
- **THEN** the request is blocked and rendering continues using the page's available fallback behavior

#### Scenario: Artifact does not become render-ready

- **WHEN** the shared 10-second deadline expires before the readiness sequence completes
- **THEN** the attempt ends with a deterministic render-timeout failure

#### Scenario: Kubernetes runs the thumbnail Worker

- **WHEN** a Kubernetes release renders the resident thumbnail-processing workload
- **THEN** its container runs non-root with all capabilities dropped, privilege escalation forbidden, and the runtime-default seccomp profile retained

#### Scenario: Cloudflare Queue wakes thumbnail processing

- **WHEN** a Cloudflare Queue message wakes a bounded Container for pending thumbnail work
- **THEN** the jobs Worker claims authoritative Version, renderer, attempt, lease, and fence state from PostgreSQL and starts a named secretless Container with separate browser-capture and controller/output capabilities

#### Scenario: Cloudflare Container renders the same revision

- **WHEN** a Version pins a renderer revision and its thumbnail attempt runs in the Cloudflare target
- **THEN** the immutable Container image uses that revision's fixed Chromium, fonts, viewport, motion suppression, readiness sequence, deadline, and output contract

#### Scenario: Artifact targets runtime authority

- **WHEN** rendered Artifact code attempts to reach an external host, provider API, Worker management route, Container metadata, PostgreSQL, R2 or S3 authority, or another control-plane address
- **THEN** the rendering boundary blocks the request without returning credentials or committing a successful result from that access

#### Scenario: Thumbnail Container calls an ungranted broker operation

- **WHEN** the Cloudflare thumbnail Container presents either capability for another Version, path, attempt, audience, output, or management operation
- **THEN** the broker rejects the request and does not read storage, mutate PostgreSQL, or disclose broader authority

#### Scenario: Artifact code induces capture-session requests

- **WHEN** Artifact-controlled JavaScript induces requests carrying the browser's path-scoped capture session
- **THEN** the session can retrieve only manifest-listed bytes for the fixed Version and cannot heartbeat, upload output, commit an attempt, or obtain the controller/output capability

#### Scenario: Managed-container isolation cannot be proven equivalent

- **WHEN** deployment cannot verify a non-root, no-capability, no-privilege-escalation, no-host-authority, and equivalent system-call isolation boundary for a managed Container
- **THEN** thumbnail readiness fails while Version readiness, Preview, Publication, and Share-link behavior remain governed by the existing non-blocking thumbnail contract

#### Scenario: Managed Container terminates during capture

- **WHEN** the Container reaches termination while Chromium or object upload is in progress
- **THEN** it stops new claims and output may commit only while the attempt still owns its valid lease and fence

### Requirement: Restrict internal capture access

The internal render route MUST require a short-lived, single-use bootstrap capture grant scoped to exactly one Version and render attempt. The first valid entry request SHALL atomically consume that grant and establish a separate short-lived, HttpOnly, SameSite-strict, route-path-scoped capture session. Replaying the bootstrap grant MUST fail even while the derived session remains valid.

The derived session SHALL authorize only `GET` requests for manifest-listed content under the fixed Version's private capture route. It MUST NOT authorize management APIs, another Version or attempt, public Viewer access, heartbeat, output upload, commit, or acquisition of controller authority. The route MUST NOT be exposed through public ingress. Expiry, attempt completion, lease loss, or fence loss SHALL prevent later session use from contributing to a successful thumbnail result.

#### Scenario: Capture bootstrap grant is reused or targets another Version

- **WHEN** a consumed, expired, or mismatched bootstrap capture grant is presented
- **THEN** the render route denies access without returning Version content or issuing another session

#### Scenario: Browser loads capture assets after bootstrap

- **WHEN** Chromium follows a successful entry response with the valid derived capture session and requests a normalized manifest-listed asset for the fixed Version
- **THEN** the private route returns only that asset without reusing the consumed bootstrap grant

#### Scenario: Capture session crosses its authority boundary

- **WHEN** a capture session targets another Version, attempt, route family, non-GET operation, or controller/output operation
- **THEN** the route or broker rejects it without reading unrelated storage, mutating PostgreSQL, or disclosing broader authority
