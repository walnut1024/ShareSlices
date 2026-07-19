# account-entry Delta Specification

## MODIFIED Requirements

### Requirement: Durable and idempotent email delivery

An account request SHALL persist an authentication-email delivery before returning and MUST NOT send email inline. Repeated client submissions with the same idempotency key and concurrent delivery requests in the same waiting-period interval MUST produce at most one accepted delivery. A background dispatcher SHALL claim delivery records through expiring leases, record each outcome once, and use bounded provider retries.

The durable outcome model SHALL distinguish provider or transport acceptance from final inbox delivery. When an Adapter receives acceptance, it SHALL record a stable `provider_accepted` classification while preserving the cross-provider `sent` meaning of transport acceptance, and SHALL record a provider identifier only when that transport supplies one. A stable locally generated message identifier MAY be retained separately for reconciliation but MUST NOT be mislabeled as a provider identifier or deduplication guarantee. The backend MUST NOT infer delivered, bounced, or complaint state unless a separately specified provider-event contract supplies that evidence.

An unattempted pending delivery SHALL have no frozen transport snapshot. Its first dispatcher claim SHALL atomically freeze a non-secret transport-identity snapshot before the provider call. The snapshot SHALL include the Adapter kind, declared provider account/team or SMTP-relay namespace, sender/domain and endpoint identity, transport-configuration revision, serializer and provider-payload digest, logical provider idempotency key when supported, and stable local message identifier. Secret material SHALL remain a reference plus non-secret revision and MUST NOT be copied into the snapshot. Every automatic retry SHALL resolve to the same declared provider namespace and sender identity and SHALL reproduce the byte-equivalent provider payload. Credential rotation MAY continue an attempted delivery only when the configured rotation contract proves the replacement credential belongs to that same namespace with the same required sender/domain scope. Changing provider namespace, relay authority, sender identity, or Adapter after an attempt has begun MUST NOT silently migrate an attempted pending or indeterminate delivery; the operator SHALL keep the original Adapter usable until the delivery resolves or use manual reconciliation.

Each provider call SHALL have a durable attempt ID, fencing token, phase, and maximum call deadline. Before the first operation that may create an external side effect, the dispatcher SHALL persist the transition from prepared to submitting. For an Adapter with finite provider deduplication, that first transition SHALL also atomically persist one conservative `provider_safe_replay_until` cutoff derived from the local pre-send time, the pinned provider-retention contract, and a declared clock/transport safety margin. No retry, credential rotation, process restart, or configuration change may extend or recompute that cutoff. The dispatcher SHALL persist complete-submission/awaiting-final-acceptance evidence when known. An active fenced attempt MAY return to bounded automatic retry when durable evidence proves complete submission did not occur. A successor fenced attempt MAY instead replay an acceptance-indeterminate call only when the previous call is past its maximum deadline and safety margin with observed quiescence, current time remains strictly before the frozen cutoff, and the Adapter's qualified provider-deduplication contract still covers the frozen provider namespace, idempotency key, and byte-equivalent payload. The replay MUST remain the same logical delivery and MUST NOT weaken provider error classification. A process crash, lease loss, or expired attempt in a phase where submission may have occurred MUST otherwise be routed to manual reconciliation. Lease expiry alone MUST NOT be treated as provider-call quiescence, proof of failure, or authority to replay.

When a provider offers only a finite idempotency window, every retry before the frozen safe-replay cutoff SHALL reuse the same logical delivery ID, idempotency key, and byte-equivalent payload. At or after the cutoff, an unresolved network-indeterminate attempt SHALL enter a manual-reconciliation outcome and MUST NOT be blindly resent under a new key or under the old key after pretending the provider window restarted. When a transport such as SMTP offers no automatic deduplication contract, a failure before message submission MAY follow the bounded retry policy, but loss of the final response after the complete message has been submitted is acceptance-indeterminate and MUST enter manual reconciliation without automatic resend. A stable logical message identifier MAY aid operator evidence but MUST NOT be treated as provider deduplication. Local payload deletion and terminal-state rules remain authoritative for ShareSlices storage but MUST NOT be presented as control over provider-side retention.

Manual reconciliation SHALL be a non-public, explicitly authorized maintenance operation. Each invocation MUST present a versioned canonical, short-lived, single-use signed authorization envelope issued by an operator-controlled account-maintenance authority. Runtime configuration SHALL contain only its public verification material plus accepted issuer and installation-specific audience. The envelope SHALL bind the operator subject, installation, maintenance action, delivery ID, expected delivery revision, frozen transport-snapshot revision, attempt ID and fence, declared provider/relay namespace, sender identity, local message identifier, optional provider identifier, payload digest, finite-provider safe-replay cutoff when present, decision-and-evidence digest, nonce, issued-at time, and expiry. The operation SHALL derive the audit actor from the verified subject and SHALL reject an invalid issuer, audience, installation, signature, expiry, action, identity, digest, or replay rather than accepting free-form actor text or evidence from another delivery or transport.

An initial reconciliation SHALL run only for a delivery already fenced in the manual-reconciliation state, with no active dispatcher lease, after the recorded maximum provider-call deadline and safety margin, after attempt quiescence is observed, and, when finite provider deduplication applies, at or after the frozen safe-replay cutoff. One PostgreSQL transaction SHALL claim the authorization nonce through a uniqueness constraint, lock the delivery and associated verification or recovery material, validate the expected revision, attempt fence, frozen transport identity and cutoff, and evidence correlation, and serialize the resolution/audit write against dispatcher claims, code verification, and reset-grant issuance. A fresh-authorized idempotent repeat MAY inspect an already resolved delivery only when its signed action, decision, evidence digest, frozen identities, attempt fence, and expected current revision exactly match the recorded resolution; it follows the same nonce-claim and locking transaction but cannot enter the initial-resolution branch. Dispatcher claims SHALL refuse manual-reconciliation and resolved deliveries.

An accepted resolution SHALL transition the delivery to the existing `sent` state with `provider_accepted` classification and an optional provider identifier. An evidenced rejection SHALL transition it to the existing terminal `failed` state with `provider_rejected` classification. An unresolved closure SHALL transition it to `failed` with `acceptance_unresolved` classification. No resolution may create a parallel inbox-delivery state. The existing terminal payload-deletion policy applies to the resulting state. Reconciliation SHALL observe but MUST NOT expire, extend, recreate, or otherwise change an authentication code or reset grant; those materials remain governed by the existing verification, reuse, expiry, consumption, and circuit-breaker requirements.

The operation MUST record the operator identity, time, prior state, resolution, reason, and a redacted provider-evidence reference without revealing the raw address or message payload. Provider evidence MUST correlate with the signed installation, frozen namespace, sender, local message identifier, optional provider identifier, payload digest, attempt ID, and fence. An operator MAY resolve the delivery as provider-accepted only from correlated provider acceptance evidence, or as rejected only from correlated explicit rejection evidence. If neither can be proven, the operator MAY close it as unresolved. The operation MUST NOT itself send or enqueue email; a later permitted delivery begins through the ordinary protected account flow with a new logical delivery identity and reuses the existing active verification code when the implemented reuse requirement requires it. Repeating the recorded decision under a fresh valid authorization envelope SHALL atomically consume the fresh nonce and return the same result without modifying delivery or authentication material or creating a second resolution audit; it MAY append a separate invocation audit tied to that nonce. A conflicting decision, stale revision, stale fence, mismatched evidence, or reused authorization nonce SHALL be refused.

#### Scenario: Repeat one delivery request

- **WHEN** a client repeats a delivery request with the same idempotency key
- **THEN** the API returns the original accepted outcome and does not create another delivery

#### Scenario: Submit concurrent delivery requests

- **WHEN** concurrent requests target the same pending verification in one waiting-period interval
- **THEN** at most one delivery is accepted

#### Scenario: Retry a failed provider call

- **WHEN** a temporary provider failure occurs within the provider's safe retry window
- **THEN** the dispatcher retries with the same logical delivery identity and payload only when the fenced durable attempt proves complete submission did not occur, remains bounded, and does not retry a permanent rejection indefinitely

#### Scenario: Credential rotates within one provider namespace

- **WHEN** an attempted delivery retries after credential rotation
- **THEN** the dispatcher proceeds only when the replacement credential is proven to retain the frozen provider namespace and sender/domain scope, and otherwise leaves the delivery fenced for operator action without switching providers

#### Scenario: Provider namespace changes during an indeterminate delivery

- **WHEN** an attempted pending or indeterminate delivery's configuration points to another Resend team, SMTP relay authority, sender identity, or unproven namespace
- **THEN** automatic dispatch refuses to migrate or resend that delivery and preserves its frozen transport identity for resolution or manual reconciliation

#### Scenario: Configuration changes before the first attempt

- **WHEN** an unattempted pending delivery is first claimed after the deployment's email configuration changed
- **THEN** the same transaction freezes the then-current validated transport identity before the provider call, without pretending an earlier snapshot existed

#### Scenario: Executor fails near the provider side-effect boundary without live deduplication

- **WHEN** a process crashes, loses its lease, or expires after entering the durable submitting phase, complete submission cannot be disproven, and no qualified provider-deduplication window still covers the frozen request
- **THEN** the attempt becomes acceptance-indeterminate for manual reconciliation and is not returned to pending or automatically resent

#### Scenario: Provider-deduplicated replay remains safe

- **WHEN** an acceptance-indeterminate provider call is quiescent after its maximum deadline and safety margin, current time remains strictly before the frozen safe-replay cutoff, and the qualified provider contract covers the frozen namespace, key, and byte-equivalent payload
- **THEN** a successor fenced attempt may replay that same logical delivery under the bounded retry policy without changing its provider identity or creating a new delivery

#### Scenario: A retry approaches the provider-deduplication boundary

- **WHEN** clock skew, transport delay, or elapsed time reaches the conservative cutoff frozen before the first possible provider side effect
- **THEN** the dispatcher does not recompute or extend the provider window and routes an unresolved delivery to manual reconciliation without another automatic provider call

#### Scenario: Provider or transport accepts a delivery

- **WHEN** the selected email Adapter receives provider or transport acceptance
- **THEN** the dispatcher records `sent` and `provider_accepted` without claiming inbox delivery, and stores a provider identifier only when the selected transport supplies one

#### Scenario: Provider acceptance remains indeterminate after deduplication expires

- **WHEN** the dispatcher cannot prove acceptance or rejection before the conservatively frozen safe-replay cutoff
- **THEN** the delivery requires manual reconciliation and is not automatically resent under a new idempotency key

#### Scenario: Non-idempotent transport loses its final response

- **WHEN** an SMTP or other non-idempotent Adapter has submitted the complete message but cannot determine whether the transport accepted it
- **THEN** the delivery requires manual reconciliation and is not automatically resent even when ordinary pre-submission transport failures are retryable

#### Scenario: Operator reconciles provider acceptance

- **WHEN** an authorized operator supplies provider acceptance evidence for the expected revision of an indeterminate delivery
- **THEN** the maintenance operation records `sent` with `provider_accepted`, an optional provider identifier, and redacted correlated evidence without sending again, exposing message content, or claiming inbox delivery

#### Scenario: Operator cannot determine the provider outcome

- **WHEN** an authorized operator cannot prove acceptance or rejection and closes the expected delivery revision as unresolved
- **THEN** the operation records terminal `failed` with `acceptance_unresolved`, sends no email, leaves every code and reset grant under its existing lifecycle, and lets a later permitted request create a new logical delivery while reusing an active code when required

#### Scenario: Operator reconciles an explicit rejection

- **WHEN** an authorized operator supplies correlated explicit provider-rejection evidence
- **THEN** the operation records terminal `failed` with `provider_rejected`, sends no email, and does not invalidate, extend, or recreate an authentication code or reset grant

#### Scenario: Reconciliation races with another decision

- **WHEN** a reconciliation presents a stale delivery revision or conflicts with a previously recorded resolution
- **THEN** the operation refuses it, while only a freshly authorized repeat whose expected current revision, decision, evidence digest, frozen identities, and attempt fence exactly match consumes its fresh nonce and returns the existing result without changing delivery or authentication material or duplicating the resolution audit

#### Scenario: Reconciliation races with an active dispatcher

- **WHEN** a manual-reconciliation request observes an active dispatcher lease, has not passed the recorded maximum provider-call deadline and safety margin, or cannot prove attempt quiescence
- **THEN** the operation refuses the resolution without invalidating authentication material or changing delivery state

#### Scenario: Unresolved closure races with code verification

- **WHEN** unresolved closure and code verification or reset-grant issuance target authentication material from the same delivery concurrently
- **THEN** the transactions serialize, reconciliation records only the delivery result, and the existing code-consumption or reset-grant rules determine authentication behavior without reconciliation invalidating or recreating material

#### Scenario: Reconciliation authorization is invalid or replayed

- **WHEN** the signed authorization envelope is invalid, expired, scoped to another action or decision, or repeats a consumed nonce
- **THEN** the operation performs no delivery, authentication-material, audit-resolution, release, or target mutation

#### Scenario: Provider evidence belongs to another attempt or namespace

- **WHEN** signed reconciliation evidence names another installation, provider team or relay, sender, local message identifier, provider identifier, payload digest, attempt, or fence
- **THEN** the transaction rejects the decision and performs no delivery, authentication-material, audit-resolution, release, or target mutation

#### Scenario: Two callers present the same authorization nonce

- **WHEN** concurrent reconciliation calls present one otherwise valid single-use nonce
- **THEN** the transactional uniqueness claim permits at most one resolution/audit mutation and rejects the replay
