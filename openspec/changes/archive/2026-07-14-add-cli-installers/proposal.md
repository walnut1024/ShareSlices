# CLI Installer Proposal

## Why

The CLI GitHub Release provides verified archives but requires users and agents to choose an asset, verify it, and manage the executable manually. Official Shell, PowerShell, and Homebrew entry points are needed to make the same binary installable through common platform workflows.

## What Changes

- Add checksum-verifying Shell and PowerShell installers as GitHub Release assets.
- Add the `walnut1024/homebrew-tap` Formula, which installs the matching GitHub Release binary.
- Keep the `cli-v<version>` tag and Rust package version aligned.
- Add optional automatic Formula synchronization after the GitHub Release completes.

## Capabilities

### New Capabilities

- `cli-installation`: install and update the published CLI through official Shell, PowerShell, and Homebrew entry points.

### Modified Capabilities

- `cli-distribution`: publish official installers and preserve one version contract across the Rust CLI and release tag.

## Impact

- GitHub Release workflow and release assets.
- CLI installation documentation and Homebrew Formula.
