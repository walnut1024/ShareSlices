# artifact-upload delta specification

## ADDED Requirements

### Requirement: Adapt a single HTML file for Web upload

The ShareSlices Web UI SHALL let a signed-in user select or drop one ZIP, `.html`, or `.htm` file when creating an Artifact. When the selected file is HTML, the Web UI MUST package its unchanged bytes as a ZIP containing exactly one root `index.html` before applying ZIP preflight and submitting the existing Artifact creation request. The Web UI SHALL derive the initial Artifact name from the user-selected filename, not the generated ZIP filename.

The Web UI MUST describe single-file HTML input as self-contained and MUST NOT claim to collect local files referenced by the HTML. The API and Worker SHALL continue to receive ZIP input only.

#### Scenario: Web user selects self-contained HTML

- **WHEN** a signed-in Web user selects a non-empty `quarterly-report.html`
- **THEN** the Web UI derives the Artifact name `quarterly-report`, packages the file bytes as root `index.html`, applies ZIP preflight to the generated archive, and submits it through the existing ZIP creation request

#### Scenario: Web user selects an HTM file

- **WHEN** a signed-in Web user selects a non-empty `status.htm`
- **THEN** the Web UI derives the Artifact name `status` and handles the file as self-contained HTML input

#### Scenario: Web user selects a ZIP

- **WHEN** a signed-in Web user selects a ZIP
- **THEN** the Web UI preserves the selected ZIP bytes and existing ZIP upload behavior
