# Deployment Contracts

This directory owns versioned, target-neutral machine contracts consumed by
deployment automation and target Adapters. It contains no provider credentials
and no rendered provider resources.

- `deployment.schema.json` selects exactly one production target and accepts
  only logical Secret references.
- `command-result.schema.json` defines the stable machine result returned by
  every production lifecycle command.
- `recovery-marker.schema.json` binds PostgreSQL, object storage, and a recovery
  manifest to the same known consistency cut.
- `release.schema.json` records immutable release identity, compatibility,
  inventory, ownership, and qualified provider metadata.
- `route-projection.json` maps ingress route families back to OpenAPI operations
  or documented owners.
- `cache-projection.json` defines edge and internal-byte cache boundaries without
  changing outward HTTP contracts.
- `verification-scenarios.json` defines shared black-box checks and explicit
  `not_applicable` behavior.
- `fixtures/` contains deterministic valid and invalid contract examples.

`deploy/automation/` owns lifecycle policy and command implementation.
`deploy/cloudflare/` and `deploy/kubernetes/` own target-specific rendered
inputs. `deploy/compose/` owns the relocated local Compose inputs, while
`deploy/automation/local-compose/` owns their lifecycle policy. The wrappers
under `tools/` contain no composition policy. `deploy/tests/` owns executable
contract and lifecycle tests.

Secret values, Terraform state, generated release bundles, and target
credentials must never be committed under `deploy/`.
