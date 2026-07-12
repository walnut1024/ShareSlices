# Simplify Artifact upload dialog design

## Context

`CreateArtifactDialog` currently renders an Artifact name input above a visually prominent ZIP selector. Selecting a file already fills an empty name input from the filename, so the UI asks users to review an implementation detail that can be derived deterministically. The API and CLI still require an explicit valid name and remain unchanged.

## Goals / Non-Goals

**Goals:**

- Make Web creation a file-first action with no separate naming decision.
- Preserve current upload validation, preflight, progress, idempotency, and navigation behavior.
- Submit a valid initial name derived from the selected ZIP filename.

**Non-Goals:**

- Changing API or CLI request contracts.
- Removing Artifact Rename after creation.
- Supporting formats other than those currently accepted by the upload UI.
- Redesigning the surrounding Artifacts page or other dialogs.

## Decisions

### Derive the name in the Web adapter

Keep filename-to-name derivation in `CreateArtifactDialog`: remove the final case-insensitive `.zip`, trim the result, and truncate to 120 characters. This matches the current helper behavior and keeps the API contract stable. An invalid empty result, such as `.zip`, is rejected before upload with an actionable file-focused message.

### Keep one visually dominant drop target

Remove the name `Field` and retain the shadcn Base UI dialog, form, file `Input`, feedback components, progress, and buttons. Update the description and drop-target copy to tell the user they can drop or choose one ZIP and that its filename becomes the Artifact name.

### Treat file replacement as new input

Each selected file replaces the prior selection, clears current input errors, and rotates the idempotency key. The derived name is calculated at submit time from the selected file so there is no hidden mutable name state.

## Risks / Trade-offs

- **[Risk] A filename can derive to an empty name.** → Reject it before preflight and tell the user to rename the ZIP.
- **[Risk] Users cannot customize the name during upload.** → Keep Rename on the Artifact page, as already supported.
- **[Trade-off] Web and CLI creation inputs differ.** → Accept the deliberate UI difference while keeping one API contract.

## Migration Plan

Update focused tests first, simplify the dialog, then run Web tests, TypeScript, the repository quality gate, strict OpenSpec validation, and a 1440×900 visual check.

## Open Questions

None.
