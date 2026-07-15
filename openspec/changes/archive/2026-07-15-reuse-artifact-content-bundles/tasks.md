# Reuse Artifact Content Bundles Tasks

<!-- cspell:words HMAC -->

## 1. Contract and persistence foundation

- [x] 1.1 Add failing database tests for Content bundle lifecycle and integrity states, same-User composite foreign keys, active alias uniqueness, renderer revision pinning, and attempt cleanup state.
- [x] 1.2 Add the destructive pre-production Content bundle migration and mirror it in the Drizzle schema without modifying historical migrations.
- [x] 1.3 Add fingerprint, idempotency-encryption, content-identity, processing, and renderer revision configuration with API and Worker readiness tests.

## 2. Private identity and idempotency

- [x] 2.1 Add deterministic Worker test vectors for canonical identity across ZIP order, compression, timestamps, wrapper metadata, path, Entry file, content, and revision changes.
- [x] 2.2 Implement canonical identity encoding and current/previous domain-separated HMAC aliases behind a focused production-and-test crypto seam.
- [x] 2.3 Add failing API tests for completed Upload replay, conflict, randomized encrypted values, key revision, re-encryption, and pending claims without content-derived evidence.
- [x] 2.4 Replace persisted plain Upload request digests with authenticated-encrypted canonical request evidence and remove relational plain raw SHA-256 storage.

## 3. Normalized Content bundle reuse

- [x] 3.1 Add Worker PostgreSQL tests for creating-bundle reservation, equivalent concurrent attempts, creator-Lease takeover, same-User ownership, cross-User isolation, alias retirement, and distinct Version commits.
- [x] 3.2 Implement the Content bundle repository state machine and atomic Version-reference commit behind the Worker processing Interface.
- [x] 3.3 Add processing tests for canonical-hit cleanup, attempt-unique object promotion, stale-writer metadata rejection, and ordinary full-processing fallback.
- [x] 3.4 Refactor processing to validate and stage, resolve canonical identity, reserve or reuse a bundle, publish only the winning Manifest, and clean losing prefixes.

## 4. Version-shaped content access

- [x] 4.1 Add API repository tests proving Preview, Viewer, export, and internal capture authorize a Version and resolve only its owned Content bundle.
- [x] 4.2 Migrate Manifest and asset lookup from Version-owned rows to Version-to-bundle resolution without changing public HTTP or OpenAPI shapes.
- [x] 4.3 Remove obsolete Version-owned asset and Manifest paths after every runtime caller uses Content bundles.

## 5. Raw-input fast path

- [x] 5.1 Add API and Worker tests for current/previous raw HMAC candidates, automatic Entry sentinel, compatible validation evidence, key retirement, and safe fallback.
- [x] 5.2 Compute private raw candidates while streaming, promote compatible evidence after ready commit, and let the Worker bypass archive processing only on a verified healthy hit.

## 6. Bundle thumbnail reuse

- [x] 6.1 Add Worker and API tests for one job per bundle and renderer revision, Version revision pinning, live capture-Version selection, attempt-unique output, and stale-attempt rejection.
- [x] 6.2 Migrate thumbnail jobs, attempts, metadata, Worker rendering, and Version-shaped reads to Content bundle and renderer-revision identity.

## 7. Reference-safe deletion and Reconciliation

- [x] 7.1 Add repository and storage tests for Artifact-first sorted bundle locks, non-final deletion, final-reference cleanup, alias quarantine, writer quiescence, tombstones, and late-object scans.
- [x] 7.2 Implement bundle liveness, integrity isolation, durable cleanup intents, job cancellation, expired creator recovery, and bounded orphan-prefix Reconciliation.

## 8. External acceptance and adoption

- [x] 8.1 Extend checked OpenAPI tests to reject Content bundle IDs, fingerprints, object keys, and reuse-hit fields from public schemas.
- [x] 8.2 Extend the YAML/Python Artifact flow for multiple Versions, same-User equivalent content, cross-User isolation, Preview, export, Publication preservation, and shared-reference deletion.
- [x] 8.3 Include the Artifact flow runner in the API quality gate and keep the existing upload-to-Artifact-management Web regression green.
- [x] 8.4 Add stable reuse outcome, fallback, avoided-work, and cleanup metrics without content-derived or per-User identity values.
- [x] 8.5 Document and verify the destructive database/object transition, key readiness, deployment order, smoke tests, and destructive rollback.
- [x] 8.6 Run focused API and Worker integration tests, Web regression tests, Rust checks, OpenSpec validation, and the repository quality gate.
