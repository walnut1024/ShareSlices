# 08 — Verify external behavior and the destructive adoption path

Status: ready-for-agent

## Parent

[Reuse Artifact Content Bundles PRD](../PRD.md)

## What to build

Prove the complete feature through public flows and operational evidence, wire every required test into repository gates, and document the destructive pre-production deployment and rollback sequence.

## Acceptance criteria

- [ ] Public contract tests cover multiple Versions, equivalent repeated content, cross-User isolation, Preview, export, Publication preservation, and deletion of one shared reference.
- [ ] OpenAPI tests reject bundle IDs, fingerprints, object keys, and reuse-hit fields from public schemas.
- [ ] The Artifact YAML/Python flow is part of the API quality gate rather than an uncalled test file.
- [ ] Stable logs and aggregate metrics report hit class, fallback reason, avoided work, latency, cleanup backlog, and oldest cleanup age without content identity.
- [ ] The existing upload-to-Artifact-management Web regression remains green.
- [ ] Deployment instructions stop processes, clear Artifact rows and objects, apply migration, verify keys and readiness, run smoke flows, and reopen intake.
- [ ] Rollback is explicitly destructive and never asks old code to read the new object layout.
- [ ] API, Web, Worker, CLI-independent Rust, documentation, OpenSpec, and repository quality gates pass or any unrelated existing failure is isolated with evidence.

## Blocked by

- 04 — Protect private lookup and durable Upload idempotency.
- 05 — Reuse exact raw Uploads without repeated expansion.
- 06 — Reuse thumbnails by Content bundle and renderer revision.
- 07 — Quarantine and clean Content bundles safely.
