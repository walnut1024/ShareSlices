# Add Gallery community sharing

## Why

ShareSlices currently supports public access only through possession of a Share link, so Creators cannot intentionally make a fixed Artifact Version discoverable to the wider community and Viewers cannot safely browse, download, or save independent copies. Adding public discovery also requires explicit isolation, permission, moderation, provenance, and takedown boundaries because Gallery turns untrusted HTML and JavaScript into a broadly reachable surface.

## What Changes

- Add an independent Gallery listing lifecycle that pins one current ready Version, stages non-public update proposals before atomic promotion, owns public metadata and an opaque URL, supports permanent withdrawal, and never creates or mutates a Share-link Publication.
- Add anonymous Gallery browsing, deterministic Featured, Newest, search, tag, and Creator ordering, trusted plain-text listing pages, and public Creator profile management.
- Add anonymous normalized ZIP Download and rate-limited signed-in asynchronous Save a copy with independent User ownership, quota enforcement, and immutable immediate-source and original-Creator attribution.
- Add versioned Gallery permission grants, deterministic pre-publication checks, reports, review states, platform Removal, Artifact takedown, public-sharing restrictions, Appeals, and auditable Featured administration.
- Require a Gallery-eligible deployment topology, an Untrusted-content origin on a separate browser registrable site outside the management credential boundary, self-contained content, blocked external networking, and a constrained iframe capability set before Gallery can be enabled.
- Add owner-side Web, CLI, Agent protocol, and official Skill operations for Gallery view, share, update, and withdraw while keeping public browse, copy, download, and report Web-only in the first release.
- **BREAKING**: Rename Web link-sharing actions and statuses from Publish/Manage publication/Unpublish and Not published/Published/Unpublished to Share with link/Manage link/Stop sharing link and Not shared/Link active/Link stopped. Backend and CLI Publication terminology and existing Share links remain compatible.
- Keep every existing Artifact unlisted during migration, create no implicit Creator profiles, and leave existing Publications and Share links unchanged.

## Capabilities

### New Capabilities

- `gallery-listing`: Owner creation, fixed-Version selection, non-public update proposals, metadata, cover behavior, status, opaque URL, withdrawal, and Artifact deletion interaction.
- `gallery-discovery`: Anonymous Gallery routes, trusted cards and detail pages, Creator profiles, search, tags, Featured and Newest ordering, pagination, indexing, and desktop-only behavior.
- `gallery-copy-download`: Anonymous fixed-Version Download, signed-in asynchronous Save a copy, independent ownership and quotas, provenance, source lifecycle effects, and download consistency.
- `gallery-governance`: Safety checks, reports, review states, Removal, Artifact takedown, public-sharing restrictions, Appeals, administration, notifications, privacy, and event retention.
- `gallery-security`: Deployment eligibility, Untrusted-content origin isolation, self-contained content, network blocking, iframe capabilities, trusted controls, and enablement gates.

### Modified Capabilities

- `artifact-publication`: Change Web link-sharing labels, preserve re-share and reactivation paths, project governance restrictions independently, expose separate Gallery actions, preserve Publication semantics, and retire an active listing when deleting its Artifact.
- `cli-artifact-management`: Add owner-side Gallery view, share, update, and withdraw commands without adding public Gallery browsing or interaction commands.
- `cli-agent-protocol`: Advertise and return fixed outcomes for the new Gallery management operations and add an explicit permission-acceptance action.
- `official-skill-orchestration`: Preserve explicit Gallery intent, first-share Creator identity, and exact permission evidence while orchestrating only the supported Gallery CLI Agent operations.

## Impact

- Product and durable domain documents: `PRODUCT.md`, `CONTEXT.md`, and Gallery ADRs.
- Database: Gallery listings and revision proposals, metadata, permission acceptance, Creator profiles, review and governance state, reports, Appeals, copy provenance, idempotency, aggregates, and audit tombstones.
- API and checked contract: owner management, anonymous discovery and download, authenticated copy, Creator profiles, reports, administration, content serving, pagination, and error responses.
- Web: public Gallery routes, trusted cards and player pages, Creator profiles, separate management actions, copy/download/report flows, unsupported-device handling, and governance surfaces.
- Worker and storage: Version-specific Gallery covers, asynchronous independent copy processing, policy checks, reconciliation, and owner-scoped Content bundles.
- Deployment: Gallery eligibility validation, isolated content Origin, browser response policy, rate limiting, and default-disabled rollout.
- CLI, Agent protocol, and official Skill: Gallery management capabilities and compatibility negotiation.
