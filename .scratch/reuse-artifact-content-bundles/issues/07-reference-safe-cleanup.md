# 07 — Quarantine and clean Content bundles safely

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Make Artifact deletion, integrity quarantine, failed attempts, and Reconciliation preserve live shared references while eventually removing every unreferenced bundle, thumbnail, alias, and late object.

## Acceptance criteria

- [ ] Version insertion and Artifact deletion lock Artifact first and bundles in ascending ID order with bounded retry after database aborts.
- [ ] Removing a non-final Version reference leaves the bundle, aliases, thumbnail, and surviving Version reads intact.
- [ ] Removing the final reference retires active aliases, cancels bundle work, marks deleting, and records durable cleanup.
- [ ] Confirmed missing objects, checksum mismatch, or inconsistent Manifest atomically quarantines the bundle before replacement can reserve identity.
- [ ] A repaired bundle reactivates aliases only when no healthy replacement owns them.
- [ ] Cleanup waits for related Leases and writer quiescence, then removes objects safely when repeated.
- [ ] Attempt tombstones and bounded prefix scans remove objects written after an earlier cleanup pass.
- [ ] Reconciliation tests cover creator takeover, non-final and final deletion, quarantine replacement, and stale writers.

## Blocked by

- 03 — Resolve shared content through Version authorization.
- 05 — Reuse exact raw Uploads without repeated expansion.
- 06 — Reuse thumbnails by Content bundle and renderer revision.
