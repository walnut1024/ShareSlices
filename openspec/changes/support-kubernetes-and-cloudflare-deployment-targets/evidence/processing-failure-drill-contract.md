# Processing failure-drill contract evidence

Evidence date: 2026-07-25

Task 14.8 is implemented by
`deploy/automation/processing-failure-drill.mjs` and the
`background-processing-failure-drill` row in the shared verification
projection.

The runner accepts only isolated `pre_traffic` or `deep` authorization bound to
one release, operation, positive fencing token, nonce, and explicit owned
resource set. It executes duplicate-wake, lost-wake, Container-termination,
stale-fence, and follow-on-work probes in a stable order and requires a passing
evidence digest from each.

Cleanup runs after success or failure. It must report every authorized resource
as cleaned; an incomplete or indeterminate cleanup blocks the result. Returned
evidence contains no probe resource identifiers. `core` authorization is
rejected before any callback, and `deploy/automation/verify.mjs` continues to
load only the three read-only core scenarios.

Focused validation:

- `node --test deploy/automation/processing-failure-drill.test.mjs deploy/automation/verify.test.mjs deploy/tests/contracts.test.mjs`
- `openspec validate support-kubernetes-and-cloudflare-deployment-targets --strict`
- `git diff --check`

The concrete Kubernetes and Cloudflare target Adapters supply the live probe
operations during representative pre-traffic acceptance; this shared runner
does not claim provider execution by itself.
