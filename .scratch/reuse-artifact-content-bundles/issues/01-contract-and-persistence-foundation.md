# 01 — Establish the Content bundle contract and persistence foundation

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Create the checked implementation contract and destructive pre-production schema foundation for same-User Content bundles while keeping all public API resource shapes unchanged.

## Acceptance criteria

- [ ] OpenSpec defines additional immutable Versions, same-User complete-bundle reuse, private lookup behavior, thumbnail sharing, final-reference deletion, and transparent fallback.
- [ ] PostgreSQL represents bundle lifecycle and integrity, Version references, asset indexes, private aliases, write attempts, renderer revisions, and cleanup intents.
- [ ] Composite foreign keys prevent a Version or alias from crossing User ownership.
- [ ] Active alias uniqueness permits retired aliases and handles automatic Entry selection deterministically.
- [ ] Checked migration and Drizzle schema agree and database tests cover every state and ownership constraint.
- [ ] Required key and revision configuration fails API or Worker readiness when incomplete.
- [ ] Historical migrations remain unchanged and the transition explicitly clears pre-production Artifact data and objects.

## Blocked by

None — can start immediately.
