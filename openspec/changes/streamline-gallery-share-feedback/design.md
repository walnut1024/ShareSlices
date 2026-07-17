# Streamline Gallery share feedback design

## Context

The fresh Share to Gallery dialog already sends safe defaults through the existing owner mutation contract, but it still owns the whole post-submit experience. A successful `POST` returns `202 Accepted` with a current owner listing projection whose initial lifecycle is normally Pending. Safety work can later promote it to an effectively accessible Listed revision, keep it under review, or close it with an initial rejection. The Web already mounts Sonner in `ManagementShell` and uses shadcn Alert for persistent accessible feedback, but it has no Gallery result coordinator after the dialog closes.

The existing `web-interface-consistency` contract prohibits unbounded background polling. The Server exposes the required source-of-truth state through `GET /api/artifacts/{artifactId}/gallery-listing`; no event stream or general operation-notification API exists for this result.

## Goals / Non-Goals

**Goals:**

- Reduce the Owner-visible flow to click, concise confirmation, and immediate return to management work.
- Use Sonner only to acknowledge durable request acceptance.
- Use a persistent Alert only for a later public or attention-required result.
- Provide a safe public `View in Gallery` action only when current Server state proves the listing is effectively accessible.
- Detect ordinary asynchronous completion without unbounded or duplicate network work.
- Keep raw internal errors out of user-facing feedback.

**Non-Goals:**

- Add a separate submitting page or success page inside the dialog.
- Add WebSocket, Server-Sent Events, a notification endpoint, a database notification record, or another dependency.
- Change Gallery safety, governance, listing lifecycle, permission contents, or mutation semantics.
- Redesign Manage Gallery, Update Gallery, withdrawal, or irreversible replacement.

## Decisions

### Keep the confirmation to one sentence

The fresh-share dialog uses:

- Title: `Share “{Artifact name}” to Gallery?`
- Body: `Anyone can view, download, and save a copy of this Artifact in Gallery. Your Share link won’t change.`
- Actions: `Cancel` and `Share to Gallery`

The affirmative action remains the explicit acceptance of the complete fixed Gallery permission bundle. The control is disabled while the HTTP request is in flight to prevent duplicate submission, but pending is not presented as another user-visible stage.

Alternative: mention only public viewing. Rejected because Gallery download and Save a copy are material permissions.

### Acknowledge acceptance with Sonner and close the dialog

After `shareArtifactToGallery` returns `202`, the dialog registers the Artifact with a management-shell feedback coordinator, closes, and emits:

- Title: `Submitted to Gallery`
- Description: `We’ll let you know when it’s live.`

The Sonner message means only that the Server durably accepted the request. A failed request keeps the confirmation open and renders an inline Alert; it emits no submitted message.

Alternative: show a dedicated completion view inside the dialog. Rejected because the Owner does not need to wait for asynchronous Gallery work.

### Coordinate result feedback at the management-shell boundary

A focused Gallery share feedback coordinator lives under `ManagementShell`, because the dialog can unmount and the Owner can move between Artifact management routes. The dialog registers `{artifactId, artifactName}` after acceptance. The coordinator owns the bounded monitor and renders persistent Alerts above the current management route.

The registration is scoped to the signed-in User and persisted as a small pending-operation registry in browser storage. Storage is not the source of Gallery truth; it only tells the coordinator which Server-owned listing to re-read after navigation or reload. Signing out clears in-memory feedback, and stored records are namespaced by User identity.

Alternative: keep the monitor inside `ArtifactGalleryDialog`. Rejected because closing the dialog would stop result delivery.

### Use bounded, visibility-aware status monitoring

For each explicitly accepted fresh share, the coordinator reads the existing owner listing endpoint with these limits:

- one monitor and at most one in-flight request per Artifact;
- no request while the document is hidden;
- increasing delays of approximately 2, 4, 8, 15, and 30 seconds, then at most every 30 seconds;
- stop continuous monitoring after five minutes, at a public result, or at a terminal failure;
- after the five-minute bound, perform one recheck on a later management-route entry or document-focus event rather than continuing a timer indefinitely;
- deduplicate registration and feedback by listing identity and revision.

This is a narrow exception to the general no-background-polling rule and will be represented in the checked interaction request budget.

Alternative: add a push channel. Rejected for this change because it expands the transport and deployment surface substantially.

### Derive Alert type from effective Server state

The coordinator treats a share as publicly complete only when the current projection is lifecycle Listed, `effectiveAccess.accessible` is true, and `publicUrl` is present. It then shows:

- Title: `Now live in Gallery`
- Body: `“{Artifact name}” is now visible to everyone in Gallery.`
- Link: `View in Gallery`

The link opens the trusted public Gallery listing in a new tab with `noopener` and `noreferrer`. The Alert remains until dismissed or acknowledged by opening the link.

A Pending and Clear listing remains quiet after the submitted Sonner message. Pending and Reviewing produces an informational Alert, `Gallery submission is under review.`, with `Manage Gallery`. Removed, Withdrawn, Restricted, or otherwise non-public terminal results produce `Gallery submission needs attention.` with `Manage Gallery`; they never expose a View link.

Alternative: show success when the worker job ends. Rejected because a completed job can yield review or rejection rather than public availability.

### Map failures to stable product copy

The fresh-share dialog maps Gallery unavailability to `Gallery is temporarily unavailable. Try again later. Your Artifact has not changed.` and every unrecognized mutation failure to `We couldn’t submit this Artifact to Gallery. Try again.` Known conflicts retain their specific recovery guidance. Raw exception messages and stable internal error codes are not rendered as product copy.

## Risks / Trade-offs

- [The browser closes before a result] → Persist only the pending Artifact reference and re-read Server truth on the next authenticated management visit.
- [Human review lasts longer than the active monitor] → Stop continuous polling at the bound, show the reviewing Alert when known, and recheck on later route entry or focus.
- [Many sequential shares create excess requests] → Deduplicate by Artifact, allow one in-flight read per Artifact, and enforce the same global concurrency limit used by the coordinator tests.
- [A Listed lifecycle is temporarily inaccessible] → Require effective accessibility and a current public URL before showing success or View in Gallery.
- [Browser storage becomes stale] → Treat missing, terminal, or no-longer-owned listings as cleanup signals and never infer public state from storage.

## Migration Plan

1. Update the Web client projection to retain `artifactId` and `publicUrl` already present in the checked owner-listing response.
2. Add the management-shell feedback coordinator and bounded monitor behind the existing authenticated shell.
3. Connect the fresh-share dialog to the coordinator, Sonner, and safe inline error mapping.
4. Update focused tests, deterministic request-count expectations, and browser coverage before enabling the behavior.

Rollback removes the coordinator and dialog registration while leaving the Gallery API, accepted listings, and browser-stored pending references harmless and unused.

## Open Questions

None. The public View link opens in a new tab by default, and the existing owner listing read remains the result source of truth.
