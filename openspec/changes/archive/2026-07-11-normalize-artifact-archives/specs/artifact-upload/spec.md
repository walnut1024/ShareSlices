# artifact-upload Specification Delta

## MODIFIED Requirements

### Requirement: Validate and expand accepted archives

The Worker SHALL validate each accepted ZIP against its Upload session policy snapshot and derive an effective archive from safe regular entries. It SHALL ignore only explicitly supported operating-system metadata after path safety checks. If all effective files share one top-level wrapper directory, it SHALL remove that one directory when doing so preserves every relative path and creates no empty or duplicate path.

A valid effective archive MUST contain an unambiguous root HTML entry. The Worker SHALL prefer a root `index.html`; when it is absent and exactly one root HTML file exists, the Worker SHALL use that file without rewriting it. The Worker MUST reject missing or ambiguous root entries, unsafe or absolute paths, parent traversal, links, special files, nested archives, unsupported file extensions, invalid checked signatures, and any effective size or count that exceeds the snapshot.

The seeded default policy SHALL use the product limits owned by `PRODUCT.md`.

#### Scenario: macOS metadata does not block a valid Artifact

- **WHEN** a safe ZIP contains one valid root HTML file plus `__MACOSX/`, AppleDouble, or `.DS_Store` metadata
- **THEN** the Worker ignores the metadata, uses the only root HTML as the entry, commits no metadata asset, and records normalization warnings

#### Scenario: One wrapper directory is removed

- **WHEN** every effective file is below the same top-level directory and removing it creates safe unique paths
- **THEN** the Worker removes that directory once and preserves the relative relationships among all effective files

#### Scenario: Root index remains preferred

- **WHEN** the effective archive contains root `index.html` and other root HTML files
- **THEN** the Worker uses `index.html` as the entry without treating the other HTML files as ambiguity

#### Scenario: Only one named root HTML exists

- **WHEN** the effective archive has no root `index.html` and contains exactly one root HTML file
- **THEN** the Worker records that file as the entry without renaming or rewriting it and records `entry_file_inferred`

#### Scenario: Entry candidates are ambiguous

- **WHEN** the effective archive has no root `index.html` and contains multiple root HTML files
- **THEN** the Worker rejects the archive with `ambiguous_entry_file` and identifies the bounded candidate list

#### Scenario: Root entry is missing

- **WHEN** the effective archive contains no root HTML file
- **THEN** the Worker rejects it with `missing_entry_file` and identifies bounded nested HTML candidates when available

#### Scenario: Metadata-shaped unsafe path is rejected

- **WHEN** an entry has an unsafe path that otherwise resembles supported operating-system metadata
- **THEN** the Worker rejects the archive before metadata filtering

### Requirement: Report asynchronous processing state

The system SHALL expose the current Upload session state and a structured validation report to the Artifact owner. Processing states MUST distinguish accepted, processing, ready, and failed outcomes.

A blocking validation item SHALL contain a stable code, safe message, user-actionable correction, and structured details appropriate to the violation. Details SHALL identify the affected normalized path, candidates, expected format, actual value, allowed value, or count whenever available. A non-blocking normalization SHALL be exposed as a structured warning. Reports MUST be bounded and MUST NOT expose object keys, raw exceptions, stack traces, credentials, or Share slugs.

The system SHALL preserve the mapping from each immutable raw ZIP source path to its effective normalized path. Extraction MUST read the source path, while staging, manifests, management details, Preview, and Viewer routing MUST use the effective path.

#### Scenario: Owner reads a file-content failure

- **WHEN** a file's content does not match its enabled format rule
- **THEN** the Artifact detail returns `invalid_file_content` with the affected path, expected validation kind, and corrective action

#### Scenario: Owner reads a size-limit failure

- **WHEN** an archive, expanded archive, or effective file exceeds its snapshotted limit
- **THEN** the Artifact detail returns the matching stable code with actual and allowed byte values where both are known

#### Scenario: Owner reads a format failure

- **WHEN** an effective file has an unsupported or disabled extension
- **THEN** the Artifact detail returns `unsupported_format` with the affected path and extension

#### Scenario: Owner reads normalization warnings

- **WHEN** processing safely ignores metadata, removes a wrapper directory, or infers the only entry file
- **THEN** the Artifact detail exposes the corresponding warnings without changing a successful ready outcome into a failure

#### Scenario: Wrapper normalization preserves extraction

- **WHEN** the Worker removes one common wrapper directory from effective paths
- **THEN** it reads bytes from each original ZIP source path and stores them under the corresponding effective path

#### Scenario: API rejects archive size before creating an Artifact

- **WHEN** the streamed raw ZIP crosses the archive-size limit before an Artifact or Upload session is created
- **THEN** the API returns `archive_too_large` with the allowed byte value and a corrective action in the synchronous error response
- **AND** the API does not claim that the first over-limit byte count is the complete archive size

## ADDED Requirements

### Requirement: Keep client preflight aligned with authoritative validation

The system SHALL expose the active policy values needed for Web and future CLI preflight. Client preflight MAY reject input before transfer and MAY present the same stable validation codes, but it MUST NOT replace authoritative API and Worker enforcement. The Worker MUST validate every accepted archive against its Upload session policy snapshot regardless of client behavior.

Representative checked fixtures SHALL define expected normalization and validation reports across runtimes that implement client preflight.

#### Scenario: Web catches a problem before upload

- **WHEN** Web preflight detects a policy violation
- **THEN** Web presents the affected file and corrective action without uploading the ZIP

#### Scenario: Client skips or bypasses preflight

- **WHEN** a CLI or direct API client submits a ZIP without matching preflight
- **THEN** the API and Worker still enforce the complete authoritative validation path

#### Scenario: Client and Worker classify the same fixture

- **WHEN** a checked conformance fixture is evaluated by multiple validation implementations
- **THEN** they produce the same stable issue codes and detail meanings for the rules each implementation supports
