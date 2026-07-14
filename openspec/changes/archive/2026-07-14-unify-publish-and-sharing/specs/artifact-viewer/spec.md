# artifact-viewer delta specification

## MODIFIED Requirements

### Requirement: Serve the current published Version

The Viewer SHALL resolve a non-retired Share link to the Artifact's Published Publication and SHALL serve only files committed for that immutable Version. A successful entry-page or asset response SHALL use the content type recorded in the committed manifest. Expired and Unpublished Publications MUST NOT serve Version content.

#### Scenario: Viewer opens a Published Share link

- **WHEN** a Viewer requests a non-retired Share link whose Artifact status is Published
- **THEN** the Viewer returns the Publication Version's root `index.html` content with status `200`

#### Scenario: Viewer requests a Published asset

- **WHEN** a Viewer requests a normalized asset path present in the Published Version manifest
- **THEN** the Viewer streams the committed private object with its recorded content type

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
