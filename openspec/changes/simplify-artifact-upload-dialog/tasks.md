# Simplify Artifact upload dialog tasks

## 1. Lock file-first behavior

- [x] 1.1 Update focused Artifact management tests to require no Artifact name field and to assert that the submitted name comes from the ZIP filename.
- [x] 1.2 Add a focused failure case for a ZIP filename that cannot produce a valid Artifact name.

## 2. Simplify the dialog

- [x] 2.1 Remove the Artifact name input, name ref, and input-specific validation state from `CreateArtifactDialog`.
- [x] 2.2 Derive the submitted Artifact name directly from the selected ZIP filename and preserve preflight, progress, idempotency, and upload behavior.
- [x] 2.3 Update the dialog description and file target copy for direct drop-or-choose upload without changing the surrounding Artifacts page.

## 3. Verify

- [x] 3.1 Run the focused Artifact management test file and Web TypeScript check.
- [x] 3.2 Run `mise run check` and strict validation for `simplify-artifact-upload-dialog`.
- [x] 3.3 Render the dialog at `1440x900` and confirm the single-file interaction, error feedback, and existing upload states match the approved scope.
