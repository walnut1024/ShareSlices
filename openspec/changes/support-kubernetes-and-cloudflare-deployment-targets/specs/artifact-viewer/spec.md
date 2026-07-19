# artifact-viewer Delta Specification

## MODIFIED Requirements

### Requirement: Resolve configured Share-link routes

The Viewer SHALL resolve `/a/{shareSlug}/` and its asset paths from the configured Viewer address. The same Viewer behavior MUST work when deployment configuration uses Docker Compose ports, Kubernetes IP addresses and ports without DNS, public Kubernetes ingress domain names, Kubernetes ingress behind an external CDN, or a Cloudflare Worker route and custom domain.

Enabling an external Kubernetes CDN MUST NOT replace the configured Viewer address with an origin address, and the Cloudflare target MUST NOT expose an internal Worker, R2, Container, or provider-generated address unless that address is explicitly the configured public Viewer address. Edge routing MUST preserve the complete Share-slug path, trailing-slash base, method, status, response headers, and application authorization result.

The Viewer route group MUST NOT expose management operations.

#### Scenario: Viewer uses an IP and port

- **WHEN** an intranet deployment configures the Viewer with an IP address and port
- **THEN** generated Share links and Viewer route resolution use that configured address without requiring a domain name

#### Scenario: Viewer uses a public domain

- **WHEN** public production configures a Viewer domain
- **THEN** generated Share links and Viewer route resolution use that configured domain without changing application behavior

#### Scenario: Viewer requests a management route

- **WHEN** a request reaches the Viewer route group for a management operation
- **THEN** the Viewer route group does not serve that operation

#### Scenario: Viewer uses Kubernetes without a CDN

- **WHEN** a Kubernetes deployment routes the configured Viewer address directly to its public ingress
- **THEN** generated Share links and Viewer route resolution preserve the configured address and existing Viewer behavior

#### Scenario: Viewer uses Kubernetes with an external CDN

- **WHEN** the same Kubernetes deployment enables an external CDN in front of its Viewer ingress
- **THEN** generated Share links remain on the configured Viewer address and the CDN forwards the complete Viewer route without changing its authorization or response semantics

#### Scenario: Viewer uses a Cloudflare custom domain

- **WHEN** a Cloudflare deployment binds the configured Viewer address to its trusted App Worker
- **THEN** generated Share links use that configured address and the Worker resolves the complete Viewer route without exposing a Worker, R2, or Container implementation address

### Requirement: Disable Preview and Viewer caching

Version 0.0.1 SHALL send `Cache-Control: no-store` on Preview entry, Preview asset, Viewer entry, Viewer asset, and known-link state responses.

Every supported deployment Adapter and intermediary MUST deliver that directive to the browser without a more permissive edge-cache override. Direct Kubernetes ingress, an enabled Kubernetes external CDN, and Cloudflare Worker delivery MUST NOT store or reuse the stable Preview or Viewer response in a shared cache, provider cache, Static Assets fallback, or another target-specific response cache. Cache purge, short TTL, immutable object keys, or a changed public cache key MUST NOT substitute for resolving each stable Preview or Viewer path against current authoritative state.

The Cloudflare target MAY offer an optional internal immutable-byte cache for a publicly accessible Viewer asset. Before each cache lookup, the trusted App Worker MUST resolve the stable Share route against current Publication state, authorize access, and fix one committed Version.

The cache identity MUST include that Version's content identity, normalized manifest path, and a canonical representation descriptor. That descriptor SHALL include content type, content encoding, renderer or format revision, and every allowed response-negotiation input; the Worker MUST NOT vary a cacheable response on an input omitted from the identity. Share slugs, Cookies, authorization headers, Preview grants, and mutable Publication state MUST remain excluded. Only a complete bounded `200` representation MAY populate or use this cache; a Range request or `206 Partial Content` response MUST bypass it and use an authorized private R2 range read.

The internal cache representation and outward Viewer response MUST be distinct responses. Internal cacheability metadata MUST NOT replace the stable response's product status, content type, security headers, range behavior, or `Cache-Control: no-store`, and the outward no-store response MUST NOT be supplied to Cache API storage. Cached bytes MUST be reachable only through the Worker after current authorization; private R2 and the internal cache identity MUST NOT become public object routes. Disabling this option MUST preserve equivalent Viewer behavior through direct private R2 reads.

#### Scenario: Artifact is Unpublished after viewing

- **WHEN** a Viewer requests the stable Share link after the Owner has Unpublished it
- **THEN** the browser revalidates through the server and receives the Unpublished state instead of cached Artifact content

#### Scenario: Publication expires after viewing

- **WHEN** a Viewer requests the stable Share link after the Publication's scheduled end
- **THEN** the browser revalidates through the server and receives the Expired state instead of cached Artifact content

#### Scenario: Publication changes between asset requests

- **WHEN** Publication changes between requests to the same stable Viewer asset path
- **THEN** each response is resolved by the server without reusing a cached response from the previous Publication

#### Scenario: Kubernetes CDN receives a Viewer response

- **WHEN** an enabled external CDN fronts a Kubernetes Viewer route that returns `Cache-Control: no-store`
- **THEN** the CDN forwards the response without storing it and the next request reaches authoritative Viewer resolution

#### Scenario: Cloudflare receives a Viewer response

- **WHEN** the Cloudflare App Worker returns a Viewer entry, asset, or known-link state response
- **THEN** Cloudflare edge response cache and Static Assets do not store or satisfy that stable Viewer path, and any optional immutable-byte cache is consulted only after current Publication authorization

#### Scenario: Cloudflare reuses immutable Viewer bytes

- **WHEN** optional Viewer byte caching is enabled, the current Publication authorizes a committed Version asset, and the same Version content identity and normalized path already exist in the internal edge cache
- **THEN** the Worker may reuse those bytes after authorization while preserving the stable Viewer response's `no-store`, content type, security headers, and path behavior

#### Scenario: Viewer representations vary by encoding or format

- **WHEN** two authorized full-body responses vary by content encoding, content type, renderer revision, or another negotiated representation input
- **THEN** they use distinct internal cache identities or bypass the cache rather than reusing bytes under an incomplete key

#### Scenario: Cloudflare serves a Viewer Range request

- **WHEN** an authorized stable Viewer asset request asks for a byte range while optional Viewer caching is enabled
- **THEN** the Worker bypasses the internal Cache API, reads the authorized private R2 range, and preserves the outward `206` and `no-store` contract

#### Scenario: Publication closes after bytes were cached

- **WHEN** a Publication expires, is Unpublished, is replaced, or becomes restricted after its Version bytes entered the internal edge cache
- **THEN** the next stable Viewer request fails current Publication authorization and cannot receive those cached bytes regardless of purge state

#### Scenario: Viewer byte caching is disabled

- **WHEN** the Cloudflare deployment selects the default Web-assets-only edge mode
- **THEN** Viewer authorization and responses remain equivalent and authorized immutable bytes are streamed from private R2 without using the optional internal byte cache

#### Scenario: Cloudflare receives a Preview response

- **WHEN** the Cloudflare App Worker returns a Preview entry or asset response
- **THEN** the response retains `Cache-Control: no-store` and every later request re-enters Owner authorization and current Version resolution

#### Scenario: Static deployment asset shadows a dynamic path

- **WHEN** a CDN or Workers Static Assets manifest contains a file or fallback that could match a Preview or Viewer path
- **THEN** the shared route contract gives the dynamic application route priority and the static object does not satisfy the request
