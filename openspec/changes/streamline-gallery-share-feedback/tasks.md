# Streamline Gallery share feedback tasks

## 1. Product contract

- [x] 1.1 Update `PRODUCT.md` to define the concise confirmation, accepted-submission Sonner acknowledgement, and public/attention Alert outcomes without equating `202 Accepted` with public availability.

## 2. Gallery feedback foundation

- [x] 2.1 Extend the Web owner-listing and share-operation projections to retain the checked `artifactId`, `publicUrl`, lifecycle, review, and effective-access fields already returned by the API, with focused parsing and API-consumer tests.
- [x] 2.2 Implement a management-shell Gallery share feedback coordinator that registers accepted Artifacts, namespaces its pending registry by signed-in User, deduplicates per Artifact, and cleans stale or terminal entries.
- [x] 2.3 Implement the visibility-aware bounded monitor with increasing delays, one in-flight read per Artifact, a five-minute continuous bound, focus/route recovery reads, and fake-timer coverage proving it cannot create duplicate or unbounded requests.
- [x] 2.4 Render accessible persistent success, review, and attention Alerts from current Server state, including dismissal, `Manage Gallery`, and a new-tab `View in Gallery` action only for an effectively accessible Listed projection with a public URL.

## 3. Confirmation interaction

- [x] 3.1 Reduce the fresh-share dialog to the approved title, one-sentence permission disclosure, and `Cancel` / `Share to Gallery` actions while preserving the latest-ready Version and safe metadata/profile defaults in the request.
- [x] 3.2 After an accepted share, register the Artifact with the feedback coordinator, close the dialog, and emit `Submitted to Gallery` / `We’ll let you know when it’s live.` through Sonner without a separate submitting or completion view.
- [x] 3.3 Keep a failed request in the confirmation and map Gallery unavailable, known conflict, and unrecognized internal failures to stable inline Alert copy without emitting submission feedback.
- [x] 3.4 Preserve existing Manage Gallery, Update Gallery, withdrawal, unavailable, governance, and irreversible-replacement behavior and tests.

## 4. Integration and verification

- [x] 4.1 Connect the coordinator at the authenticated management-shell boundary so feedback survives dialog closure and Artifact route navigation, and clear in-memory feedback on sign-out.
- [x] 4.2 Add focused component and integration tests for confirmation, cancellation, accepted Sonner feedback, pending silence, public success, review/attention results, safe errors, link targets, dismissal, reload recovery, and User scoping.
- [x] 4.3 Update the checked Web interaction request-count expectations for the bounded Gallery monitor and verify production asset-growth limits.
- [x] 4.4 Add a 1440x900 Gallery browser flow covering confirm, dialog closure, Sonner acknowledgement, asynchronous promotion, persistent Alert, and `View in Gallery`, with visual evidence for the confirmation and success Alert.
- [x] 4.5 Run strict OpenSpec validation, `mise run web-test`, the focused Gallery end-to-end flow, and `mise run check`; document any unrelated pre-existing failure without expanding scope.
