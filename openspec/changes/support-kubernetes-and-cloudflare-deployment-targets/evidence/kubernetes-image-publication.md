# Kubernetes image publication evidence

<!-- cspell:words imagetools -->

## Qualified publication

On 2026-07-26, `mise run kubernetes-build-images` built and pushed the five
Kubernetes role images for source revision
`c75ff05838dd6eed90781e0afc39dd5121e93985` to
`ghcr.io/walnut1024/shareslices`. The checked builder used the
`docker-container` Buildx driver, `linux/amd64`, maximum provenance, and an SBOM
attestation for every image.

The generated `shareslices.kubernetes-images/v1` manifest has digest
`sha256:f85588b3534da365729242c343699ee22e29b2ba9427d829113d149e6fb8864f`
and records these registry content references:

- API:
  `ghcr.io/walnut1024/shareslices/api-image@sha256:fecf0f3e8168227845d244b06d3f687af6653b09a2453e024a1017cfb93cee3d`
- maintenance:
  `ghcr.io/walnut1024/shareslices/maintenance-image@sha256:0f72672cba08e4c665dec38a74a5279657bf4bfff7df849fc78880e5c19a54cf`
- content:
  `ghcr.io/walnut1024/shareslices/content-image@sha256:a8c12229aae3a0c58b2546d8cf27502e5452f3810bb151ed1edc0de5f7b52bd9`
- Web:
  `ghcr.io/walnut1024/shareslices/web-image@sha256:b0756d4a742f3356c11663bf435dfff9aad05aea3cfe6b9b26fded2fa35fd5d8`
- processing:
  `ghcr.io/walnut1024/shareslices/processing-image@sha256:7a849fd84528dae2a31cac83c567f01bb02ea8c27be078384485f9d980761490`

## Independent registry readback

Each reference above was read back from GHCR with
`docker buildx imagetools inspect`. Every top-level digest matched the generated
manifest, exposed one `linux/amd64` image manifest, and exposed a distinct OCI
attestation manifest. This proves the references are registry-addressable by
digest rather than only present in local Buildx metadata.

## Reconciled platform drift

The first publication attempt exposed that the previously pinned Debian
Bookworm Chromium package had left the live repository. The current
`bookworm-security` package index was queried for all three packages, and
`worker/Dockerfile` was advanced as one atomic pin from
`150.0.7871.114-1~deb12u1` to `150.0.7871.181-1~deb12u1`. A standalone
`linux/amd64` cache-only build then completed the full Worker runtime target,
including `chromium --version`, before the qualifying source revision was
committed and published.

Four images from the earlier incomplete source revision may remain in GHCR, but
they have no complete generated release manifest and are not qualified release
candidates. The five references above are the qualified set.
