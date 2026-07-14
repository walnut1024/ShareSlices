# CLI GitHub Release Proposal

## Why

The ShareSlices CLI is implemented but cannot be installed as a versioned binary outside a source checkout. A GitHub Release contract is needed before package managers, install scripts, or the official Skill can rely on the CLI.

## What Changes

- Release the `shareslices` CLI when a `cli-v<package-version>` tag is pushed.
- Build native macOS Intel, macOS Apple Silicon, Linux x86-64, and Windows x86-64 binaries.
- Publish one archive per target plus `SHA256SUMS` in the GitHub Release.
- Reject a release tag whose version does not match `cli/Cargo.toml`.

## Capabilities

### New Capabilities

- `cli-distribution`: versioned GitHub Release artifacts for the ShareSlices CLI.

### Modified Capabilities

None.

## Impact

- GitHub Actions release workflow.
- CLI user documentation describing tag and artifact conventions.
