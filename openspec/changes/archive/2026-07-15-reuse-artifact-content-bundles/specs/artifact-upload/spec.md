# artifact-upload delta specification

## ADDED Requirements

### Requirement: Upload additional immutable Versions

The system SHALL let an Owner submit another Upload to an Artifact that already has a ready Version. Each successful non-idempotent Upload MUST create one new immutable Version and MUST NOT change an earlier Version or Publication implicitly.

#### Scenario: Owner uploads another Version

- **WHEN** an Owner submits a valid ZIP to an Artifact with a ready Version
- **THEN** the system creates a new Upload session and processing job and commits the next immutable Version after processing succeeds

#### Scenario: Equivalent content is uploaded again

- **WHEN** an Owner submits equivalent content with a different idempotency key
- **THEN** the system creates a distinct Version even when internal content storage is reused

#### Scenario: Later Version processing fails

- **WHEN** processing a later Upload fails
- **THEN** every earlier ready Version and current Publication remains unchanged and usable

## MODIFIED Requirements

### Requirement: Make initial creation idempotent

The system SHALL use the signed-in User, initial Artifact creation operation, and caller-supplied idempotency key to collapse repeated submissions into one durable result. The system SHALL compute a private canonical request identity from the trimmed Artifact name, requested Entry file, and complete ZIP while streaming. It MUST preserve replay comparison for the lifetime of the retained idempotency record without exposing or persisting a plain content-derived lookup digest.

#### Scenario: Caller repeats an accepted creation

- **WHEN** the same User repeats initial Artifact creation with the same idempotency key and equivalent canonical request input
- **THEN** the system returns the original operation result without creating another Artifact, Upload session, processing job, Version, or Share link

#### Scenario: Idempotency key is reused for different input

- **WHEN** the same User reuses an initial Artifact creation idempotency key with a different Artifact name, requested Entry file, or ZIP identity
- **THEN** the system rejects the conflicting reuse without changing the original result

### Requirement: Recover before the first ready Version

The Owner SHALL be able to Retry a recoverable processing failure against the retained raw ZIP or Replace file after a deterministic file failure. Retry and Replace file MUST be idempotent for their operation scope and caller-supplied idempotency key. A failed later Upload MAY be retried without mutating any earlier ready Version.

#### Scenario: Owner manually retries retained input

- **WHEN** automatic processing attempts are exhausted and the Owner selects Retry
- **THEN** the system queues a new processing attempt against the retained raw ZIP without creating another Artifact or Upload session

#### Scenario: Owner repeats manual Retry

- **WHEN** the Owner repeats the same manual Retry with the same idempotency key
- **THEN** the system returns the original Retry result and does not queue another effective processing attempt

#### Scenario: Owner replaces an invalid file

- **WHEN** deterministic validation fails and the Owner submits a replacement ZIP
- **THEN** the system creates a new Upload session for the same Artifact and processes the replacement under a new policy snapshot

#### Scenario: Owner repeats Replace file

- **WHEN** the Owner repeats Replace file with the same stable Artifact, idempotency key, requested Entry file, and private request identity
- **THEN** the system returns the original replacement result without creating another Upload session or processing job

#### Scenario: Owner retries a failed later Upload

- **WHEN** an Artifact has an earlier ready Version and its current later Upload is in a recoverable failed state
- **THEN** the system retries the retained current input without replacing or changing the earlier Version

### Requirement: Retain raw input needed for recovery

The system SHALL retain the raw ZIP referenced by the current retryable failed Upload session without a time-based expiry while that input remains eligible for Retry. Accepting Replace file SHALL make the replaced raw ZIP eligible for deletion. Committing a ready Version SHALL make that Upload's raw ZIP and attempt staging objects eligible for bounded cleanup. Reconciliation MUST NOT delete raw input referenced by the current retryable failed Upload session.

#### Scenario: Failed input remains retryable

- **WHEN** processing reaches a recoverable failed state
- **THEN** the current referenced raw ZIP remains available for manual Retry without a time-based expiry

#### Scenario: Replacement supersedes failed input

- **WHEN** the Owner successfully submits Replace file
- **THEN** the previously referenced raw ZIP becomes eligible for bounded Reconciliation cleanup

#### Scenario: Ready Version commits

- **WHEN** a ready Version commits atomically
- **THEN** that Upload's raw ZIP and attempt staging objects become eligible for bounded Reconciliation cleanup

#### Scenario: Orphan object has no database reference

- **WHEN** Reconciliation finds a raw or staging object that no Upload session or processing attempt references
- **THEN** it removes the orphan without changing a retryable Upload session
