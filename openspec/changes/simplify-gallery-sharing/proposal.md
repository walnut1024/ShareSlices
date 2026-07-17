# Simplify Gallery Sharing

## Why

The current Web Share to Gallery dialog exposes implementation choices and optional metadata before the Owner can complete the common action. Sharing should require one deliberate confirmation while still stating the complete public permission effect.

## What Changes

- Replace the first-share Web form with a concise confirmation dialog and one Share to Gallery action.
- Default the operation to the latest ready Version, the Artifact name as public title, and empty optional metadata.
- Reuse the signed-in User's Creator profile or initialize its display name from the non-email account name without asking during sharing.
- Treat confirmation of the dialog as explicit acceptance of the current indivisible Gallery permission grant, with copy that discloses public viewing, Gallery download, and Save a copy.
- Keep Manage Gallery, Update Gallery, withdrawal, governance, and replacement-warning behavior separate and unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gallery-listing`: Simplify the Web first-share interaction and define safe server defaults for the omitted profile and metadata inputs.
- `gallery-governance`: Allow the single confirmation action to record explicit acceptance of the current fixed Gallery permission bundle when its complete effect is disclosed.

## Impact

- Product policy in `PRODUCT.md`.
- Gallery owner HTTP request schema and OpenAPI contract.
- Gallery owner application defaults and Creator profile staging.
- Web Gallery confirmation dialog and focused API/Web tests.
