# Product deep-smoke contract evidence

Evidence date: 2026-07-25

Task 14.6 is implemented by `deploy/automation/product-deep-smoke.mjs` and the
`product-lifecycle-deep-smoke` row in the shared verification projection.

The runner accepts only isolated `deep` authorization bound to one target,
release, operation, positive fencing token, nonce, explicit Gallery
expectation, and an exact unique resource set. It executes Upload, processing,
Preview, Publish, Viewer, Unpublish, and Gallery in a stable order and requires
a passing evidence digest from every step.

Cleanup runs after success or failure and must report exactly every authorized
resource. Incomplete or indeterminate cleanup blocks the result. Returned
evidence contains step digests and a resource count but no resource identifiers,
content, credentials, or provider diagnostics. Core verification remains
read-only and does not load this runner.

Focused validation:

- `node --test deploy/automation/product-deep-smoke.test.mjs deploy/automation/verify.test.mjs deploy/tests/contracts.test.mjs`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

Compose, Kubernetes, and Cloudflare Adapters supply the real lifecycle
operations during isolated acceptance. This shared runner does not claim that
representative target smoke in task 15.11 has run.
