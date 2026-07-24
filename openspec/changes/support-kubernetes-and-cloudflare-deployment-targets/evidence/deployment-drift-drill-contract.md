# Deployment drift-drill contract evidence

Evidence date: 2026-07-25

Task 14.9 is implemented by `deploy/automation/drift-drill.mjs` and the
`deployment-drift-drill` row in the shared verification projection.

The runner accepts only isolated `deep` authorization bound to one release,
operation, positive fencing token, nonce, and an explicit owned fixture set for
every target dimension. Kubernetes covers resources, configuration digests,
and deployment records. Cloudflare covers Worker versions, routes, bindings,
configuration digests, and deployment records.

Each target must have a clean observed baseline. For every dimension the runner
injects drift, requires observation of that exact dimension with stable reason
codes, restores the owned fixtures, and requires a clean observation before
continuing. Failed detection still triggers restoration. Incomplete,
indeterminate, or unverified restoration overrides the primary result and
blocks the drill.

Returned evidence contains the target, release, nonce, dimensions, outcomes,
and reason codes, but no fixture identifiers or raw provider diagnostics.
`core` authorization is rejected before any Adapter callback, and
`deploy/automation/verify.mjs` continues to load only the three read-only core
scenarios.

Focused validation:

- `node --test deploy/automation/drift-drill.test.mjs deploy/automation/verify.test.mjs deploy/tests/contracts.test.mjs`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

Concrete Kubernetes and Cloudflare target Adapters supply the live injection,
observation, and restoration operations during representative pre-traffic
acceptance. This shared runner does not claim provider execution by itself.
