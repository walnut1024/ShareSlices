# Viewer cache deep-verification contract evidence

Evidence date: 2026-07-25

Task 14.4 is implemented by
`deploy/automation/viewer-cache-deep-verification.mjs` and the
`viewer-cache-deep-verification` row in the shared verification projection.

The runner accepts only isolated `deep` authorization bound to one delivery
mode, release, operation, positive fencing token, nonce, and exact unique
resource set. Its four modes are Kubernetes direct, Kubernetes external CDN,
Cloudflare `web-assets-only`, and Cloudflare
`web-and-public-viewer-bytes`.

Every mode executes the same stable checks: full-body internal hit,
Range/`206` bypass, and cached state followed by Unpublish, expiry, replacement,
or restriction. Only `web-and-public-viewer-bytes` expects internal Viewer-byte
caching. All modes must prove the outward stable Viewer response remains
current and non-cacheable.

Cleanup runs after success or failure and must report every authorized resource
exactly. Returned evidence contains only the mode, check names, evidence
digests, and resource count. It contains no test resource or provider
identifiers.

Focused validation:

- `node --test deploy/automation/viewer-cache-deep-verification.test.mjs deploy/automation/verify.test.mjs deploy/tests/contracts.test.mjs`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

Target Adapters supply real route, authorization, cache, and state transitions
during representative acceptance. This contract does not claim that staging
task 15.11 has run.
