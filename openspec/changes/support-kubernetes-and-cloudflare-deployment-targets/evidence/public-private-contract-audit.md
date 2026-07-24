# Public and private contract audit

## Scope and baseline

Task 15.8 was audited against parent commit
`a731ee19d23162cc5af241e2bd665d938f43056d`, immediately before this change's
proposal commit `757fb99dfd0d7a6d23d9951970a81f961176c8a2`.

The comparison covered:

- `api/openapi/openapi.yaml`, the public HTTP wire contract;
- `cli/`, the end-user CLI implementation and messages;
- the private thumbnail-broker and Jobs release-verification OpenAPI documents,
  generated projections, runtime entrypoints, and Worker configuration.

## Result

Public request and response payload schemas are unchanged. The end-user CLI
tree is byte-unchanged from the baseline.

The public OpenAPI document has one non-payload correction: three existing
dynamic account-entry responses now declare their implemented
`Cache-Control: no-store` header through the existing `NoStore` component. This
is the cache contract already required by product policy and the deployment
cache projection. It does not add a path, parameter, request body, response
body, status, authentication scheme, or CLI behavior.

Commands used for the baseline comparison:

```sh
git diff --stat a731ee19..HEAD -- api/openapi/openapi.yaml cli
git diff --unified=3 a731ee19..HEAD -- api/openapi/openapi.yaml
git diff --exit-code a731ee19..HEAD -- cli
```

## Private ownership boundary

The deployment-only contracts remain outside `api/openapi/openapi.yaml`:

- `api/openapi/private-jobs-release-verification.yaml` uses only
  `http://shareslices-jobs.internal`; its projection declares
  `publicIngress: false` and `fetch-service-binding` transport.
- `api/openapi/private-thumbnail-broker.yaml` uses only
  `http://shareslices-broker.internal`; its projection declares
  `publicIngress: false`.

The Jobs Worker generated configuration sets `workers_dev: false` and public
ingress ownership remains in the separately activated Terraform route/domain
maps. Its release-verification fetch handler is reached through the
`JOBS_RELEASE_VERIFICATION` Service Binding, not through a public route. The
thumbnail broker accepts only its fixed internal origin and fenced capability
contract.

`api/tests/public-private-openapi-boundary.test.ts` now fails if either private
path enters the public OpenAPI path set, if either projection becomes public, or
if an internal server is added to the public document. Existing focused tests
continue to validate the complete private schemas and projections.

## Acceptance boundary

This audit confirms contract ownership and regression coverage only. It does not
qualify Cloudflare routing, Service Bindings, Containers, or the production
target; those remain subject to their provider and deep-verification gates.
