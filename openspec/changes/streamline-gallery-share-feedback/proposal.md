# Streamline Gallery share feedback

## Why

The first Share to Gallery flow still makes the Owner interpret an accepted request as if it were the final public result. The interaction needs one concise confirmation, immediate non-blocking acknowledgement, and a later persistent result only when Gallery reaches a meaningful public or attention-required state.

## What Changes

- Reduce the first-share confirmation to one short public-permission sentence and `Cancel` / `Share to Gallery` actions.
- Close the confirmation after the Server accepts the request and show a Sonner notification that the Artifact was submitted.
- Monitor the resulting Gallery listing outside the dialog without exposing a separate submitting or completion screen.
- Show a persistent Alert when the listing becomes publicly Listed, with a `View in Gallery` link that opens the public listing.
- Show a distinct attention Alert when the asynchronous result requires review or correction instead of claiming that sharing succeeded.
- Keep raw internal Server errors out of user-facing copy and preserve Manage Gallery, Update Gallery, withdrawal, governance, and irreversible-replacement flows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gallery-listing`: Define the concise Web confirmation, accepted-submission Sonner feedback, asynchronous result monitoring, and persistent public/attention Alerts for the first Share to Gallery flow.
- `web-interface-consistency`: Permit one bounded, visibility-aware status monitor for an explicitly accepted asynchronous Gallery operation while retaining request deduplication and checked interaction budgets.

## Impact

- Product interaction policy in `PRODUCT.md`.
- Gallery state projection and feedback handling in the authenticated Web management shell and Artifact screens.
- `ArtifactGalleryDialog`, Sonner and Alert composition, focused component tests, and Gallery browser coverage.
- No new API endpoint, dependency, database migration, or Gallery lifecycle change is expected; the existing owner listing read remains the Server source of truth.
