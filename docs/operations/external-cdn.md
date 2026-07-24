# Kubernetes external CDN

This runbook applies only when a Kubernetes installation uses an
operator-managed CDN in front of its Kubernetes ingress. It is provider-neutral:
the operator may choose Cloudflare or another CDN, but ShareSlices still runs
only the Kubernetes target.

External-CDN mode never deploys the Cloudflare target's App, Content, or Jobs
Workers, R2 storage, Queues, Cron Triggers, Durable Objects, or Containers.

## Select the delivery mode

Set the production discriminator to `target: kubernetes` and select:

```json
{
  "kubernetes": {
    "delivery": {"mode": "external-cdn"},
    "ingress": {
      "externalCdn": {
        "enabled": true,
        "provider": "operator-provider-name",
        "originOrigins": {
          "application": "https://origin-app.example.test",
          "content": "https://origin-content.example-content.test"
        },
        "originAccess": {
          "mode": "provider-address-ranges",
          "evidenceRevision": "provider-origin-access-v1"
        },
        "trustedProxy": {
          "sourceCidrs": ["192.0.2.0/24"],
          "clientAddressHeader": "forwarded",
          "evidenceRevision": "provider-proxy-contract-v1"
        }
      }
    }
  }
}
```

The public application and content origins under `shared.publicOrigins` are the
edge addresses that Users reach. `originOrigins` are separate HTTPS addresses
used for origin access and edge-versus-origin verification.

Direct mode instead sets `delivery.mode: direct` and
`externalCdn.enabled: false`; provider, origin, access, and trusted-proxy fields
must then be absent.

## Protect the origin

Choose and evidence one origin-access mode:

- `provider-address-ranges` restricts origin ingress to the provider ranges
  recorded by the operator. Refresh the allowlist and its evidence revision
  when the provider changes it.
- `authenticated-origin` uses a provider-supported authenticated origin
  mechanism. The credential remains operator-owned Secret material and must not
  appear in configuration, renders, plans, or logs.

Both origin application and content addresses require valid HTTPS and must
retain the same route separation as the public edge. Do not expose internal
capture, maintenance, migration, or deployment-control routes to either
address.

Origin restriction is not trusted-client attribution. Configure the ingress
runtime to accept exactly one declared `Forwarded` or `X-Forwarded-For` chain
only from the recorded provider CIDRs. Requests reaching the origin from any
other source must have forwarding metadata discarded. Never trust a
client-supplied forwarding header merely because the deployment uses a CDN.

The content origin must remain on a different browser registrable site from the
management application origin when the enabled product capabilities require
that boundary. A sibling subdomain or another port is not a substitute.

## Cache policy

Generate provider rules from
[`deploy/contract/cache-projection.json`](../../deploy/contract/cache-projection.json).
The current external-CDN safe default is:

- Cache only content-hashed Web JavaScript, CSS, fonts, images, and equivalent
  immutable build assets.
- Include the request path and content encoding in the representation identity.
- Preserve the origin content type, content encoding, validators, and security
  headers.
- Treat HTML, runtime bootstrap, and other release-coupled entry documents as
  revalidated rather than immutable.

The following families must bypass storage and replay:

- API and management operations;
- sign-in, account, Cookie-session, and authenticated responses;
- Upload, export, mutation, and operation-recovery responses;
- Preview entry and assets;
- stable Viewer entry and assets, including known-link state;
- authorized Gallery content and review routes;
- Gallery dynamic metadata and downloads unless a later checked contract
  explicitly classifies one representation cacheable;
- health/readiness and runtime configuration;
- internal and forbidden routes.

For every response with `Cache-Control: no-store`, the CDN must forward without
storing it. Do not override `no-store` with a provider page rule, cache rule,
surrogate header, default heuristic, stale-if-error policy, or edge function.
Responses containing `Set-Cookie`, authorization-dependent content, redirects,
errors, or partial Range content are not made cacheable merely because the
provider supports caching them.

The optional Cloudflare-target Viewer byte cache is not part of this Kubernetes
external-CDN mode. Enabling an external CDN does not authorize caching outward
Viewer responses or exposing private object storage.

## Plan and rollout

1. Configure the two public edge origins, two separate origin origins,
   origin-access evidence, provider CIDRs, trusted client-address header, TLS,
   and the cache/bypass rules.
2. Run read-only prerequisite checks and render:

   ```sh
   mise run deploy -- doctor --config deployment.json --release release.json
   mise run deploy -- render --config deployment.json --release release.json
   ```

3. Generate and review a plan. It must remain `target: kubernetes` and contain
   only the provider-neutral external-CDN contract, not Cloudflare runtime
   resources:

   ```sh
   mise run deploy -- plan \
     --config deployment.json \
     --release release.json \
     --operation apply
   ```

4. Apply the authorized Kubernetes plan. Configure or reconcile the external
   CDN through its separately declared operator; the ShareSlices Module does not
   create the CDN account.
5. Keep direct origin access available to the verifier until parity succeeds.
   Do not retire the previous edge configuration or promote the release based
   only on a healthy edge response.

## Verification

Run the shared verifier after the edge configuration is active:

```sh
mise run deploy -- verify --config deployment.json --release release.json
```

External-CDN verification runs the same credential-free core scenarios against
the public edge and the configured origin addresses. It compares their
canonical evidence, including:

- status and redirect behavior;
- route ownership and forbidden-route results;
- security, CORS, Cookie, and cache headers;
- dynamic `no-store` behavior;
- content-origin separation and private-storage non-exposure.

Both observations must pass and their evidence digests must match. A response
that is merely reachable, a provider cache status header, or a matching body
without matching status and headers is insufficient.

Deep acceptance additionally exercises repeated immutable-asset requests and
origin instrumentation, then checks authorization transitions and
Unpublish/expiry/restriction behavior. It must prove a non-cacheable request
reaches the current origin contract again. Until that target-specific deep gate
passes, external-CDN readiness remains unavailable even if direct Kubernetes
verification passes.

## Failure and rollback

If edge and origin evidence differs:

1. stop promotion and keep the Kubernetes release unverified;
2. disable or narrow the offending cache rule;
3. purge only the positively identified immutable asset keys affected by the
   rule;
4. verify dynamic routes through the origin and edge again;
5. retain evidence showing the old response is no longer replayed.

For an urgent CDN outage or unsafe cache configuration, direct public ingress
may be restored only through an authorized plan that changes
`delivery.mode` and the matching `externalCdn` declaration together. DNS or
traffic switching remains operator-controlled. Application rollback still
follows the Kubernetes rollback contract and never performs a down migration;
CDN rollback does not change the deployment target or restore database/object
state.
