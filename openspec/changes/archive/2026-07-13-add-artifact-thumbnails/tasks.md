# Add Artifact thumbnails tasks

## 1. Lock contracts and persistence

- [x] 1.1 Add failing migration and cross-runtime tests for independent thumbnail jobs, leases, retries, terminal failure, immutable Version thumbnail metadata, and cleanup.
- [x] 1.2 Extend the checked management API and YAML/Python contract tests for owner-authorized thumbnail reads and Artifact list thumbnail projection.
- [x] 1.3 Add capture-grant contract tests for expiry, single use, Version scope, ingress exclusion, and denial outside internal content routes.

## 2. Implement isolated rendering

- [x] 2.1 Add ready-Version thumbnail enqueue without extending processing-job completion or ready-state transactions.
- [x] 2.2 Implement thumbnail claim, heartbeat, failure classification, at-most-three transient retries, lease recovery, and thumbnail-specific concurrency limits in the Rust Worker.
- [x] 2.3 Add pinned Chromium packaging and a bounded child-process adapter with fixed viewport, external-network blocking, animation suppression, readiness sequence, and hard timeout.
- [x] 2.4 Implement the internal manifest-only render route and short-lived single-use Version capture grants.
- [x] 2.5 Encode and store the private immutable WebP and include thumbnail objects in Version and Artifact cleanup.

## 3. Serve and display thumbnails

- [x] 3.1 Implement the owner-authorized Version thumbnail endpoint with private immutable cache headers and no object-storage URL exposure.
- [x] 3.2 Project latest-ready thumbnail state in Artifact management responses without coupling it to Publication.
- [x] 3.3 Replace only the Artifact grid placeholder with a fixed 16:10 thumbnail region, retaining the placeholder for loading, absence, and failure.

## 4. Verify

- [x] 4.1 Test deterministic capture, external-resource blocking, timeout, transient retry, terminal failure, and cleanup across Worker/API adapters.
- [x] 4.2 Run focused Web tests and verify grid cards at `1440x900`; confirm list and detail views are unchanged.
- [x] 4.3 Run `mise run check`, strict OpenSpec validation, and the full runtime integration suite.
