# ShareSlices 0.0.1 first share flow

## Why

ShareSlices 0.0.0 established account entry but cannot yet produce the product's core outcome: a stable public link for an agent-generated static web artifact. Version 0.0.1 adds the smallest complete Web-driven upload, preview, publish, and viewer flow so the storage and publication model is proven before CLI and Skill integration.

## What Changes

- Add an authenticated Artifacts management surface with a list, a detail view, mutable Artifact names, and first-artifact creation from an owner-supplied Artifact name and ZIP.
- Add an authenticated endpoint that reports the active artifact upload policy for optional client preflight checks.
- Accept one ZIP with a root `index.html`, stream it through the API into private storage, and process it asynchronously into one immutable ready Version.
- Keep a failed Artifact available for file replacement until its first ready Version exists; do not expose uploads for additional Versions in 0.0.1.
- Add Owner-only Preview for a ready Version without changing public state.
- Add explicit Publish, Unpublish, and republish behavior while keeping the active Share link unchanged.
- Add Viewer routes that serve committed artifact content and assets from the active Share link, or a non-content state page when the known link is not currently serving content.
- Establish the first Rust Worker, S3-compatible private object storage integration, upload-policy configuration, processing jobs, manifests, and reconciliation behavior needed by this flow.
- Establish a typed processing-retry policy and one structured logging contract across the Web, TypeScript API, and Rust Worker so one upload can be traced through asynchronous processing and every retry records a stable reason.
- Defer CLI and Skill integration, additional Versions, link expiration and rotation controls, Artifact deletion, version pruning, private sharing, administration, separate-site Viewer isolation, dedicated Preview sessions, and advanced browser hardening.

## Capabilities

### New Capabilities

- `artifact-upload`: Artifact creation, upload-policy discovery, ZIP intake, asynchronous validation and processing, status reporting, and replacement before the first ready Version.
- `artifact-publication`: Owner management views, Artifact rename, ready-Version Preview, Publish, Unpublish, republish, and active Share link state.
- `artifact-viewer`: Viewer resolution of Share links, publication-aware status pages, and secure streaming of committed static assets.

### Modified Capabilities

<!-- None. The existing account-entry requirements are reused without behavioral changes. -->

## Impact

- `web/`: authenticated Artifact list, creation, rename, detail, Preview, Publish, Unpublish, and Share actions.
- `api/`: Artifact management, upload-policy, upload intake, processing-status, publication, authenticated Preview content, and Viewer HTTP contracts.
- `worker/`: first Rust processing runtime for archive validation, expansion, manifest creation, and ready-Version commit.
- `db/`: Artifact, Share link, Version, Publication, upload session, processing job, upload-policy, and lease state.
- `compose.yaml`: private S3-compatible object storage and Worker services for local development.
- `deploy/kubernetes/`: shared-test and intranet manifests without DNS assumptions plus a public ingress overlay.
- `api/openapi/`: checked management and Viewer contracts plus YAML/Python contract coverage.
- Cross-runtime operations: stable correlation identifiers, event names, reason codes, and redaction rules for Web, API, and Worker diagnostics.
