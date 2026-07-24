# Migrate from the legacy Kubernetes examples

This guide moves an installation from the unsupported, example-oriented
Kubernetes manifests to the Deployment Module's Kubernetes target. The change
is operationally breaking: do not point the new renderer at a production
namespace and assume the old overlay values will be preserved.

The supported target assumes an existing conforming cluster and operator-owned
PostgreSQL, private S3-compatible storage, enterprise SMTP, registry, ingress,
DNS, TLS, and recovery systems. Read the [Kubernetes target](kubernetes.md)
runbook before migration.

## What changed

| Legacy example interface | Supported interface | Required operator action |
| --- | --- | --- |
| `overlays/intranet`, `isolated-local`, `shared-test`, and `public-production` selected example topologies | A versioned production deployment configuration selects `target: kubernetes`; delivery is `direct` or `external-cdn` | Translate intent into a checked deployment configuration. Do not copy or rename an old overlay. |
| Fixed ClusterIPs, NodePort `30080`, private node addresses, example public origins, and in-manifest upstream addresses | Services use cluster discovery; public, origin, content, ingress, trusted-proxy, database, object-storage, and SMTP endpoints come from validated configuration | Allocate real DNS/TLS and external dependency identities. Remove dependencies on the former addresses before cutover. |
| `shareslices-secret` contained deployable `replace-me` values and occasionally a database URL in an overlay | Role-specific Secrets are created or externally synchronized before planning; configuration and releases contain only logical references and non-secret revisions | Create the API, maintenance, content, resident Worker, migration, registry, and TLS Secrets with least-privilege credentials. Never migrate placeholder values. |
| API and Worker images used mutable version tags such as `:0.0.1` | The immutable release records role-specific content digests and manifests pull by digest | Build, publish, and retain the exact images and record their digests in the release bundle. |
| Every new API Pod ran the database migration as an init container | One fenced, one-shot migration Job completes before compatible runtimes advance | Remove Pod-owned migration authority. Authorize and observe the migration phase once through the Deployment Module. |
| API HTTP startup also represented background responsibilities | API, maintenance/email, content-only, resident processing, migration, and Web are distinct roles | Provision every required role Secret, resource budget, egress path, and readiness observation. |
| Direct manifest or overlay application was the deployment procedure | `doctor`, `render`, `plan`, authorized `apply`, `status`, `verify`, and compatible `rollback` share one release journal and fence | Choose exactly one writer: the Deployment Module in direct mode or the declared external GitOps reconciler. |

Docker Compose is not a replacement production target and is not part of this
migration. It remains the canonical local development and integration-test
topology.

## Prepare without mutating the old installation

1. Inventory the live namespace, images, Secrets, ingress, DNS, TLS, database
   migration head, object-storage bucket and layout, SMTP sender, and any
   resources managed outside the old examples.
2. Record which fixed addresses or NodePorts are consumed by DNS, monitoring,
   allowlists, automation, or clients. Plan explicit replacements; the new
   manifests do not preserve them.
3. Take and validate current PostgreSQL and object-storage recovery evidence.
   Preserve the immutable old images and manifests for the rollback window.
4. Build and publish the current role images:

   ```sh
   mise run kubernetes-build-images
   ```

5. Create a release bundle with the exact image digests, migration checksums and
   head, N/N-1 compatibility evidence, contract revisions, inventory, and
   ownership markers.
6. Create a deployment configuration based on
   [`deploy/contract/fixtures/deployment.kubernetes.valid.json`](../../deploy/contract/fixtures/deployment.kubernetes.valid.json).
   Replace every example identity and evidence value. The fixture is schema
   documentation, not a production configuration.
7. Provision role-specific Secrets outside Git. Use separate database
   credentials where the roles require different authority, and include
   `AUTH_EMAIL_SMTP_URL` only in the maintenance Secret. Set a non-secret
   revision for each reference so its consumers roll when the value changes.

Do not delete the old resources yet. The Deployment Module will not adopt
ambiguous or unowned resources, and migration is not authorization to overwrite
another field manager.

## Render and compare

Run the read-only checks first:

```sh
mise run deploy -- doctor --config deployment.json --release release.json
mise run deploy -- render --config deployment.json --release release.json
mise run deploy -- plan \
  --config deployment.json \
  --release release.json \
  --operation apply
```

Compare the rendered role graph, Services, ingress, NetworkPolicies, public
origins, Secret names and revisions, image digests, resource budgets, and
ordered phases with the inventory. Server-side dry-run or field-ownership
conflicts are blockers. Do not use `--force-conflicts`, restore fixed addresses,
add placeholder Secrets, change digest references back to tags, or put the
migration back into a Pod init container to make the comparison pass.

For GitOps, hand off each exact rendered phase and wait for observation before
promoting the next one. Do not let the GitOps controller and the Deployment
Module both write the same resources.

## Cut over in ordered phases

Schedule a change window appropriate to the discovered address, ingress, and
database dependencies. In direct mode, apply only the reviewed plan:

```sh
export SHARESLICES_SECRET_ROOT=/absolute/operator/secret-root
export SHARESLICES_DEPLOYMENT_PRINCIPAL=deployment-operator@example.test

mise run deploy -- apply \
  --config deployment.json \
  --release release.json \
  --plan authorized-plan.json
```

The operation bootstraps only the authorized control schema, acquires its lease
and fencing token, runs the one-shot migration, advances compatible workloads,
verifies them before traffic, and activates public ingress last. A completed
migration is journaled and is not rerun during resume.

Update DNS, load-balancer, or external-CDN routing only at the corresponding
authorized traffic phase. In external-CDN mode, verify the origin before edge
cutover and preserve dynamic `no-store` behavior. The external CDN does not
change the installation from the Kubernetes target.

## Verify and retire the old interface

After cutover:

```sh
mise run deploy -- status --config deployment.json
mise run deploy -- verify --config deployment.json --release release.json
```

Confirm the release record and journal, every role's readiness, admitted
security context, required and forbidden network flows, public and private route
boundaries, cache headers, private object-storage behavior, and authorized deep
verification evidence. A local render or dry-run is not production
qualification.

Retire legacy resources only after the direct-target acceptance gate passes and
the rollback window no longer needs them. Detach traffic first, then remove only
resources whose positive ownership and inactivity are proven. Do not delete
unknown resources or old images that still back the recorded previous release.

## Failure and rollback boundary

If the operation loses its lease, encounters drift, or returns indeterminate,
stop mutation and reconcile the durable journal with observed cluster state.
Do not repeat the migration or create a fresh plan merely to bypass an
unresolved checkpoint.

Application rollback selects the recorded compatible previous release and never
runs a down migration. If the new migration prefix is not N/N-1 compatible,
rollback must be refused; restore is a separately authorized recovery operation,
not an ordinary deployment rollback. Fixed legacy addresses, placeholder
Secrets, mutable tags, and init-container migrations are not restored as part of
rollback.
