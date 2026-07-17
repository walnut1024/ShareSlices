# Consolidate the Local Development Stack

## Why

ShareSlices currently exposes three overlapping local launch paths that select different process models, Gallery states, and canonical hosts. The ambiguity makes routine restart commands switch between `127.0.0.1` and `app.localhost`, permits stale Worker images, and lets integration tests disrupt the developer's running stack.

## What Changes

- Make `mise run dev` the single canonical full-stack lifecycle entrypoint and keep the trusted Web origin stable at `http://app.localhost:5173` with isolated content at `http://content.localhost:7460`.
- Add one stack controller that owns build, migration, recreate, readiness, status, logs, and shutdown behavior.
- Add explicit `dev-status` and `dev-logs` entrypoints and make startup return only after required services are healthy.
- Replace the public `dev-infra`, `dev-compose`, `dev-gallery`, and `dev-worker-build` variants with the unified lifecycle; keep unrelated maintenance and bootstrap operations clearly separated from startup.
- Bind locally published service ports to loopback by default.
- Move API integration orchestration to a separate Compose project so tests cannot stop, reconfigure, or leave behind the developer stack.
- Remove duplicated local defaults from the legacy host-process launcher and update durable development documentation to the unified contract.

## Capabilities

### New Capabilities

- `local-development-stack`: Defines the canonical local topology, lifecycle commands, readiness guarantees, latest-code behavior, and test isolation.

### Modified Capabilities

None.

## Impact

- `.mise.toml`, local Compose configuration, and scripts under `tools/`.
- Root package test orchestration and local port publication.
- `README.md`, repository agent guidance, and Gallery local operations documentation.
- No product behavior, public HTTP contract, production deployment topology, or runtime dependency changes.
