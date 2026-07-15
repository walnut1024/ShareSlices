# artifact-content-reuse Specification

## Purpose

TBD - created by archiving change reuse-artifact-content-bundles. Update Purpose after archive.

## Requirements

### Requirement: Reuse complete Content bundles only within one User

The system SHALL reuse a complete validated and normalized Content bundle only among Versions owned by the same User. It MUST NOT reuse a Content bundle across Users and MUST NOT expose whether another User or Version has equivalent content.

#### Scenario: Same User uploads equivalent normalized content

- **WHEN** one User completes two non-idempotent Uploads whose ZIP bytes differ but whose normalized Entry file and assets are identical under the same content-identity revision
- **THEN** the system creates two immutable Versions that reference one ready Content bundle

#### Scenario: Different Users upload equivalent content

- **WHEN** two Users upload equivalent raw or normalized content
- **THEN** each User receives an independently owned Content bundle and neither response exposes the other Upload or any reuse decision

#### Scenario: Entry file differs

- **WHEN** two otherwise identical normalized file sets select different Entry files
- **THEN** the system treats them as different Content bundle identities

### Requirement: Prefer safe reuse and fall back to full processing

The system SHALL receive the complete Upload before considering reuse. It SHALL use exact raw-input reuse only when private fingerprint, requested Entry file, policy, processing, content-identity, validation-evidence, ownership, lifecycle, and integrity conditions match. A miss or unverifiable candidate MUST follow full validation and normalized-content processing without becoming an Artifact validation error.

#### Scenario: Exact raw input has compatible evidence

- **WHEN** one User uploads exact raw input that has an active compatible alias to a ready healthy Content bundle
- **THEN** the system commits a new Version using the prior immutable validation evidence without expanding or validating the archive again

#### Scenario: Raw evidence is incompatible

- **WHEN** a raw-input alias is missing compatible policy, processing, identity, Entry file, or validation evidence
- **THEN** the system performs full processing and does not expose the fallback as an Upload failure

#### Scenario: Normalized content matches after validation

- **WHEN** a raw miss passes current validation and its canonical normalized identity matches a ready healthy Content bundle owned by the User
- **THEN** the system reuses the bundle, commits a distinct Version, and removes the losing attempt objects

### Requirement: Resolve concurrent Content bundle creation atomically

The system SHALL reserve canonical Content bundle identity with an active unique private alias. Concurrent equivalent attempts MUST produce at most one ready bundle for the User and identity revision, while each successful non-idempotent Upload still commits its own Version.

#### Scenario: Equivalent attempts race

- **WHEN** two Workers concurrently finish normalization for equivalent Uploads owned by one User
- **THEN** one creating bundle wins, both successful Uploads commit distinct Versions referencing the ready winner, and every losing prefix is scheduled for cleanup

#### Scenario: Creating owner expires

- **WHEN** a creating bundle's creator Lease expires before ready publication
- **THEN** a later attempt can take over with a new attempt prefix and the expired creator cannot publish winner metadata

### Requirement: Quarantine an inconsistent Content bundle

The system SHALL make reuse conditional on ready lifecycle, healthy integrity, and active aliases. Confirmed missing objects, checksum mismatches, or inconsistent bundle metadata MUST atomically mark the bundle suspect or corrupt and retire its active aliases before replacement processing.

#### Scenario: Bundle inconsistency is confirmed

- **WHEN** a reusable candidate has a confirmed missing object, checksum mismatch, or structurally inconsistent Manifest
- **THEN** the system blocks new references to it, retires its active aliases, and allows full processing to create a healthy replacement

#### Scenario: Existing Version references quarantined content

- **WHEN** a bundle becomes suspect or corrupt after Versions already reference it
- **THEN** the system preserves those immutable references and uses explicit incident behavior instead of silently redirecting them

### Requirement: Delete Content bundles after their final Version reference

The system SHALL derive Content bundle liveness from Version relationships. Deleting one Artifact MUST preserve a shared bundle while another Version references it. Removing the final reference MUST retire aliases, cancel bundle work, and create durable idempotent cleanup before bundle metadata is removed.

#### Scenario: One of multiple references is deleted

- **WHEN** an Artifact deletion removes a Version reference from a bundle that another Version still references
- **THEN** the remaining Version can still Preview, Publish, view, export, and read its thumbnail

#### Scenario: Final reference is deleted

- **WHEN** Artifact deletion removes the final Version reference to a bundle
- **THEN** the bundle becomes unavailable for reuse and Reconciliation eventually removes its Manifest, assets, thumbnails, aliases, attempts, and metadata

#### Scenario: Stale writer creates a late object

- **WHEN** an expired or cancelled attempt writes under its registered prefix after an earlier cleanup pass
- **THEN** a later bounded orphan scan removes the unreferenced object without affecting a ready bundle

### Requirement: Keep reuse internals private and observable in aggregate

The system MUST NOT expose Content bundle IDs, private fingerprints, object keys, reuse-hit state, or content-derived values through management or Viewer contracts, logs, or per-User metrics. It SHALL emit stable internal outcome and fallback reason codes and aggregate avoided work without exposing content identity.

#### Scenario: Client inspects Upload and Version responses

- **WHEN** an Upload is a raw hit, normalized hit, or miss
- **THEN** the public response shape contains only the ordinary Artifact, Upload, Version, processing, and validation fields

#### Scenario: Operator reviews aggregate reuse metrics

- **WHEN** reuse outcomes are recorded
- **THEN** aggregate metrics can report avoided expansion, writes, rendering, latency, and cleanup backlog without fingerprints, paths, object keys, or User-level content identity
