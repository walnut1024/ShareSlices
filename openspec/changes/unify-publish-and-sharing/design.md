# Unify Publish and sharing design

## Context

The current system creates an active Share link during initial Upload, stores expiration on that link, creates or ends a separate Publication pointer, and exposes separate Share-link management in the Web and CLI. That shape lets link state and Publication state disagree even though the Owner has one intent: make one Version externally accessible for a chosen period.

## Goals / Non-Goals

**Goals:** Make Publication the sole source of external availability, reduce the normal workflow to Upload then Publish, preserve stable links by default, support explicit irreversible link replacement, retain early Unpublish, and migrate existing links without breaking addresses already given to Viewers.

**Non-Goals:** Password protection, private or restricted sharing, multiple simultaneous links, link aliases, reversible replacement, a Publication-history UI, changes to Upload validation or Version immutability, or changes to Preview security.

## Decisions

- A new Artifact has no Share link. The first Publish atomically creates both the Publication and Share link. A migrated Artifact may have a reserved existing link before its first Publish under the new model; management responses hide that migration detail until Publish reuses the link.
- Publication stores the selected Version, publish time, expiration policy, effective end time, and early-end evidence. Permanent, relative-duration, and exact-time policies remain distinguishable so later Publish can inherit intent rather than guess from one timestamp.
- Owner-facing Publication status is derived as Not published when no Publication record exists, Published while the latest Publication is accessible, Expired when its scheduled end has passed, and Unpublished when the Owner ended it early. Superseded Publication records remain internal.
- Publish accepts a ready Version, an expiration policy, and a link choice of reuse or replace. Omitted settings use permanent plus reuse on first Publish and inherit the previous Version, expiration policy, and link on republish. A relative duration restarts at the new publish time; an exact end is reusable only while still in the future.
- Publishing a different Version while one is accessible ends the old Publication and creates the new one in the same transaction. Viewer requests keep resolving the previous committed Version until the whole transition succeeds. Idempotency covers the Version, effective expiration policy, link choice, and caller key.
- Replacing a link is available only during Publish and requires an explicit confirmation value in addition to the replacement choice. The transaction retires the old link, creates the new link, and commits the Publication together. A retired slug is never restored or retained as an alias.
- Managing an accessible Publication is not another Publish. The Owner can change its expiration to permanent or a future instant. A current or past instant is invalid; immediate removal uses Unpublish. Expired and Unpublished Publications require Publish to become accessible again.
- Management projections expose a nullable Share link, the current or latest Publication summary, the four-state Publication status, and state-valid actions. Copy is available only while status is Published. The Web uses Publish for first publication or a new Version and Manage publication for link display, Copy, expiration changes, and Unpublish.
- Viewer routes return content with `200` only for a Published status. Expired and Unpublished reusable links return private generic state pages with `200`; retired links return `410`; unknown slugs return `404`. Existing `Cache-Control: no-store` behavior remains.
- The stepwise CLI keeps `artifact upload`, `artifact publish`, and `artifact unpublish`. Separate `artifact share view/edit` commands are removed. `artifact publication view/edit` manages the current Publication, while a high-level `shareslices publish` command packages local input when needed, uploads, waits for ready, publishes with permanent and reuse defaults, and returns the link. Explicit flags select relative duration, exact end time, or confirmed link replacement.
- The official Skill calls the high-level Publish path for the common flow and summarizes the returned Publication and link. It does not acquire independent lifecycle or access-control rules.

## Persistence and migration

- Keep `artifact_share_link` as stable link identity, remove expiration as effective link state, and retain only non-retired versus retired lifecycle semantics.
- Extend `artifact_publication` with expiration-policy fields, effective expiration, and an end reason that distinguishes Unpublish from supersession. Existing ended rows preserve enough evidence to classify previously Unpublished Artifacts.
- For each current Publication, migrate its existing link expiration into that Publication. A past expiration produces Expired; no expiration produces permanent Published.
- Preserve every existing slug. Existing Artifacts without a current Publication keep their link as a reserved migration link and reuse it on their next Publish. Retired links remain retired.
- Contract and repository reads must tolerate nullable links for Artifacts created after migration but before first Publish.

## Risks / Trade-offs

- **[Risk] Concurrent Publish, expiration edits, and Unpublish can overwrite one another.** → Use one Artifact-scoped transaction boundary, optimistic identity checks for the target Publication, and idempotency for Publish.
- **[Risk] Link replacement can break addresses already distributed externally.** → Restrict it to Publish, require explicit irreversible confirmation, and return `410` from the old slug.
- **[Risk] Existing Artifacts violate the new first-Publish link-creation rule.** → Preserve their links as a migration-only reservation instead of silently breaking unknown external consumers.
- **[Trade-off] Expired and Unpublished links return `200` even though no content is available.** → They are reusable stable addresses; reserve `410` for links that are permanently retired.
- **[Trade-off] Publication records accumulate without an Owner history screen.** → Retain them for state derivation, idempotency, and audit while keeping the first UI focused on current management.

## Open Questions

None.
