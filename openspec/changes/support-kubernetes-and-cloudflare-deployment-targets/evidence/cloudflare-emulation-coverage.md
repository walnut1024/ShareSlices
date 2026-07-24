# Cloudflare emulation coverage

Evidence date: 2026-07-25

Task 11.16 separates locally testable contracts from behavior that requires a
deployed Cloudflare staging resource. The executable classification is
[`deploy/cloudflare/emulation-coverage.json`](../../../../deploy/cloudflare/emulation-coverage.json).
Its test verifies that every local row names existing evidence and that
provider-only rows cannot silently become local qualification.

Local contract coverage currently includes:

- App Worker dynamic-route precedence and Web-only Static Assets fallback;
- content-only route and dependency least authority;
- route-free App and Content Service Binding version-evidence handlers;
- Jobs Queue, scheduled-gate, and private-binding configuration; and
- R2 Adapter and private-bucket control contracts.

These rows use direct entrypoint tests, generated Wrangler configuration tests,
dependency-authority checks, and binding-level tests. They do not claim that a
Node test is a deployed Worker or that a simulated binding is a provider
resource.

The following remain staging-only:

- actual deployed Worker runtime and compatibility behavior;
- edge Static Assets precedence and response headers;
- deployments, version selection, and external version overrides;
- Hyperdrive origin TLS, freshness, and connection budget;
- Queue and Cron control-plane state and propagation;
- private R2 streaming and range transport;
- Container isolation and rollout; and
- custom-domain and separate registrable-site routing.

An attempted raw Miniflare run was deliberately not retained as evidence. The
exact dry-run bundles require Worker-specific Node compatibility and dynamic
module handling that raw Miniflare does not reproduce from `scriptPath`; making
the harness pass with undocumented fallback behavior would weaken rather than
strengthen staging qualification. Existing provider prototype evidence remains
the runtime proof until the complete staging rows run.

Current first-party documentation confirms that local development simulates
bindings while version metadata is not an accurate deployed-version identity,
Static Assets are served from local disk, and provider-specific behavior may
require remote or deployed verification:

- [Workers local development](https://developers.cloudflare.com/workers/local-development/)
- [Supported bindings per development mode](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)
- [Static Assets Worker-first routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)

Task 11.16 remains open until the staging-required rows have current redacted
evidence and all disposable routes, triggers, consumers, and Workers are
removed or disabled afterward.
