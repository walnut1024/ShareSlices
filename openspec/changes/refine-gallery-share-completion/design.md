# Refine Gallery share completion design

## Context

The completed `simplify-gallery-sharing` change removed the first-share form, but `ArtifactGalleryDialog` still refreshes the listing after a successful `202` response and immediately renders the broader Manage Gallery state. An accepted Gallery proposal can still be Pending while safety checks or review determine whether it becomes publicly Listed, so the UI must acknowledge the completed Owner action without claiming that public availability is already complete.

## Goals / Non-Goals

**Goals:**

- Give first-time sharing a clear entry, confirmation, submission, and completion sequence.
- Use concise, plain-language copy that clearly communicates public visibility and the fixed download/copy permissions.
- Distinguish a successful submission from public Gallery availability.
- Keep recovery from a failed request actionable without exposing raw Server error text.

**Non-Goals:**

- Change the Gallery share API, safety pipeline, listing lifecycle, or permission grant.
- Redesign Manage Gallery, Update Gallery, withdrawal, governance, or irreversible replacement flows.
- Add a new toast, polling loop, or public Gallery URL before a listing is Listed.

## Decisions

### Render a dedicated first-share result state

The dialog will retain a local result state after `shareArtifactToGallery` succeeds. It will not render the listing lifecycle panel or management controls until the Owner closes and later reopens the dialog. This makes the completed action obvious and keeps management information in its separate action.

If the refreshed listing is already Listed, the result says it is now visible in Gallery. Otherwise it says the submission is being checked before it appears. This follows the Server's current lifecycle projection instead of assuming a `202` result is public.

Alternative: close the dialog immediately and show a toast. Rejected because a durable in-dialog completion state is clearer and does not depend on a transient notification being noticed.

### Keep the confirmation concise but complete

The confirmation title asks `Share to Gallery?`. Its body identifies the Artifact and states that anyone can view it in Gallery; a short second sentence discloses Gallery download and Save a copy, and says Share with link will not change. `Cancel` changes nothing; the affirmative `Share to Gallery` button is the explicit permission acceptance.

Alternative: reduce the confirmation to public viewing only. Rejected because download and Save a copy are material parts of the fixed Gallery permission grant.

### Use safe, actionable error copy

Known Gallery conflict errors retain their specific guidance. Unrecognized errors render `We couldn't submit this Artifact to Gallery. Try again.` rather than showing a raw exception such as `Internal server error.`

Alternative: surface the Server message verbatim. Rejected because it is neither actionable nor stable product copy and can reveal implementation detail.

## Risks / Trade-offs

- [An accepted proposal is not yet public] → The completion message branches on the refreshed lifecycle and never presents a Gallery URL until Listed.
- [The owner may want management immediately] → Closing the result returns them to the Artifact; the entry then opens the existing Manage Gallery flow.
- [Refreshing the listing fails after an accepted POST] → Preserve the accepted completion state using the successful mutation result, with the conservative pending-check message.
