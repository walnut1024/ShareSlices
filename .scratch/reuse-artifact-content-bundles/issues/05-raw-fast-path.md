# 05 — Reuse exact raw Uploads without repeated expansion

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Use compatible private raw-input aliases and immutable validation evidence to let the Worker commit a new Version without archive expansion, while every uncertain candidate transparently falls back to full processing.

## Acceptance criteria

- [ ] A verified exact raw hit copies compatible immutable validation evidence and skips archive read, expansion, validation, staging writes, and Manifest generation.
- [ ] Requested Entry file, policy, processing, content-identity, fingerprint-key, lifecycle, integrity, and evidence compatibility are all required.
- [ ] Automatic Entry selection has one deterministic non-null alias key.
- [ ] Missing or incompatible evidence retires only the invalid raw alias and follows full processing.
- [ ] A ready but suspect, corrupt, deleting, or alias-less bundle cannot receive a new Version reference.
- [ ] Raw-key retirement degrades only the raw fast path and never changes external Upload behavior.
- [ ] Tests prove bypass through observable Worker Adapter calls and prove fallback still creates a valid Version.

## Blocked by

- 02 — Commit normalized content through one Content bundle.
- 04 — Protect private lookup and durable Upload idempotency.
