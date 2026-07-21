# deployment-orchestration Delta Specification

## ADDED Requirements

### Requirement: Select exactly one deployment target

The Deployment Module SHALL require every production deployment configuration to select exactly one target, `kubernetes` or `cloudflare`. It MUST accept only the runtime fields belonging to the selected target and MUST reject a configuration that attempts to compose Kubernetes workloads with Cloudflare Workers, Queues, R2, or Containers as one installation.

An external CDN configured under the Kubernetes target SHALL remain an ingress option for that Kubernetes installation and MUST NOT select or require the Cloudflare runtime target.

#### Scenario: Select the Kubernetes target

- **WHEN** a deployment configuration selects `kubernetes` and contains only shared and Kubernetes-target fields
- **THEN** validation accepts the configuration and every planned application runtime belongs to the Kubernetes target

#### Scenario: Select the Cloudflare target

- **WHEN** a deployment configuration selects `cloudflare` and contains only shared and Cloudflare-target fields
- **THEN** validation accepts the configuration and every planned application runtime belongs to the Cloudflare target

#### Scenario: Reject a mixed runtime composition

- **WHEN** a deployment configuration selects `kubernetes` but also requests Cloudflare Workers, Queues, R2, or Containers as ShareSlices runtime components
- **THEN** validation fails before target mutation and identifies the conflicting target fields

#### Scenario: Enable an external CDN for Kubernetes

- **WHEN** a Kubernetes deployment configures an external CDN in front of its public ingress
- **THEN** the deployment remains a Kubernetes target and does not plan the Cloudflare target's application runtime components

### Requirement: Exclude Docker Compose from the production deployment lifecycle

The production deployment schema and lifecycle SHALL accept only `kubernetes` and `cloudflare`. They MUST NOT accept Docker Compose as a production target, expose a Compose apply or rollback operation, or treat local-stack evidence as production qualification.

The separate `local-development-stack` capability owns the canonical local commands, origins, readiness, data retention, and test-isolation behavior. The Deployment Module MAY consume provider-neutral verification evidence produced through that topology, but provider-only checks MUST report `not_applicable` with stable reasons and MUST NOT qualify either production target.

#### Scenario: Attempt to select Compose for production

- **WHEN** a production deployment configuration sets `target` to `compose` or requests a Compose apply operation
- **THEN** validation rejects the request before rendering or mutation and identifies `kubernetes` and `cloudflare` as the only supported production targets

#### Scenario: Interpret evidence from the local topology

- **WHEN** the Deployment Module receives shared-verifier evidence from the canonical or isolated Compose topology
- **THEN** it accepts only the provider-neutral rows, records provider-only rows as `not_applicable`, and emits no Kubernetes or Cloudflare qualification result

### Requirement: Expose one automation-ready deployment lifecycle

The Deployment Module SHALL expose non-interactive `doctor`, `render`, `plan`, `apply`, `status`, `verify`, and `rollback` operations for both targets. Every operation SHALL provide a machine-readable result containing the selected target, requested release identity, outcome, and stable reason information for any warning, refusal, or failure.

`doctor` SHALL validate target prerequisites and configuration. `render` SHALL produce the complete desired release representation. `plan` SHALL compare that desired release with observed target state. `apply` SHALL converge release-owned resources in their declared order. `status` SHALL report observed state. `verify` SHALL exercise the deployed contract. `rollback` SHALL restore a compatible prior application release without reversing database migrations.

When a target explicitly delegates reconciliation to an external owner, `apply` or `rollback` SHALL stop at the target's immutable handoff boundary, return the stable outcome `external_reconciler_required`, and MUST NOT claim convergence. Only observation of the requested release and every required phase gate MAY advance status to converged. This exception does not authorize the Deployment Module to write an external Git repository or assume ordering behavior from an unspecified reconciler.

`doctor`, `render`, `plan`, and `status` MUST NOT mutate the deployment target or ShareSlices application data.

#### Scenario: Inspect a deployment without mutation

- **WHEN** an operator runs `doctor`, `render`, `plan`, or `status`
- **THEN** the operation returns its machine-readable result without changing target resources or ShareSlices application data

#### Scenario: Detect a missing prerequisite

- **WHEN** `doctor` cannot access a required target capability or externally supplied dependency
- **THEN** it returns a failed result identifying the unmet prerequisite without creating application resources

#### Scenario: Run the complete release lifecycle

- **WHEN** automation invokes the lifecycle operations for a valid release and target
- **THEN** each operation uses the same target and release identity and returns an outcome that automation can evaluate without parsing human prose

### Requirement: Use immutable release bundles

The Deployment Module SHALL render an immutable release bundle before planning or applying a release. The bundle MUST identify the source revision, selected target, target artifact digests, ordered migration identifiers and checksums, runtime and schema compatibility range, deployment-contract version, configuration digest, and public-route contract digest.

A release bundle MUST record a content digest for every built artifact and the provider identity used to deploy it. The deployed provider identity SHALL use a digest when the selected target interface supports digest references. If a pinned provider interface accepts only tags, the bundle MAY use a release-scoped tag only when that tag is unique, never reused or overwritten, mapped to the recorded content digest, verifiable through the provider API, and retained for the rollback window. Provider-generated version identifiers SHALL be recorded as observed deployment identity without replacing the artifact content digest. Planning and application MUST refuse mutable, reused, missing, or unverifiable identities and MUST refuse to continue when recorded content no longer matches its digest.

#### Scenario: Render the same release twice

- **WHEN** the same validated configuration and immutable build artifacts are rendered twice
- **THEN** both renders produce the same release identity and equivalent release-bundle content

#### Scenario: Detect a changed artifact

- **WHEN** an artifact no longer matches the digest recorded in the release bundle
- **THEN** `plan` and `apply` refuse the release before mutating target resources

#### Scenario: Attempt to deploy a mutable image identity

- **WHEN** a release identifies a deployed image only by a reusable or unverifiable tag
- **THEN** release validation fails and reports that both immutable content identity and a qualified provider deployment identity are required

#### Scenario: Provider accepts only unique image tags

- **WHEN** a pinned provider interface cannot deploy a Container by digest but can verify a never-reused release tag whose bytes match the recorded content digest
- **THEN** release validation accepts the qualified tag as provider identity while retaining the content digest as artifact identity

### Requirement: Apply releases with idempotent behavior and report observed state

The Deployment Module SHALL make `apply` idempotent for one target and release identity. Reapplying an already converged release MUST NOT repeat completed schema migrations, replace healthy components solely to create a new attempt, or create duplicate release-owned resources.

Every mutating operation SHALL consume the exact authorized plan digest and observed-state revision that it intends to execute. A first-installation plan SHALL include the observed absence and expected checksum of the deployment-control schema; its one atomic bootstrap transition and resulting first control-state revision are part of that authorized plan rather than unplanned drift. After acquiring the operation lease, the operation SHALL re-observe the target and MUST refuse mutation when any other drift changes a planned precondition, ownership fact, or security-sensitive outcome. The operator or automation must produce and authorize a new plan before continuing.

Every apply and rollback attempt SHALL create or update a Secret-free deployment record containing the desired release, previously observed release, ordered phase outcomes, migration outcome, component rollout outcomes, verification outcome, and compatible rollback candidate. Each mutating operation SHALL acquire a durable operation lease with a monotonically increasing fencing token, renew it while active, and revalidate it before every target mutation. A database session lock MAY serialize lease acquisition but MUST NOT be the sole guard for a long-running release. Losing the lease SHALL stop subsequent mutations, and target records or conditional writes SHALL reject a stale fencing token.

The authoritative operation lease, fencing sequence, and phase journal SHALL live in an application-owned deployment-control schema in the externally supplied PostgreSQL database, which exists before either target mutates provider resources. On a first installation where that schema is absent, the Deployment Module MAY perform one narrowly bounded bootstrap transaction: one checked-out direct PostgreSQL connection acquires a deterministic advisory lock, verifies absence, installs the fixed checksum-verified control schema, and creates the initial fencing state atomically. This is the only mutation permitted before a durable lease exists; it MUST NOT change product tables or provider resources. After the transaction commits, the operation SHALL acquire the durable lease before any later database, Kubernetes, Cloudflare, or IaC mutation. A failed or ambiguous bootstrap MUST leave provider state untouched and require observed PostgreSQL reconciliation before retry.

`status` SHALL distinguish desired state, observed state, handed-off state, partial convergence, failed convergence, verification state, out-of-band drift, and orphaned release-owned resources. It MUST NOT report a release as converged when a required phase is failed or indeterminate.

Every target bundle SHALL contain a release inventory and ownership markers. After a replacement release is verified, `apply` MAY retire superseded release-owned workloads in the declared order: remove public routing or scheduling, verify that the route cannot be reached or that the provider control plane is detached and its required safety window has elapsed, then scale down or remove only resources whose ownership and rollback-retention status are proven. It MUST NOT delete external prerequisites, durable product data, or a retained rollback artifact. An unknown or unowned orphan SHALL be reported for reviewed recovery rather than deleted automatically.

#### Scenario: Reapply a converged release

- **WHEN** `apply` is invoked again with the release already observed as healthy
- **THEN** it reports the release as converged without rerunning its migration or replacing healthy components

#### Scenario: Bootstrap deployment coordination on first installation

- **WHEN** a new installation has the required external PostgreSQL database but no deployment-control schema
- **THEN** the Deployment Module atomically installs the fixed checksum-verified schema under the deterministic advisory lock, acquires its first durable lease, and performs no provider mutation until that lease exists

#### Scenario: Coordination bootstrap is indeterminate

- **WHEN** the first-installation bootstrap connection fails before the Deployment Module can prove whether the transaction committed
- **THEN** it re-observes and reconciles the PostgreSQL control schema under the same lock before retrying and does not mutate either production target meanwhile

#### Scenario: Target drifts after plan authorization

- **WHEN** observed target state changes after a plan is authorized but before `apply` performs its first mutation
- **THEN** `apply` refuses the stale plan digest, records the changed precondition, and requires a new plan instead of silently adapting the authorized operation

#### Scenario: A rollout phase fails

- **WHEN** a required component fails after an earlier phase has completed
- **THEN** the deployment record preserves each confirmed phase outcome and `status` reports partial or failed convergence rather than success

#### Scenario: Target state drifts after deployment

- **WHEN** an owned component's observed digest or configuration differs from the applied release bundle
- **THEN** `status` reports the desired and observed identities and classifies the deployment as drifted

#### Scenario: Deployment process loses its operation lease

- **WHEN** a mutating deployment process loses its lease or presents a stale fencing token after another operation takes ownership
- **THEN** it performs no later target mutation and status preserves the confirmed phase outcomes for safe resume or recovery

#### Scenario: A superseded release leaves an owned workload

- **WHEN** a verified release no longer needs a workload owned exclusively by the previous release
- **THEN** the Deployment Module first removes its traffic or schedule, verifies inactivity, and retires it only when the inventory proves that rollback and durable state remain intact

#### Scenario: An orphan has no trusted ownership marker

- **WHEN** target discovery finds a potentially related resource that is absent from the release inventory or lacks a valid ownership marker
- **THEN** `status` reports the orphan and ordinary `apply` does not delete it

### Requirement: Protect Secrets and prerequisite ownership

Deployment configuration and release artifacts SHALL contain Secret references rather than Secret values. A runtime Secret reference SHALL also carry an operator-controlled, non-secret revision identifier whenever the referenced value can change in place. Secret resolution SHALL occur only through the selected target's Secret mechanism at the operation that needs access. A changed reference or revision SHALL roll only the consuming roles and SHALL be observable without hashing, storing, or disclosing the Secret value. `doctor`, `render`, `plan`, deployment records, machine-readable results, and logs MUST NOT disclose resolved credentials, tokens, private keys, connection strings, or other Secret values.

When a Secret is shared by producers and verifiers, online rotation SHALL preserve mixed-version validity. Verifiers SHALL accept old and new key revisions before producers issue with the new revision, and the old revision MUST remain accepted until the maximum token, grant, Session, and mixed-runtime lifetime expires. If the selected Secret mechanism cannot provide the required overlap, ordinary apply MUST refuse online rotation and require a separately authorized maintenance procedure.

The Deployment Module SHALL mutate only application resources declared as owned by its selected target Adapter. It MUST NOT create or delete the operator's cloud account, Kubernetes cluster, provider network, externally supplied PostgreSQL service, externally supplied object-storage account, or externally supplied email service. Missing or inaccessible prerequisites MUST fail before an application mutation that depends on them.

#### Scenario: Render configuration with Secret references

- **WHEN** valid deployment configuration refers to database, storage, and email Secrets
- **THEN** the rendered release and plan identify the references without containing their resolved values

#### Scenario: A required Secret is unavailable

- **WHEN** `doctor` cannot resolve or access a required Secret reference
- **THEN** it reports the missing reference without revealing other Secret values and without mutating target resources

#### Scenario: A Secret rotates in place

- **WHEN** an operator changes a Secret value under the same logical reference and advances its non-secret revision
- **THEN** the next release rolls and verifies only the consuming roles and records the revision without recording a value-derived fingerprint

#### Scenario: A plan includes prerequisite infrastructure

- **WHEN** target discovery finds an externally supplied cluster, network, database, object store, or email service
- **THEN** the plan treats that resource as a prerequisite and does not include its creation, replacement, or deletion

#### Scenario: Rotate a shared signing key online

- **WHEN** a release rotates a key used by one role to sign and another role to verify time-bounded capabilities
- **THEN** the plan stages dual verification before new signing, retains the old verification key for the declared maximum lifetime, and refuses the rotation when that overlap cannot be guaranteed

### Requirement: Require current recoverability evidence without conflating recovery and rollback

A production deployment configuration SHALL declare recoverability evidence for PostgreSQL, object storage, Infrastructure as Code state, immutable release bundles, and the deployment journal. Each evidence record MUST identify the responsible operator, encrypted storage location, retention policy, observation time, maximum evidence age, intended recovery point objective, and intended recovery time objective. `doctor` SHALL validate completeness and freshness without creating or modifying backups.

The release contract SHALL define a durable consistency marker that can be correlated between PostgreSQL state, committed object-storage state, and the recovery manifest for a known cut. An explicitly authorized recovery drill SHALL restore into an isolated environment, verify matching markers before serving traffic, and MUST fail closed when evidence is stale, a required source is missing, or database and object restore points cannot be proven compatible. Recovery MUST NOT be reported as application rollback.

#### Scenario: Recoverability evidence is stale

- **WHEN** a required evidence record is older than its configured maximum age or omits its owner, location, retention, or recovery objectives
- **THEN** `doctor` reports production recoverability unqualified without mutating the prerequisite

#### Scenario: Restored database and objects do not share a consistency marker

- **WHEN** an isolated recovery drill cannot correlate the restored PostgreSQL cut with the restored object-storage and recovery-manifest cut
- **THEN** verification fails closed and does not expose the restored installation to traffic

#### Scenario: Operator requests application rollback

- **WHEN** a compatible prior runtime release is selected without a disaster-recovery operation
- **THEN** rollback changes only application activation and does not claim to restore PostgreSQL, object storage, infrastructure state, release storage, or the deployment journal

### Requirement: Preserve runtime and schema compatibility during rollout and rollback

Each release SHALL declare compatibility between its database schema and both runtime release `N` and the immediately previous runtime release `N-1` for the supported rollout and rollback window. Every committed prefix of a multi-file migration sequence MUST remain compatible with the still-serving `N-1` runtime because a later migration file can fail after an earlier file commits. Migration validation MUST verify immutable checksums and ordered ancestry before application.

Only one migration execution SHALL advance the database for a release. The migration executor SHALL hold its advisory exclusion and each file transaction on one checked-out direct database connection. Runtime rollout MUST stop when that migration fails or when the release cannot demonstrate the declared `N` and `N-1` compatibility. `rollback` SHALL restore only a prior runtime release declared compatible with the observed schema and MUST NOT execute an automatic down migration. An incompatible rollback MUST be refused with the blocking schema and compatibility evidence. Destructive or contract migrations that cannot preserve the rollback window SHALL remain outside ordinary `apply` and require a separately reviewed maintenance procedure plus operator-provided restore-point evidence.

#### Scenario: Run mixed runtime versions during rollout

- **WHEN** release `N` has applied an expand-compatible migration and `N-1` instances remain during the rolling transition
- **THEN** both declared runtime versions operate against the observed schema until the rollout completes

#### Scenario: Migration execution fails

- **WHEN** the release migration fails or its checksum differs from the release bundle
- **THEN** application rollout stops and the deployment record reports the migration failure without marking the release converged

#### Scenario: A later migration file fails

- **WHEN** an earlier migration file committed but a later file in the same release fails
- **THEN** the previous runtime remains supported at the observed intermediate migration head and the release is not activated

#### Scenario: Roll back to a compatible runtime

- **WHEN** the prior release is declared compatible with the observed schema
- **THEN** `rollback` restores that runtime release without applying a database down migration

#### Scenario: Refuse an incompatible rollback

- **WHEN** the observed schema is outside the prior release's declared compatibility range
- **THEN** `rollback` makes no runtime or schema change and reports why automated rollback is unsafe

### Requirement: Verify one product contract across deployment targets

The Deployment Module SHALL maintain one versioned, machine-readable black-box verification projection for Kubernetes and Cloudflare deployments. Each route row SHALL reference its owning OpenAPI operation or documented route family, and each product-policy row SHALL reference its implemented OpenSpec requirement. Every row SHALL declare `core`, `pre_traffic`, or `deep` verification level. Core rows MUST be read-only. A pre-traffic or deep row that creates provider or product state, starts work, changes authorization, or sends mail MUST require explicit authorization, isolated positive ownership, bounded cleanup, and evidence that identifies the selected level. The projection MUST NOT redefine HTTP status, header, authorization, or cache semantics and MUST fail validation when it drifts from those authoritative owners. It SHALL cover configured route ownership, observable status behavior, credential boundaries, security headers, cache behavior, untrusted-content isolation, and enabled core product smoke flows.

A target Adapter SHALL supply target addresses and target-health observations to the shared verifier but MUST NOT waive a mandatory product-contract check because of target implementation differences. A capability explicitly disabled by deployment policy SHALL be verified as disabled or fail-closed rather than silently omitted. A release MUST NOT be marked verified while any mandatory check fails or remains indeterminate.

#### Scenario: Verify direct Kubernetes ingress

- **WHEN** `verify` runs against a Kubernetes deployment without an external CDN
- **THEN** the shared contract runs through the configured origin addresses and reports every mandatory check

#### Scenario: Verify Kubernetes through an external CDN

- **WHEN** `verify` runs against a Kubernetes deployment with an external CDN
- **THEN** the same product-contract checks run through the configured edge addresses without becoming Cloudflare-target-specific checks

#### Scenario: Verify the Cloudflare target

- **WHEN** `verify` runs against a Cloudflare deployment
- **THEN** the same mandatory core read-only checks run through its configured edge addresses with target-specific discovery limited to those addresses and health observations; stateful Cloudflare probes run only when their explicit pre-traffic or deep level was authorized

#### Scenario: Verify a disabled Gallery

- **WHEN** Gallery is explicitly disabled for a deployment
- **THEN** verification confirms its required fail-closed behavior and does not classify the Gallery contract as silently skipped
