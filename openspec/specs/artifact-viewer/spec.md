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

The Viewer SHALL resolve an active Share link to the Artifact's current Publication and SHALL serve only files committed for that immutable Version. A successful entry-page or asset response SHALL use the content type recorded in the committed manifest.

#### Scenario: Viewer opens a published Share link

- **WHEN** a Viewer requests an active Share link whose Artifact has a current Publication
- **THEN** the Viewer returns the published Version's root `index.html` content with status `200`

#### Scenario: Viewer requests a published asset

- **WHEN** a Viewer requests a normalized asset path present in the published Version manifest
- **THEN** the Viewer streams the committed private object with its recorded content type

### Requirement: Resolve relative Artifact references

Preview and Viewer entry URLs SHALL end with `/` so browser-relative HTML, CSS, and JavaScript references remain under the corresponding content route. Version 0.0.1 SHALL support relative references and SHALL NOT rewrite uploaded HTML or promise support for root-absolute references.

#### Scenario: Entry page references a relative asset

- **WHEN** `/a/{shareSlug}/` contains `assets/app.js`
- **THEN** the browser requests `/a/{shareSlug}/assets/app.js` and the Viewer resolves that manifest path

#### Scenario: Stylesheet references a relative image

- **WHEN** a stylesheet asset references `../images/chart.png`
- **THEN** browser URL resolution produces the normalized Artifact path and the Viewer resolves it from the same manifest

#### Scenario: Entry page uses a root-absolute asset

- **WHEN** Artifact content requests `/assets/app.js`
- **THEN** version 0.0.1 does not rewrite or remap that request into the Artifact content route

### Requirement: Represent known Share-link state

The Viewer SHALL return a non-content state page for a known Share link that is not currently serving content. Status pages MUST NOT expose the Artifact name, owner, historical content, or ready but unpublished Version metadata, and MUST be excluded from search indexing.

#### Scenario: Active link is unpublished

- **WHEN** a Viewer requests an active Share link whose Artifact has no current Publication
- **THEN** the Viewer returns status `200` with an unpublished state page and a generic route to ShareSlices management

#### Scenario: Known link is expired

- **WHEN** a Viewer requests a known expired Share link
- **THEN** the Viewer returns status `410` with an expired-link state page

#### Scenario: Known link is retired

- **WHEN** a Viewer requests a known retired Share link
- **THEN** the Viewer returns status `410` with a retired-link state page

#### Scenario: Share link is unknown

- **WHEN** a Viewer requests a Share slug the system does not know
- **THEN** the Viewer returns status `404`

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

#### Scenario: Artifact is unpublished after viewing

- **WHEN** a Viewer requests the stable Share link after the owner has unpublished it
- **THEN** the browser revalidates through the server and receives the unpublished state instead of using cached Artifact content

#### Scenario: Publication changes between asset requests

- **WHEN** Publication changes between requests to the same stable Viewer asset path
- **THEN** each response is resolved by the server without reusing a cached response from the previous Publication
