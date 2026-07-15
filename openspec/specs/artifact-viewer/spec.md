# artifact-viewer Specification

## Purpose

TBD - created by archiving change v0-0-1-first-share-flow. Update Purpose after archive.

## Requirements

### Requirement: Resolve configured Share-link routes

The Viewer SHALL resolve `/a/{shareSlug}/` and its asset paths from the configured Viewer address. The same Viewer behavior MUST work when deployment configuration uses Docker Compose ports, Kubernetes IP addresses and ports without DNS, or public Kubernetes ingress domain names.

The Viewer route group MUST NOT expose management operations.

#### Scenario: Viewer uses an IP and port

- **WHEN** an intranet deployment configures the Viewer with an IP address and port
- **THEN** generated Share links and Viewer route resolution use that configured address without requiring a domain name

#### Scenario: Viewer uses a public domain

- **WHEN** public production configures a Viewer domain
- **THEN** generated Share links and Viewer route resolution use that configured domain without changing application behavior

#### Scenario: Viewer requests a management route

- **WHEN** a request reaches the Viewer route group for a management operation
- **THEN** the Viewer route group does not serve that operation

### Requirement: Serve the current published Version

The Viewer SHALL resolve a non-retired Share link to the Artifact's Published Publication and SHALL present its entry route through a trusted player shell that embeds only files committed for that immutable Version. A successful embedded entry-page or asset response SHALL use the content type recorded in the committed manifest. Expired and Unpublished Publications MUST NOT serve Version content.

#### Scenario: Viewer opens a Published Share link

- **WHEN** a Viewer requests a non-retired Share link whose Artifact status is Published
- **THEN** the Viewer returns a trusted player shell with status `200` that renders the Publication Version's entry file

#### Scenario: Viewer requests a Published asset

- **WHEN** the player or its Artifact content requests a normalized asset path present in the Published Version manifest
- **THEN** the Viewer streams the committed private object with its recorded content type

### Requirement: Resolve relative Artifact references

Preview and Viewer SHALL load Artifact entry files from URLs whose trailing-slash base keeps browser-relative HTML, CSS, and JavaScript references under the corresponding content route. The trusted Viewer shell MUST preserve `/a/{shareSlug}/` as the Share link and MUST NOT change the effective relative-asset base. Version 0.0.1 SHALL support relative references and SHALL NOT rewrite uploaded HTML or promise support for root-absolute references.

#### Scenario: Entry page references a relative asset

- **WHEN** the Artifact entry file loaded for `/a/{shareSlug}/` contains `assets/app.js`
- **THEN** the browser requests `/a/{shareSlug}/assets/app.js` and the Viewer resolves that manifest path

#### Scenario: Stylesheet references a relative image

- **WHEN** a stylesheet asset references `../images/chart.png`
- **THEN** browser URL resolution produces the normalized Artifact path and the Viewer resolves it from the same manifest

#### Scenario: Entry page uses a root-absolute asset

- **WHEN** Artifact content requests `/assets/app.js`
- **THEN** version 0.0.1 does not rewrite or remap that request into the Artifact content route

### Requirement: Represent known Share-link state

The Viewer SHALL return a non-content state page for a known Share link that is not currently serving content. Status pages MUST NOT expose the Artifact name, Owner, historical content, or ready but unpublished Version metadata, and MUST be excluded from search indexing.

#### Scenario: Known link has an Expired Publication

- **WHEN** a Viewer requests a non-retired Share link whose latest Publication is Expired
- **THEN** the Viewer returns status `200` with a generic expired Publication state page

#### Scenario: Known link has an Unpublished Publication

- **WHEN** a Viewer requests a non-retired Share link whose latest Publication is Unpublished
- **THEN** the Viewer returns status `200` with a generic Unpublished state page and a generic route to ShareSlices management

#### Scenario: Known link is retired

- **WHEN** a Viewer requests a Share link retired by explicit replacement
- **THEN** the Viewer returns status `410` with a retired-link state page

#### Scenario: Share link is unknown

- **WHEN** a Viewer requests a Share slug the system does not know
- **THEN** the Viewer returns `404`

### Requirement: Restrict Viewer asset resolution

The Viewer MUST normalize and validate requested asset paths and MUST resolve files only from the committed manifest for the currently published Version. It MUST NOT return raw object-storage URLs, signed object-storage URLs, raw archives, staging objects, or files from another Version.

#### Scenario: Asset path is not in the manifest

- **WHEN** a Viewer requests an asset path absent from the current published Version manifest
- **THEN** the Viewer returns `404` without reading an arbitrary object key

#### Scenario: Asset path attempts traversal

- **WHEN** a Viewer asset request contains encoded or decoded parent traversal, an absolute path, or another invalid normalized path
- **THEN** the Viewer rejects the request without accessing object storage outside the committed Version

#### Scenario: Publication changes during an asset request

- **WHEN** Publication changes while a Viewer request is resolving an immutable Version asset
- **THEN** the request resolves entirely against one committed Version and never mixes files from different Versions

### Requirement: Disable Preview and Viewer caching

Version 0.0.1 SHALL send `Cache-Control: no-store` on Preview entry, Preview asset, Viewer entry, Viewer asset, and known-link state responses.

#### Scenario: Artifact is Unpublished after viewing

- **WHEN** a Viewer requests the stable Share link after the Owner has Unpublished it
- **THEN** the browser revalidates through the server and receives the Unpublished state instead of cached Artifact content

#### Scenario: Publication expires after viewing

- **WHEN** a Viewer requests the stable Share link after the Publication's scheduled end
- **THEN** the browser revalidates through the server and receives the Expired state instead of cached Artifact content

#### Scenario: Publication changes between asset requests

- **WHEN** Publication changes between requests to the same stable Viewer asset path
- **THEN** each response is resolved by the server without reusing a cached response from the previous Publication

### Requirement: Control Viewer full-screen display

The trusted player shell for an accessible Publication SHALL provide persistent `Enter full screen` and `Exit full screen` icon controls with accessible names. It SHALL request full screen only from a user activation, synchronize its control state from browser full-screen events, and permit Artifact content to make its own user-activated full-screen request. Full-screen display MUST NOT select another Version, change Publication state, or grant access.

When Artifact content itself owns a nested full-screen session, the browser places that iframe above trusted sibling controls. In that nested case the user exits through Escape or browser-provided full-screen UI; after exit, the trusted player's synchronized control becomes visible again.

Known-link status pages that do not serve Artifact content and unknown Share links MUST NOT show the full-screen control.

#### Scenario: Viewer enters full screen

- **WHEN** a Viewer activates `Enter full screen` on an accessible Share link
- **THEN** the player displays the current Publication Version across the available screen and changes the visible control to `Exit full screen`

#### Scenario: Viewer exits full screen

- **WHEN** the Viewer uses the exit icon or Escape, or the browser otherwise ends full screen
- **THEN** the same Share link and Publication Version remain open in normal display mode and the control returns to `Enter full screen`

#### Scenario: Browser rejects Viewer full screen

- **WHEN** the browser does not support or rejects the full-screen request
- **THEN** the Viewer content remains usable in normal display mode and reports the failure without navigation or automatic retry

#### Scenario: Viewer opens a non-content state

- **WHEN** a Share link resolves as Expired, Unpublished, retired, or unknown
- **THEN** the resulting non-content status page does not expose a full-screen control
