# Jobs release-verification contract audit

## Conclusion

Task 5.12's private protocol and isolation foundation is implemented. This does
not complete task 12.5: provider-qualified creation, invocation, observation,
compensation, and cleanup of the release-only Worker and Queue remain a separate
Cloudflare acceptance gate.

## Contract and reachability

- `api/openapi/private-jobs-release-verification.yaml` owns only the internal
  probe, finalize, and cleanup operations.
- `deploy/contract/private-jobs-release-verification.json` projects
  `publicIngress: false`, `fetch-service-binding` transport, and the sole
  `JOBS_RELEASE_VERIFICATION` caller binding.
- `deploy/cloudflare/verifier-wrangler-config.mjs` gives that binding only to the
  route-free verifier, with `workers_dev: false`, `preview_urls: false`, no
  routes, no triggers, and no Queue binding in the initial configuration.
- `api/src/cloudflare/jobs-release-verification.ts` rejects the wrong host,
  method, path, malformed body, oversized body, and stale/unscoped database
  state with a non-disclosing response.
- `api/tests/public-private-openapi-boundary.test.ts` prevents these paths and
  the thumbnail broker paths from entering the public OpenAPI contract.

## Identity and scope

- The probe is bound to invocation ID, release ID, operation fence, terminal
  nonce, probe sub-fence, and exact App/Content Worker versions.
- Jobs evidence includes the executing Worker version/timestamp, release-bundle
  identity, ordinary-configuration digest, `exports` digest, migration head,
  configured Container image references, and the private broker boundary.
- Each production-capable stable Container slot reports class, stable slot,
  provider and controller instances, build identity, contract revision, image
  reference, release, fence, nonce, and sub-fence.
- `deploy/cloudflare/release-verification-observation.mjs` verifies the complete
  terminal identity and correlates runtime instance IDs with Wrangler
  application/image/version inventory. Provider-reader tests reject a missing
  expected instance, wrong application/image/version, or remaining prior-image
  instance.

## Synthetic state and fencing

- Migrations `0038` through `0042` define the terminal nonce, invocation lease,
  expected identity, per-slot evidence, synthetic-resource inventory,
  quiescence time, retained tombstone, terminal evidence, and terminal
  invocation identity.
- `api/src/cloudflare/release-verification-repository.ts` checks the live
  release/fence/nonce/sub-fence at every authoritative database commit.
- Synthetic database, broker, Container, and R2 work uses only the
  `release-verification/<nonce>/` namespace and never inserts a product record.
- Finalization atomically records the evidence digest and terminal invocation,
  advances the sub-fence, and rejects every late begin, completion, Container
  evidence, or synthetic-resource commit.

## Quiescence, cleanup, and retention

- Finalization records the caller-provided lifecycle bounds and starts
  quiescence without claiming Queue pause drained an in-flight invocation.
- Cleanup waits for the quiescence boundary and zero active invocations, then
  deletes only inventoried nonce-owned state and performs a final bounded
  inventory.
- Normal retained tombstones remain completed control evidence rather than
  cleanup orphans. Missing terminal identity, incomplete quiescence, residual
  state, or indeterminate cleanup remains isolated and blocks acceptance.
- `deploy/cloudflare/release-verification-message.mjs` requires the lifecycle
  bounds and complete immutable expected identity before publication.

## Verification

The focused contract, runtime, repository, verifier-entrypoint, message,
provider-observation, provider-reader, lifecycle, and executor tests are part of
the passing `mise run api-test` and deployment test gates. Task 12.5 remains
open until the same contract is proven against the selected provider resources.
