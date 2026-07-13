# CLI Installer Proposal

## Why

The CLI GitHub Release provides verified archives but requires users and agents to choose an asset, verify it, and manage the executable manually. Official Shell, PowerShell, and npm entry points are needed to make the same binary installable through common platform workflows.

## What Changes

- Add checksum-verifying Shell and PowerShell installers as GitHub Release assets.
- Add the `@shareslices/cli` npm package, which installs the matching GitHub Release binary rather than bundling a separate CLI implementation.
- Require the Rust package version, npm package version, and `cli-v<version>` tag to match.
- Add optional npm Trusted Publishing after the GitHub Release completes.

## Capabilities

### New Capabilities

- `cli-installation`: install and update the published CLI through official Shell, PowerShell, and npm entry points.

### Modified Capabilities

- `cli-distribution`: publish official installers and preserve one version contract across the Rust CLI, npm package, and release tag.

## Impact

- GitHub Release workflow and release assets.
- CLI installation documentation.
- npm package metadata and launcher scripts.
