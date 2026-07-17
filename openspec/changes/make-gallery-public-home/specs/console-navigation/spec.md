# console-navigation Specification

## ADDED Requirements

### Requirement: Expose one canonical authenticated Console

The Web SHALL expose Console as the authenticated personal-management surface. `/console` SHALL render the signed-in User's Artifact list, `/console/artifacts/{artifactId}` SHALL render owned Artifact detail, `/console/artifacts/{artifactId}/preview` SHALL render owner Preview without Console navigation chrome, and `/console/settings/gallery-profile` SHALL render personal Gallery profile management. Console navigation SHALL provide a route to the public Website at `/` and MUST NOT expose platform administration as an ordinary User destination.

#### Scenario: User opens Console

- **WHEN** a signed-in User opens `/console`
- **THEN** the Web renders the User's Artifact list inside the Console shell

#### Scenario: User opens owned Artifact detail

- **WHEN** a signed-in Owner opens `/console/artifacts/{artifactId}` for an Artifact they own
- **THEN** the Web renders the existing owned Artifact detail behavior inside the Console shell

#### Scenario: User opens owner Preview

- **WHEN** a signed-in Owner opens `/console/artifacts/{artifactId}/preview` with a valid selected Version
- **THEN** the Web renders the existing owner-only player without Console navigation chrome and without changing publication or Gallery state

#### Scenario: User manages Gallery profile

- **WHEN** a signed-in User opens `/console/settings/gallery-profile`
- **THEN** the Web renders personal Gallery profile management inside the Console shell

#### Scenario: Signed-out visitor opens Console

- **WHEN** a signed-out visitor opens a canonical Console route
- **THEN** the Web requires sign-in with the canonical Console destination preserved

#### Scenario: User returns to the public Website

- **WHEN** a User activates the Website destination from Console
- **THEN** the Web opens `/` without signing the User out

#### Scenario: Ordinary User inspects Console navigation

- **WHEN** an ordinary signed-in User views Console navigation
- **THEN** it does not expose Gallery administration as a destination

### Requirement: Keep administration distinct from Console

The Web SHALL keep Gallery administration at `/admin/gallery` as a separate authenticated and authorized route class. Administration MUST NOT be nested below `/console`, presented as personal Artifact management, or added to ordinary User navigation.

#### Scenario: Authorized Administrator opens Gallery administration

- **WHEN** an authorized Administrator opens `/admin/gallery`
- **THEN** the Web renders Gallery governance outside the Console route tree with the existing authorization policy

#### Scenario: Ordinary User opens Gallery administration

- **WHEN** an ordinary signed-in User opens `/admin/gallery`
- **THEN** the existing authorization policy denies administration without treating the route as Console content

### Requirement: Migrate former management paths to Console

The Web MUST generate only canonical Console addresses for personal management. Before initial route classification, Session lookup, authentication, or `returnTo` construction, a synchronous location resolver SHALL replace `/artifacts`, `/artifacts/new`, `/artifacts/{artifactId}`, `/artifacts/{artifactId}/preview`, or `/settings/gallery-profile` with its canonical Console destination. When present exactly once, `/artifacts/{artifactId}` SHALL retain only `gallery=manage` and the former Preview path SHALL retain only one non-empty `versionId`; list, new, and profile paths retain no query. Every fragment, unknown or duplicate query key, and nested `returnTo` MUST be discarded. Former paths MUST NOT be emitted as links, retained as canonical metadata, or accepted as post-sign-in return destinations.

#### Scenario: User opens the former Artifact list

- **WHEN** a visitor opens `/artifacts` or `/artifacts/new`
- **THEN** the Web replaces the location with `/console` without adding the former path to navigation history

#### Scenario: User opens former Artifact detail

- **WHEN** a visitor opens `/artifacts/{artifactId}?gallery=manage` with any additional query or fragment state
- **THEN** the Web replaces the location with `/console/artifacts/{artifactId}?gallery=manage` and discards every other key and fragment

#### Scenario: User opens former owner Preview

- **WHEN** a visitor opens `/artifacts/{artifactId}/preview` with one non-empty `versionId` plus any additional query or fragment state
- **THEN** the Web replaces the location with `/console/artifacts/{artifactId}/preview`, retains only the encoded `versionId`, and discards every other key and fragment

#### Scenario: User opens former Gallery profile management

- **WHEN** a visitor opens `/settings/gallery-profile`
- **THEN** the Web replaces the location with `/console/settings/gallery-profile`

#### Scenario: Signed-out visitor opens a former protected path

- **WHEN** a signed-out visitor opens a former management address
- **THEN** the Web normalizes it before any Session request or sign-in decision so `returnTo` contains only the canonical Console destination

#### Scenario: Application renders management navigation

- **WHEN** any public, account-entry, Console, Preview, feedback, or administration component creates a personal-management link
- **THEN** the link uses the canonical `/console` route tree and never a former management path

### Requirement: Keep Console separate from resource interfaces

The Console migration SHALL change trusted Web navigation and presentation only. Existing HTTP Artifact, Version, Publication, Gallery-owner, Session, and Preview interfaces MUST retain their resource-owned paths and behavior. Console MUST NOT introduce an `/api/console` namespace, duplicate Artifact policy, or change database, Worker, CLI, object-storage, or isolated-content contracts.

#### Scenario: Console loads the Artifact list

- **WHEN** `/console` requests the signed-in User's Artifacts
- **THEN** the Web uses the existing Artifact HTTP interface and receives the existing resource projection

#### Scenario: Console invokes an Artifact operation

- **WHEN** a User uploads, previews, publishes, shares to Gallery, updates, exports, or deletes through Console
- **THEN** the existing Server-owned operation and authorization policy remains authoritative without a parallel Console implementation

#### Scenario: CLI manages an Artifact

- **WHEN** the CLI or official Skill performs an existing Artifact or Gallery owner operation
- **THEN** its command and HTTP contracts remain unchanged by the Console Web route migration

### Requirement: Preserve owner Preview document caching policy

The trusted Web document for canonical `/console/artifacts/{artifactId}/preview` and migration-only `/artifacts/{artifactId}/preview` requests MUST send `Cache-Control: no-store` in development, Compose, container-image, Kubernetes base, and public-production ingress configurations. The route migration MUST NOT change the existing authenticated API Preview entry or asset policy.

#### Scenario: Owner opens canonical Preview through deployed Web ingress

- **WHEN** an Owner requests `/console/artifacts/{artifactId}/preview?versionId={versionId}` through a supported trusted-Web deployment
- **THEN** the Preview document response includes `Cache-Control: no-store` before the client application renders

#### Scenario: Owner opens legacy Preview during migration

- **WHEN** an Owner requests `/artifacts/{artifactId}/preview?versionId={versionId}` during the compatibility window
- **THEN** the legacy Preview document response also includes `Cache-Control: no-store` before replace navigation reaches the canonical path

### Requirement: Exclude Console and legacy management paths from indexing

Console, owner Preview, administration, and former management addresses MUST retain the shared client document's `noindex,nofollow` metadata. Canonical Console pages MUST NOT declare a public Website or Gallery canonical URL, and former management addresses MUST NOT declare themselves canonical before replace navigation.

#### Scenario: Crawler requests Console

- **WHEN** a crawler requests `/console` or a Console descendant
- **THEN** the hydrated document directs the crawler not to index or follow it and declares no public canonical URL

#### Scenario: Crawler requests a former management path

- **WHEN** a crawler requests a migration-only former management address
- **THEN** the address is not indexed or declared canonical before reaching its Console destination
