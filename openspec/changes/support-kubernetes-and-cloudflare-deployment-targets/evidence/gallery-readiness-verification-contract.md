# Gallery readiness verification contract evidence

Evidence date: 2026-07-25

Task 14.5 is implemented by
`deploy/automation/gallery-readiness-verification.mjs` and the
`gallery-readiness` row in the shared verification projection.

The verifier is release-bound and accepts only `pre_traffic` or `deep`
authorization for Kubernetes or Cloudflare. It observes registrable-site,
credential, governance, isolated-content, and network dimensions separately.
Each observation needs a current timestamp and evidence digest. Missing,
malformed, stale, or failed observations keep Gallery disabled.

The result does not consume or project core health. Therefore an optional
Gallery failure cannot be mistaken for a core release failure, while a healthy
core release cannot make Gallery eligible. Returned evidence contains stable
dimension and reason codes without provider diagnostics.

Focused validation:

- `node --test deploy/automation/gallery-readiness-verification.test.mjs deploy/automation/status.test.mjs deploy/tests/contracts.test.mjs`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

The Kubernetes and Cloudflare Adapters still must collect the real topology,
credential, governance, content, and network observations during target
acceptance. This shared verifier does not satisfy task 10.10 or representative
staging task 15.11 by itself.
