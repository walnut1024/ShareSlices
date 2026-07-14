# Unify Publish and sharing

## Why

ShareSlices currently treats Publish and Share as separate owner actions: Publish selects content, while a pre-created Share link owns expiration and separate management commands. This splits one user intent across two state models and makes external availability harder to understand.

## What Changes

- Make Publish the single action that selects a ready Version, makes it externally accessible for a chosen duration, and returns the Share link.
- Move expiration from the Share link to Publication and expose Not published, Published, Expired, and Unpublished as distinct owner-facing states.
- Create the Share link on first Publish, reuse it by default, and let the Owner explicitly replace it during Publish with irreversible confirmation.
- Keep Unpublish as the explicit early-stop operation and let Owners manage an accessible Publication's future end without publishing again.
- Replace separate Share management in the Web and CLI with Publication management and a high-level Publish path that can orchestrate Upload through link return.
- Preserve existing Share links during migration, including links reserved for Artifacts that are not currently published.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `artifact-upload`: Stop creating or returning a Share link for newly uploaded Artifacts.
- `artifact-publication`: Define Publication-owned duration, first-Publish link creation, status projection, Publication management, link replacement, and republish defaults.
- `artifact-viewer`: Resolve expired and Unpublished Publications through reusable links while reserving `410` for retired links.
- `cli-artifact-management`: Remove Share as a separate management command and add stepwise and high-level Publish behavior.

## Impact

- Affected surfaces: product contract, PostgreSQL migrations, Artifact application modules and repositories, checked OpenAPI and YAML/Python contract tests, Viewer routing, Web management flows, CLI interface and documentation, and the official Skill summary flow.
- Existing Share slugs remain stable unless the Owner explicitly replaces one during Publish.
- Password protection and other restricted-access policies remain outside this change.
