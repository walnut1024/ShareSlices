# gallery-copy-download delta specification

## ADDED Requirements

### Requirement: Download the fixed Gallery Version without signing in

The system SHALL let signed-in and anonymous Viewers download an accessible Gallery listing without signing in. Download authorization MUST require lifecycle Listed, an effectively accessible review and Artifact-governance projection, and an eligible enabled Gallery deployment. A Gallery download MUST be a normalized ZIP containing exactly the fixed Version's committed Artifact files and paths. It MUST NOT return the original Upload archive, inject attribution or permission files into the Artifact, or include files outside the fixed Version's committed manifest. The trusted Gallery page and download response metadata SHALL present the applicable source and Gallery permission information.

#### Scenario: Anonymous Viewer downloads a listed Artifact

- **WHEN** an anonymous Viewer requests Download for a Listed Gallery listing that is not Restricted
- **THEN** the system authorizes the request and returns a normalized ZIP of that listing's fixed Version

#### Scenario: Download is assembled from normalized content

- **WHEN** the original Upload archive contained wrapper directories or ignored operating-system metadata that are absent from the fixed Version
- **THEN** the Gallery download contains only the fixed Version's normalized committed paths and bytes

#### Scenario: Download does not alter executable content

- **WHEN** the system creates a Gallery download
- **THEN** the ZIP contains no injected attribution, permission, or ShareSlices metadata file and the trusted response carries the source and permission information separately

#### Scenario: Listing no longer authorizes new downloads

- **WHEN** a Viewer starts a new Download after the listing is Withdrawn, Removed, Restricted, subject to Artifact takedown, or otherwise effectively inaccessible
- **THEN** the system denies access without returning the fixed Version or an object-storage URL

### Requirement: Keep each Download consistent through listing changes

The system SHALL atomically authorize the Gallery listing, bind the immutable fixed Version, acquire a bounded active-download source-read lease, and accept the Download when a request begins. The lease MUST retain only that Version's committed manifest objects, MUST release exactly once when the stream finishes or aborts, and MUST abort the stream and release when its maximum duration is reached. The last release MUST let source cleanup resume. A concurrent listing update MUST produce either the complete previous fixed Version or the complete new fixed Version and MUST NOT mix their files. Gallery disablement, Withdrawal, Removal, Restriction, Artifact takedown, Artifact or account deletion, or deployment ineligibility after authorization MUST block later Downloads but MUST NOT interrupt the already authorized stream before its maximum duration or revoke a completed download.

#### Scenario: Listing updates while a Download begins

- **WHEN** Update Gallery commits concurrently with a Download authorization
- **THEN** the Download contains one complete committed Version selected before or after the update and never combines files from both Versions

#### Scenario: Listing closes during an authorized stream

- **WHEN** a Gallery listing becomes effectively inaccessible after its Download stream was authorized
- **THEN** the authorized stream can finish while every later Download request is denied

#### Scenario: Source is deleted during an authorized stream

- **WHEN** Artifact or source-account deletion closes management and public access after a Download acquired its source-read lease
- **THEN** deletion retains only the bound Version objects needed by that stream until finish, abort, or maximum duration and exposes them through no new route

#### Scenario: Active Download lease ends

- **WHEN** an authorized Download finishes, aborts, or reaches its maximum duration
- **THEN** the system releases its source-read lease exactly once and resumes deletion cleanup after the last remaining hold

#### Scenario: Viewer already completed a Download

- **WHEN** a Creator later updates, withdraws, or deletes the source Artifact, or the platform later Removes the listing
- **THEN** ShareSlices does not claim to revoke or mutate the ZIP already held by the Viewer

### Requirement: Rate-limit Download independently from Creator quotas

The system SHALL apply anonymous-source rate limits to Gallery downloads and MUST NOT charge another Viewer's download traffic against the Creator's Artifact or storage product quotas.

#### Scenario: Anonymous source exceeds the Download limit

- **WHEN** an anonymous source exceeds the applicable Gallery Download rate limit
- **THEN** the system rejects additional Download attempts without changing the Gallery listing or charging the Creator's product quotas

#### Scenario: Multiple Viewers download one listing

- **WHEN** multiple permitted Viewers Download the same Gallery listing
- **THEN** the Creator's Artifact and storage quota usage remains unchanged by those Downloads

### Requirement: Create a saved copy asynchronously inside the Copier ownership boundary

The system SHALL require a signed-in User to Save a copy and SHALL execute the copy as an asynchronous Server operation. Before consuming a new-copy rate-limit unit or reserving quota, acceptance MUST atomically verify a publicly eligible Listed current revision. A successful acceptance MUST bind that listing revision and fixed-Version snapshot, consume the rate-limit unit, reserve quota, acquire one durable source-retention reference, and create one durable copy job in the same serialization boundary. Source deletion MUST serialize with this boundary so deletion that wins first leaves no accepted operation or reference, while acceptance that wins first retains the fixed source objects for the job. An inaccessible source MUST follow the generic public response and create no job, source reference, reservation, rate-limit charge, or source-existence signal. A successful operation SHALL create one independently owned Artifact, one immutable Version, and one complete Content bundle inside the Copier's ownership boundary. It MUST NOT reuse the Creator's Content bundle across Users, and the new Artifact MUST start without a Publication, Share link, or Gallery listing. Processing MUST NOT expose a partial Artifact Version or cross-User Content bundle.

#### Scenario: Anonymous Viewer selects Save a copy

- **WHEN** a Viewer without a valid management Session selects Save a copy
- **THEN** the system requires sign-in and creates no copy operation, Artifact, Version, or Content bundle

#### Scenario: Signed-in User starts Save a copy

- **WHEN** a signed-in User confirms Save a copy for an accessible Gallery listing
- **THEN** the system accepts one asynchronous operation bound to that listing's fixed Version without reporting a ready copied Artifact

#### Scenario: Source becomes inaccessible before acceptance

- **WHEN** a closure, restriction, takedown, or eligibility loss wins before Save-a-copy acceptance commits
- **THEN** the system returns the generic inaccessible response and consumes no rate-limit unit, quota reservation, source-retention reference, copy job, or existence-revealing resource

#### Scenario: Source deletion races Save-a-copy acceptance

- **WHEN** source-Artifact deletion and Save-a-copy acceptance race for the same fixed Version
- **THEN** they serialize so deletion first creates no operation or source-retention reference, while acceptance first atomically acquires the reference and the accepted job can continue from the retained snapshot

#### Scenario: Copy processing succeeds

- **WHEN** the asynchronous copy operation commits successfully
- **THEN** the Copier receives one independently owned ready Artifact and Version backed by a Copier-owned Content bundle with no active link sharing or Gallery listing

#### Scenario: Equivalent content already exists under another User

- **WHEN** the Copier saves content equivalent to the Creator's or another User's Content bundle
- **THEN** the system creates or safely reuses a complete Content bundle only within the Copier's ownership boundary and exposes no cross-User reuse decision

#### Scenario: Copy processing does not complete

- **WHEN** processing fails, is cancelled, or its durable result is indeterminate
- **THEN** the system reports only confirmed operation state and resources and does not expose partial copied content as a ready Artifact or Version

### Requirement: Enforce Copier quotas before accepting Save a copy

The system SHALL check and reserve the Copier's applicable Artifact and storage quotas before accepting Save a copy. It MUST reject acceptance when either quota is insufficient, including under concurrent copy attempts. Ready commit MUST convert the reservation into authoritative usage. Terminal failed or cancelled work MUST release it after partial-object cleanup. An indeterminate result MUST retain the reservation until reconciliation proves ready, failed, or cancelled and MUST expose that held state to authenticated management without counting it twice. The original Creator MUST NOT pay Artifact count, storage, or processing product quota for another User's copy.

#### Scenario: Copier has sufficient quota

- **WHEN** a signed-in User confirms Save a copy and has sufficient Artifact and storage quota for the fixed Version
- **THEN** the system reserves the applicable Copier quota and accepts the asynchronous copy operation

#### Scenario: Copier lacks Artifact quota

- **WHEN** the Copier has no remaining Artifact quota
- **THEN** the system rejects Save a copy before acceptance and creates no copy operation or copied resource

#### Scenario: Copier lacks storage quota

- **WHEN** the fixed Version would exceed the Copier's available storage quota
- **THEN** the system rejects Save a copy before acceptance and creates no copy operation or copied resource

#### Scenario: Concurrent copies compete for remaining quota

- **WHEN** concurrent Save a copy requests would together exceed the Copier's remaining quota
- **THEN** the system accepts only the operations covered by an authoritative quota reservation and rejects the rest

#### Scenario: Ready copy commits reserved quota

- **WHEN** a copy job atomically commits its ready Artifact, Version, Content bundle, and provenance
- **THEN** the system converts that operation's reservation into Copier usage exactly once

#### Scenario: Failed or cancelled copy releases reserved quota

- **WHEN** reconciliation proves that a copy job is terminally failed or cancelled and its partial destination objects are removed
- **THEN** the system releases that operation's quota reservation exactly once

#### Scenario: Copy result remains indeterminate

- **WHEN** the system cannot yet prove whether copy commit succeeded
- **THEN** it keeps the reservation held until reconciliation reaches a proven terminal result and does not accept conflicting usage against it

### Requirement: Name the independent copy for its new Owner

The system SHALL default a copied Artifact's name from the source Gallery title, SHALL let the Copier change that name before confirmation and through ordinary Artifact management after completion, and MUST NOT require the name to be unique.

#### Scenario: Copier accepts the default name

- **WHEN** the Copier confirms Save a copy without changing the proposed name
- **THEN** the copied Artifact uses the source Gallery title as its owner-facing Artifact name

#### Scenario: Copier supplies another name

- **WHEN** the Copier enters a valid different Artifact name before confirming Save a copy
- **THEN** the copied Artifact uses that name without changing its Source attribution

#### Scenario: Copier already has an Artifact with the same name

- **WHEN** the default or selected copied Artifact name duplicates another name owned by the Copier
- **THEN** the system permits the duplicate name because Artifact identity does not depend on it

### Requirement: Rate-limit new Save a copy operations per Copier account

The system SHALL apply a dedicated per-account rate limit before accepting a new Save a copy operation. This abuse limit SHALL remain independent from Artifact and storage quotas. Replaying equivalent input with an already accepted idempotency key MUST return the original operation without consuming another rate-limit unit, while a different idempotency key MAY intentionally create another independent copy when rate limits and quotas permit. A rate-limit rejection MUST create no copy job, Artifact, Version, Content bundle, or quota reservation and MUST NOT charge the source Creator.

#### Scenario: Copier exceeds the account rate limit

- **WHEN** a signed-in User requests a new Save a copy operation after exceeding the account's applicable copy rate limit
- **THEN** the system rejects the request with retry evidence and creates no copy operation, resource, or quota reservation

#### Scenario: Copier safely replays an accepted request

- **WHEN** a signed-in User repeats equivalent Save a copy input with the idempotency key of an already accepted operation
- **THEN** the system returns the original operation without consuming another rate-limit unit or reserving quota again

#### Scenario: Copier intentionally saves the same listing again

- **WHEN** a signed-in User supplies a different idempotency key for the same accessible listing and remains within account rate limits and quotas
- **THEN** the system may accept another independently owned Artifact without treating the earlier copy as a naming or content-identity conflict

### Requirement: Preserve Source attribution across copy generations

The system SHALL store immutable Source attribution for each saved copy that identifies the immediate source Gallery listing and fixed Version and preserves the root source Gallery listing, root fixed Version, and original Creator. Ordinary Artifact management MUST NOT remove or replace this attribution. When a saved copy is later shared to Gallery, its listing SHALL show the current Creator and state that it is based on the original Creator without exposing private lineage identifiers.

#### Scenario: User saves the original listing

- **WHEN** Save a copy completes from a Creator's Gallery listing
- **THEN** the copy records that listing and its fixed Version as both immediate and root source and records that listing's Creator as the original Creator

#### Scenario: A copy is shared and copied again

- **WHEN** a second User saves a copy from a Gallery listing created from an earlier saved copy
- **THEN** the new copy records the newer listing and Version as its immediate source while preserving the first copy generation's root listing, root Version, and original Creator

#### Scenario: Copier manages the new Artifact

- **WHEN** the Copier renames, uploads a later Version to, shares with link, or shares the copied Artifact to Gallery
- **THEN** its immutable Source attribution remains attached and the Gallery projection identifies the current Creator as based on the original Creator

### Requirement: Resolve source-lifecycle races for accepted copy jobs

An accepted Save-a-copy job SHALL continue from its immutable accepted snapshot after a source Owner updates or withdraws the listing, deletes the source Artifact, or deletes a distinct source Creator account. If the source Creator and Copier are the same account, Copier-account deletion precedence applies instead so no job can create an ownerless destination. Acceptance MUST create one durable source-retention reference for that job in the same serialization boundary as effective-access verification, snapshot binding, rate-limit consumption, quota reservation, and job creation. Source-Artifact deletion MUST retain only the committed source objects whose liveness count remains nonzero and MUST keep them unavailable through management and public routes. Ready, failed, or cancelled terminal reconciliation MUST release that job's reference exactly once; an indeterminate job keeps its reference. Releasing the last reference SHALL resume the deleted source Artifact's object cleanup.

If an Administrator Removal, Artifact takedown, Public-sharing restriction, Gallery disablement, deployment ineligibility, or Copier-account deletion becomes effective before the copy is ready, that block and ready commit MUST serialize so exactly one wins. A block or Copier-account deletion that wins first SHALL cancel the job, prevent ready commit, clean partial destination objects, and release quota and the source-retention reference. Ready commit that wins first SHALL produce a completed independent copy; content governance SHALL then use immutable provenance to apply the matching-copy rule, while Copier-account deletion SHALL include the committed copy in ordinary account cleanup. A cancelled job MUST remain a durable terminal outcome and MUST NOT later retry to ready or leave an ownerless resource.

#### Scenario: Source Owner updates or withdraws after acceptance

- **WHEN** the source Owner updates or withdraws the listing after Save a copy was accepted but before the copy is ready
- **THEN** the job continues against its accepted listing revision and fixed-Version snapshot without reading the replacement revision

#### Scenario: Source Artifact is deleted during processing

- **WHEN** the source Owner deletes the Artifact after Save a copy was accepted but before the copy is ready
- **THEN** management and public access close while the system retains the referenced committed source objects internally until the accepted job reaches a proven terminal state

#### Scenario: Multiple accepted jobs retain one deleted source

- **WHEN** a deleted source Artifact has multiple accepted copy jobs and one reaches a terminal result
- **THEN** the system releases only that job's reference and retains each source object still required by another non-terminal job

#### Scenario: Last source-retention reference is released

- **WHEN** ready, failed, or cancelled reconciliation releases the last reference for a deleted source Artifact
- **THEN** the system resumes source-object cleanup exactly once even if the terminal result is delivered again

#### Scenario: Distinct source Creator account is deleted during processing

- **WHEN** the source Creator account differs from the Copier account and is deleted after Save a copy was accepted but before the copy is ready
- **THEN** the job continues against its accepted content snapshot and computes public attribution from the preserved root-Creator identity rather than assuming the immediate source Creator was the original Creator

#### Scenario: Deleted source Creator is the root Creator

- **WHEN** the deleted distinct source Creator matches the preserved root Creator
- **THEN** the resulting attribution uses `Original Creator unavailable` without retaining or exposing deleted account data

#### Scenario: Deleted source Creator is not the root Creator

- **WHEN** a descendant copy's deleted immediate source Creator differs from its still-available preserved root Creator
- **THEN** the resulting attribution continues to identify the surviving original Creator and does not replace it with `Original Creator unavailable`

#### Scenario: Self-copy account is deleted during processing

- **WHEN** the source Creator and Copier are the same account and that account is deleted before the copy commits ready
- **THEN** Copier-account deletion cancels and cleans the job through the destination-ownership rule instead of continuing into a deleted ownership boundary

#### Scenario: Platform governance wins before ready commit

- **WHEN** Administrator Removal, Artifact takedown, or Public-sharing restriction becomes effective before the accepted copy commits ready
- **THEN** the system durably cancels the copy, prevents later ready commit, cleans partial destination objects, and releases the Copier's reservation

#### Scenario: Gallery eligibility is lost before ready commit

- **WHEN** Gallery disablement or deployment ineligibility becomes effective before the accepted copy commits ready
- **THEN** the system durably cancels the copy through the same cleanup, quota-release, and source-reference-release path

#### Scenario: Copier account deletion wins before ready commit

- **WHEN** Copier-account deletion serializes before the accepted copy commits ready
- **THEN** the system cancels the job, cleans partial destination objects, releases quota and source reference, and creates no Artifact in the deleted ownership boundary

#### Scenario: Ready commit wins before Copier account deletion

- **WHEN** the copy commits ready before a racing Copier-account deletion
- **THEN** account deletion treats the new Artifact, Version, Content bundle, provenance, and quota usage as ordinary Copier-owned resources and leaves no orphaned copy

#### Scenario: Ready commit wins before platform governance

- **WHEN** the copy commits ready before a racing Administrator Removal, Artifact takedown, or Public-sharing restriction becomes effective
- **THEN** the completed copy remains independently owned and any content-level governance propagation evaluates it through immutable provenance

### Requirement: Keep completed copies independent from the source lifecycle

The system MUST NOT mutate or delete a completed independent copy when its source listing is updated or withdrawn, its source Artifact is deleted, or its original Creator account is deleted. This independence does not exempt a provenance-matching copy from a later content-level takedown or Public-sharing restriction. A closed or effectively inaccessible source listing SHALL reject new Save a copy operations. When the original Creator account is deleted, public attribution on existing copies SHALL display `Original Creator unavailable` and MUST NOT expose the former profile, email, or sign-in data.

#### Scenario: Source listing changes after copy completion

- **WHEN** the Creator updates or withdraws the source listing after another User's copy is ready
- **THEN** the copied Artifact and Version remain unchanged and independently manageable by the Copier

#### Scenario: Source Artifact is deleted

- **WHEN** the Creator deletes the source Artifact after a copy is ready
- **THEN** the copy remains available while the retired source listing URL authorizes no new Save a copy or Download operation

#### Scenario: Original Creator account is deleted

- **WHEN** the original Creator account is deleted after copies exist
- **THEN** those copies remain available and their public attribution becomes `Original Creator unavailable` without linking to or exposing the deleted Creator profile or sign-in data

#### Scenario: Viewer attempts to copy a closed source

- **WHEN** a Viewer requests Save a copy from a Withdrawn, Removed, Restricted, taken-down, or otherwise effectively inaccessible listing
- **THEN** the system denies the request and creates no copy operation or copied resource

### Requirement: Make Save a copy idempotent and report durable outcomes honestly

The system SHALL scope Save a copy idempotency to the signed-in User, operation, and caller-supplied idempotency key. It SHALL store a normalized target-and-input fingerprint with each accepted key. New or unknown-key acceptance MUST authorize the current public listing and follow its `404`, `410`, or pre-lookup `503` response. Authenticated replay of equivalent input with an already accepted key SHALL return the same durable operation and result even after source closure, governance restriction, Gallery disablement, or deployment ineligibility; this operation read MUST NOT grant new source access. Reusing the key for different listing, fixed Version, or selected name input MUST return an idempotency conflict without executing another mutation. Operation outcomes MUST distinguish accepted, processing, ready, failed, cancelled, and indeterminate state and MUST report only confirmed resources and quota-reservation state.

#### Scenario: Copier repeats an accepted request

- **WHEN** the same User repeats equivalent Save a copy input with the same idempotency key
- **THEN** the system returns the original operation state and result without consuming another account rate-limit unit, reserving quota again, or creating another Artifact, Version, or Content bundle

#### Scenario: Copier replays after the source closes

- **WHEN** the same User repeats equivalent input with an accepted idempotency key after the source becomes inaccessible or Gallery becomes unavailable
- **THEN** authenticated operation recovery returns only the original durable state and result without reauthorizing the listing or exposing its current metadata

#### Scenario: Copier reuses a key for different input

- **WHEN** the same User reuses a Save a copy idempotency key for a different listing, fixed Version, or selected Artifact name
- **THEN** the system rejects the conflicting reuse without changing the original operation

#### Scenario: Ready outcome is reported

- **WHEN** the copied Artifact, Version, Content bundle, quota accounting, and Source attribution are durably committed
- **THEN** the operation reports ready with exactly those confirmed copied resources

#### Scenario: Cancelled outcome is reported

- **WHEN** governance or reconciliation durably cancels a non-terminal copy and cleanup and quota release complete
- **THEN** the operation reports cancelled without a ready Artifact or Version and cannot later transition to ready

#### Scenario: Result is indeterminate

- **WHEN** the Server cannot prove whether a mutating copy attempt committed
- **THEN** the operation reports indeterminate with only known durable resources and the held reservation state and requires reconciliation or state inspection before replay
