# gallery-security delta specification

## ADDED Requirements

### Requirement: Enable Gallery only after deployment eligibility succeeds

The system SHALL keep Gallery disabled by default. It SHALL enable Gallery only when validation of the actual Web, API, Untrusted-content, cookie, and network topology proves the required isolation and confirms that versioned Gallery permission terms, reporting, administrators, review operations, Removal, Artifact takedown, Public-sharing restrictions, and Appeals are available. A feature flag or force-enable setting MUST NOT override failed eligibility.

#### Scenario: Gallery has not been enabled explicitly

- **WHEN** a deployment starts with default Gallery configuration
- **THEN** Gallery remains disabled and the deployment does not accept or serve Gallery listings

#### Scenario: Deployment satisfies every enablement gate

- **WHEN** topology validation proves the isolation boundary and every required permission and governance capability is configured and operational
- **THEN** the deployment can enable Gallery

#### Scenario: Governance capability is unavailable

- **WHEN** reporting, administrator review, Removal, Artifact takedown, Public-sharing restriction, or Appeal handling is unavailable
- **THEN** Gallery remains disabled even if the content Origin is otherwise isolated

#### Scenario: Operator attempts to force an ineligible deployment

- **WHEN** configuration requests Gallery enablement but eligibility validation fails
- **THEN** the system refuses to enable or serve Gallery and reports the failed eligibility reasons without accepting a force override

### Requirement: Isolate Artifact execution from management credentials

The system SHALL execute Gallery Artifact content only on an Untrusted-content origin whose browser site and credential boundary are separate from both the trusted Web and API sites. For DNS hosts, the Untrusted-content host MUST have a different registrable domain, as determined through a public-suffix-aware effective-top-level-domain-plus-one comparison, from both the Web and API hosts. Sibling subdomains of the same registrable domain MUST NOT qualify merely because they are different hosts or Origins. For non-DNS host forms, the validator MUST prove an equivalent separate browser-site and credential boundary or classify the deployment as Gallery-ineligible.

Management cookies and other management credentials MUST NOT be sent to, readable by, or scoped across the Untrusted-content site. Same-Origin, same-site, same-host compatibility, and any topology whose cookie scope includes Artifact execution MUST be Gallery-ineligible. Automated topology-validator coverage SHALL exercise separate registrable domains, sibling subdomains, same-host different-port URLs, and cookie scopes that span the content site.

#### Scenario: Artifact content uses an isolated credential boundary

- **WHEN** the configured Untrusted-content site has a different registrable domain from both the Web and API sites and no management credential can reach it
- **THEN** topology validation can accept that site-and-credential isolation dimension

#### Scenario: Web and Artifact content share an Origin

- **WHEN** trusted management pages and Gallery Artifact content resolve to the same Origin
- **THEN** topology validation classifies the deployment as Gallery-ineligible

#### Scenario: Same host uses different ports

- **WHEN** management and Artifact content use the same host with different ports
- **THEN** topology validation classifies the shared-host deployment as Gallery-ineligible because the ports do not create a sufficient credential boundary

#### Scenario: Artifact content uses a sibling subdomain

- **WHEN** Web uses `app.example.com` and Untrusted-content uses `content.example.com`
- **THEN** topology validation classifies the deployment as Gallery-ineligible because both hosts share the registrable domain `example.com`

#### Scenario: Artifact content is separate from Web but shares the API site

- **WHEN** the Untrusted-content hostname has a different registrable domain from Web but shares the API registrable domain
- **THEN** topology validation classifies the deployment as Gallery-ineligible

#### Scenario: Artifact content uses a separate registrable domain

- **WHEN** Web and API use `example.com` sites, Untrusted-content uses an unrelated registrable domain, and no management credential is scoped to that content site
- **THEN** topology validation accepts the registrable-site and credential-boundary dimensions without treating that result as proof of the other Gallery enablement gates

#### Scenario: Cookie scope spans both hosts

- **WHEN** a management cookie or credential scope includes the configured Untrusted-content host
- **THEN** topology validation classifies the deployment as Gallery-ineligible even though the URLs have different Origins

### Requirement: Keep trusted Gallery functions outside Artifact content

The system MUST render Gallery metadata, authorization decisions, navigation, and management operations outside Artifact content on trusted ShareSlices surfaces. The Untrusted-content service SHALL be a content-only application entrypoint, listener, deployment, and ingress with a dependency set limited to route-disjoint public-player and Administrator-review credential validation, public effective-access or case-bound candidate lookup, manifest lookup, private-object streaming, policy headers, health, and telemetry. It MUST NOT mount through the management application builder or include Better Auth, management route groups, management-session middleware, aggregate writers, credentialed CORS, or an adapter that can mutate Gallery, Artifact, User, or governance state. A public credential MUST NOT authorize a review route, and a review credential MUST NOT authorize a public route. Sharing a source repository does not weaken this application and process boundary.

The Untrusted-content origin MUST NOT expose management operations or receive management-session authority, and Artifact code MUST NOT be able to invoke trusted operations through ambient Viewer credentials.

#### Scenario: Viewer opens a Gallery listing

- **WHEN** a Viewer opens the trusted Gallery listing page
- **THEN** the page renders trusted metadata and controls separately from the cross-Origin Artifact player

#### Scenario: Artifact requests a management route

- **WHEN** Artifact code sends a request to a management operation through the Untrusted-content route group
- **THEN** that route group does not serve the operation and supplies no management-session authority

#### Scenario: Content runtime starts independently

- **WHEN** the Untrusted-content deployment starts
- **THEN** its application graph contains no management routes, Better Auth dependency, credentialed CORS, or management mutation adapter

#### Scenario: Signed-in Viewer renders untrusted content

- **WHEN** a signed-in Viewer opens Gallery Artifact content
- **THEN** the content request carries no management credential that grants access to the Viewer's account or private Artifacts

### Requirement: Serve only authorized committed Version content

The trusted API SHALL atomically verify effective access, record one listing view, and issue a short-lived opaque player authorization bound to `(listing identity, committed listing revision, fixed Version)`. Reusing that authorization MUST NOT record another view. The entry URL and every relative asset URL MUST carry that same revision-scoped binding without exposing an object key or management credential. The Untrusted-content service SHALL validate the binding and effective listing access on every request, normalize requested paths, and serve only committed files present in that bound Version's manifest from private storage. It MUST NOT write an engagement aggregate, re-resolve a relative asset against whichever revision is current later, or return raw or signed object-storage URLs, raw Upload archives, staging objects, another Version's files, or arbitrary object keys.

The player-authorization response and every bound entry or asset response MUST send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Access, error, trace, and header logging MUST redact the authorization credential and bound URL segment. These controls MUST prevent browser cache reuse or referrer and log disclosure from bypassing expiry or an effective-access check.

After Administrator authorization, the trusted governance API MAY issue a separate short-lived opaque review authorization bound to `(Administrator, governance case or proposal, candidate Version)`. The Untrusted-content service MUST validate that binding, the actor's still-active Administrator authority, and the case or proposal's still-open reviewable state on every review entry and asset request and apply the same manifest, opaque-Origin, sandbox, network, storage, `no-store`, `no-referrer`, and log-redaction controls as public content. Role revocation, case closure, proposal closure, or loss of a required review dependency MUST immediately block every subsequent request, including one carrying an unexpired review authorization. A review authorization MUST NOT require or create public listing eligibility, record a Gallery view, authorize a public route, or be accepted as a public player credential. If the isolated review runtime or one of its own trusted dependencies is unavailable, the administration surface MUST expose only static evidence and a stable preview-unavailable result; it MUST NOT execute candidate content on a trusted Origin.

An Update Gallery promotion SHALL cause new player authorizations to bind the new committed revision. An already issued authorization MAY continue to serve its bound Version until its short expiry while the listing remains effectively accessible and Gallery remains enabled and deployment-eligible. Gallery disablement, Withdrawal, Removal, Public-sharing restriction, Artifact takedown, or deployment ineligibility MUST immediately block every subsequent entry and asset request, including a request carrying an unexpired authorization. An already authorized bounded Download stream is the only finish-after-disablement exception.

#### Scenario: Player requests the fixed entry file

- **WHEN** an accessible Gallery listing's player requests its entry route
- **THEN** the Untrusted-content service validates the revision-scoped player authorization and serves the bound Version's committed entry file with its recorded content type

#### Scenario: Administrator previews a non-public candidate

- **WHEN** an authorized Administrator requests executable review of a Pending or proposed Version and the isolated review runtime is operational
- **THEN** the trusted governance API issues a case-bound review authorization and the Untrusted-content service renders only that candidate under the ordinary Artifact capability restrictions without recording a public view

#### Scenario: Isolated review preview is unavailable

- **WHEN** an Administrator opens a case while the isolated review runtime or its required security dependency is unavailable
- **THEN** the trusted administration surface returns static case evidence and stable preview unavailability without executing the candidate on the Web or management Origin

#### Scenario: Administrator authority or review state closes

- **WHEN** Administrator authority is revoked or the bound case or proposal closes after a review authorization was issued
- **THEN** every later entry or asset request using that authorization is denied without returning candidate content, even before the credential expires

#### Scenario: Artifact requests a committed relative asset

- **WHEN** the fixed Version's content requests a normalized relative path present in its committed manifest
- **THEN** the request carries the same revision-scoped binding and the Untrusted-content service serves that bound Version's committed asset without exposing its private object key

#### Scenario: Artifact requests an absent or unsafe path

- **WHEN** an asset path is absent from the fixed Version manifest or contains encoded or decoded traversal, an absolute path, or another invalid normalized path
- **THEN** the service rejects the request without accessing storage outside the authorized manifest

#### Scenario: Gallery listing changes between requests

- **WHEN** Update Gallery changes the listing while content requests are in flight
- **THEN** the existing short-lived authorization continues to resolve only its bound committed Version while every newly issued authorization resolves the new revision

#### Scenario: Listing access closes while an authorization remains unexpired

- **WHEN** Gallery disablement, withdrawal, Removal, restriction, takedown, or deployment ineligibility begins after a player authorization was issued
- **THEN** every later entry or asset request using that authorization is denied without returning listing metadata or Version content

#### Scenario: Browser attempts to reuse a cached bound response

- **WHEN** a listing closes after an entry or asset response was served
- **THEN** `no-store` prevents that response from satisfying a later request without the content runtime revalidating the player authorization and effective access

#### Scenario: Bound content loads a relative asset

- **WHEN** an Artifact document requests a relative asset
- **THEN** `no-referrer` prevents the player credential from being sent as referrer data and structured logs contain only a stable redacted route template

### Requirement: Require self-contained Gallery content

The system SHALL require a fixed Version to pass deterministic self-contained-content checks before it can become Listed and MUST enforce the runtime network boundary even after those checks pass. The check SHALL reject known external resource dependencies and MUST NOT claim to prove that arbitrary HTML or JavaScript is harmless.

#### Scenario: Static content requires an external resource

- **WHEN** deterministic inspection finds that a proposed Gallery Version requires an external script, image, font, frame, stylesheet, or other network resource
- **THEN** the system rejects Gallery activation with a policy result that identifies the unsupported external dependency

#### Scenario: Content has only packaged relative resources

- **WHEN** deterministic inspection finds only supported self-contained content and relative resources in the fixed Version
- **THEN** the self-contained check can pass without claiming that the Artifact is universally safe

#### Scenario: Script constructs a request at runtime

- **WHEN** packaged JavaScript attempts a network request that deterministic inspection did not identify
- **THEN** the runtime network boundary blocks the request

### Requirement: Block external and programmatic network access at runtime

The system SHALL apply browser response policy that permits Artifact network loads only to revision-scoped, authorized manifest-backed files of the fixed Version. It SHALL support CORS without credentials for those bound files so packaged classic scripts, module scripts, styles, images, fonts, and relative `fetch` can work from the sandbox's opaque Origin. It MUST NOT reflect arbitrary Origins, allow credentials, set content-site cookies, or permit the binding to address a file outside the authorized manifest.

The browser response policy MUST block external scripts, stylesheets, images, fonts, frames, and other remote resources; form submission; programmatic external requests including `fetch`, WebSocket, event streams, and beacon delivery; and every other external network path available to Artifact content. The same Content Security Policy and capability restrictions MUST be delivered on Artifact entry and asset responses and remain effective when an entry URL is opened as a top-level document rather than through the trusted iframe.

#### Scenario: Artifact loads a packaged relative script

- **WHEN** the Artifact requests a relative script present in the authorized fixed Version manifest
- **THEN** the browser can load and execute that packaged script from the Untrusted-content origin

#### Scenario: Artifact loads a packaged module or relative data

- **WHEN** the Artifact requests a bound manifest-backed module script or uses relative `fetch` for a bound manifest-backed data file
- **THEN** the service returns CORS without credentials for that file and no other Version, external target, cookie, or management credential becomes reachable

#### Scenario: Artifact references a remote resource

- **WHEN** Artifact markup or styling references a script, stylesheet, image, font, frame, or other resource outside the authorized Version
- **THEN** the browser response policy blocks the resource request

#### Scenario: Artifact uses a programmatic network API

- **WHEN** Artifact code attempts `fetch`, WebSocket, an event stream, beacon delivery, or another programmatic request to an external or unauthorized target
- **THEN** the browser response policy blocks the request without sending Artifact or Viewer data to the target

#### Scenario: Artifact submits a form

- **WHEN** Artifact content attempts to submit a form to any target
- **THEN** the sandbox and browser response policy block the submission

#### Scenario: Viewer opens a content URL directly

- **WHEN** a Viewer opens an unexpired Artifact entry URL as a top-level document
- **THEN** response-enforced sandbox, network, storage, and capability policy remains active and the document gains no trusted navigation or management authority

### Requirement: Constrain Gallery Artifact browser capabilities

The trusted Gallery player and Artifact response policy SHALL sandbox Artifact execution without `allow-same-origin`; the iframe sandbox token set SHALL be `allow-scripts` and MUST NOT grant Artifact code Fullscreen API authority. A trusted parent control MAY use its own Viewer activation to request Full screen for the player or iframe. Every Artifact document SHALL have an opaque Origin. It MUST NOT receive content-site cookies, durable local storage, IndexedDB, Cache Storage, Service Worker registration, or another persistent state channel shared across listings or Viewers. The policy SHALL block popups, top-level navigation, forms, Artifact-initiated downloads or Full screen, clipboard access, camera, microphone, location, and every other powerful browser capability not explicitly required by the Gallery contract.

#### Scenario: Packaged Artifact script executes

- **WHEN** a Listed Gallery Artifact contains a packaged script allowed by content policy
- **THEN** the sandbox permits the script to execute in an opaque Origin without granting management credentials, persistent browser storage, or blocked browser capabilities

#### Scenario: Viewer activates trusted Full screen

- **WHEN** the Viewer activates the trusted parent Full screen control
- **THEN** the parent requests Full screen for the current fixed-Version player and allows the Viewer to exit through trusted or browser controls

#### Scenario: Artifact requests Full screen

- **WHEN** Artifact code requests Full screen with or without a user activation
- **THEN** the browser policy denies the request and the Artifact remains unable to initiate that platform action

#### Scenario: Artifact attempts a blocked capability

- **WHEN** Artifact content attempts a popup, top-level navigation, form submission, download, clipboard operation, camera, microphone, location, or another powerful capability that the Gallery contract does not grant
- **THEN** the sandbox or permissions policy blocks the attempt without granting authority that the Gallery contract does not allow

#### Scenario: Artifact attempts persistent storage

- **WHEN** Artifact code attempts to use local storage, IndexedDB, Cache Storage, a Service Worker, or a content-site cookie
- **THEN** the opaque sandbox and response policy deny or isolate the attempt so no durable identity or state can be shared across listings or Viewers

#### Scenario: Content response attempts to set a cookie

- **WHEN** an Artifact entry or asset response would include `Set-Cookie`
- **THEN** the content runtime removes or rejects that response and records a policy failure without delivering a cookie

### Requirement: Keep platform actions in trusted controls

The system SHALL provide Download, Save a copy, Report, Gallery navigation, and trusted Full screen controls outside the Artifact iframe. Artifact content MUST NOT initiate those platform actions or cause a trusted control to act without an explicit Viewer activation on that trusted control.

#### Scenario: Viewer selects trusted Download

- **WHEN** a Viewer activates Download on the trusted Gallery page
- **THEN** the trusted application authorizes and starts the Gallery download outside the Artifact iframe

#### Scenario: Artifact imitates a platform control

- **WHEN** Artifact content renders a button labeled Download, Save a copy, or Report
- **THEN** activating that untrusted element does not invoke the corresponding ShareSlices platform operation

#### Scenario: Artifact sends an unsolicited message to the parent page

- **WHEN** Artifact code attempts to trigger navigation or a platform operation through cross-frame messaging
- **THEN** the trusted page ignores the request unless it belongs to an explicitly supported non-privileged player protocol and does not perform the platform operation

### Requirement: Fail closed when Gallery eligibility is absent or lost

The system SHALL validate Gallery eligibility at deployment startup, before activation, and continuously through a shared request-time or health-driven gate for required topology, current grant, production challenge verification, Administrator authority, reporting, notification, Appeal, governance, and isolated-content capabilities. Configuration, redeployment, or runtime health loss MUST transition the gate to ineligible and stop new Share to Gallery and Update Gallery admission, public report intake, discovery, interactions, player authorization, and Artifact serving with pre-lookup `503` until every gate is restored. Authenticated Gallery view and the risk-reducing permanent Withdraw from Gallery operation SHALL remain available and MUST NOT depend on the Untrusted-content runtime. Read-only recovery of an already accepted idempotent owner operation remains available and performs no new admission. Authorized administration, notifications, and Appeal handling MUST NOT be disabled merely because public Gallery is unavailable, but each SHALL remain available only while its own trusted dependencies are operational; a missing dependency MUST return a stable unavailable result and keep Gallery ineligible.

#### Scenario: Eligible deployment restarts with an unsafe topology

- **WHEN** a previously enabled deployment restarts after configuration changes make its topology Gallery-ineligible
- **THEN** Gallery remains unavailable and serves no Artifact content despite its prior enabled state

#### Scenario: Required governance configuration is removed

- **WHEN** a redeployment no longer configures a required Gallery permission or governance capability
- **THEN** eligibility validation fails closed and the deployment does not accept Gallery share, update, public report, interaction, or content requests

#### Scenario: Required capability fails at runtime

- **WHEN** the production challenge verifier, Administrator-authority source, reporting, notification, Appeal, governance, or isolated-content capability becomes unhealthy without a redeployment
- **THEN** the shared gate makes every public Gallery entrypoint return pre-lookup `503` and blocks new public-expanding work while preserving Owner view and withdrawal

#### Scenario: Required runtime capability recovers

- **WHEN** the failed capability becomes healthy and every other topology and capability gate remains satisfied
- **THEN** the shared gate can restore Gallery eligibility without a redeployment and without changing existing listing lifecycle state

#### Scenario: Owner manages risk while Gallery is unavailable

- **WHEN** Gallery is disabled or ineligible and an authenticated Owner views or confirms withdrawal of an existing Pending or Listed listing
- **THEN** the trusted management API returns state or completes permanent withdrawal without serving Artifact content or enabling another public operation

#### Scenario: Governance work continues while Gallery is unavailable

- **WHEN** an authorized party reads notifications, submits an eligible Appeal, or reviews and reduces existing governance state while public Gallery is unavailable and that trusted operation's own dependencies remain operational
- **THEN** the trusted governance surface remains available without enabling public report intake, discovery, interaction, or content serving

#### Scenario: Trusted governance dependency is unavailable

- **WHEN** public Gallery is unavailable and an administration, notification, or Appeal dependency required by the requested trusted operation is not operational
- **THEN** that operation returns its stable unavailable result, preserves existing state, and does not make Gallery eligible

#### Scenario: Client recovers an accepted owner operation while Gallery is unavailable

- **WHEN** an authenticated Owner repeats equivalent input with the idempotency key of an already accepted Share to Gallery, Update Gallery, or Withdraw from Gallery operation
- **THEN** the system returns that operation's durable state without admitting a new proposal or enabling a public Gallery route

#### Scenario: Eligibility is restored

- **WHEN** the deployment again satisfies every topology, permission, and governance gate and Gallery is explicitly enabled
- **THEN** the system can resume Gallery listing operations and authorized Artifact serving
