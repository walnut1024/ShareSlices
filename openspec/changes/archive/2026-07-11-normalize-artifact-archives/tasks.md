# Normalize Artifact Archives — Tasks

## 1. Product and contracts

- [x] 1.1 Record the stable compatibility and validation-feedback policy in `PRODUCT.md`.
- [x] 1.2 Define normalization boundaries, entry resolution, report semantics, and validation ownership.
- [x] 1.3 Add the structured validation report to the checked OpenAPI contract.
- [x] 1.4 Preserve `archive_too_large` for synchronous upload rejection and document deterministic Worker-code migration.

## 2. Worker behavior

- [x] 2.1 Add red fixtures for macOS metadata, wrapper directories, inferred entries, ambiguous entries, and detailed validation failures.
- [x] 2.2 Implement safe metadata filtering, one-level wrapper removal, and deterministic entry resolution.
- [x] 2.3 Produce bounded structured issues and warnings with sanitized details.
- [x] 2.4 Preserve raw `sourcePath` to normalized `effectivePath` extraction mapping.

## 3. API behavior

- [x] 3.1 Persist the current Upload session validation report separately from operational exception evidence.
- [x] 3.2 Project structured failures and successful normalization warnings through Artifact management responses.
- [x] 3.3 Add YAML-defined API contract cases and the existing Python runner assertions for every documented response shape.

## 4. Web behavior

- [x] 4.1 Add policy-aligned ZIP preflight without treating it as authorization.
- [x] 4.2 Present affected paths, actual and allowed values, and corrective actions from server reports.
- [x] 4.3 Present successful normalization warnings without blocking Preview, Publish, or Share.

## 5. Verification

- [x] 5.1 Run focused Worker, API, and Web tests plus typechecks.
- [x] 5.2 Run cross-runtime conformance fixtures and `mise run check`.
- [x] 5.3 Verify failure and warning states at the supported 1440×900 viewport.
