# artifact-viewer delta specification

## MODIFIED Requirements

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

- **WHEN** the Artifact entry file loaded through the reserved content route contains `assets/app.js`
- **THEN** the browser requests that asset under the same reserved content route and the Viewer resolves it to the manifest path `assets/app.js`

#### Scenario: Stylesheet references a relative image

- **WHEN** a stylesheet asset references `../images/chart.png`
- **THEN** browser URL resolution produces the normalized Artifact path and the Viewer resolves it from the same manifest

#### Scenario: Entry page uses a root-absolute asset

- **WHEN** Artifact content requests `/assets/app.js`
- **THEN** version 0.0.1 does not rewrite or remap that request into the Artifact content route

## ADDED Requirements

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
