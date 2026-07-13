# CLI Installation Specification Delta

## ADDED Requirements

### Requirement: Install the CLI through official platform installers

Each CLI GitHub Release SHALL include `install.sh` and `install.ps1`. The Shell installer SHALL support macOS Apple Silicon, macOS Intel, and Linux x86-64; the PowerShell installer SHALL support Windows x86-64. Each installer SHALL download the matching Release archive, verify it against the Release `SHA256SUMS` asset, and fail without installing on a checksum mismatch.

#### Scenario: Shell installation selects the current macOS binary

- **WHEN** an Apple Silicon macOS user runs the official Shell installer without a version
- **THEN** it downloads the current `aarch64-apple-darwin` archive, verifies its SHA-256 checksum, and installs the executable in the selected user-local directory

#### Scenario: Unsupported platform installation

- **WHEN** an installer runs on an unsupported operating system or CPU architecture
- **THEN** it fails before downloading an archive and identifies the unsupported platform

### Requirement: npm package installs the matching verified native binary

The `@shareslices/cli` npm package SHALL expose a `shareslices` command and SHALL install only the native archive whose version equals its npm package version. It SHALL verify the archive against the matching Release `SHA256SUMS` asset before exposing the command.

#### Scenario: npm global installation

- **WHEN** a supported-platform user runs `npm install -g @shareslices/cli`
- **THEN** npm installs a launcher that invokes the checksum-verified native CLI binary for that platform

### Requirement: Preserve the CLI distribution version contract

The GitHub Release workflow SHALL reject a release when its tag version differs from either the Rust CLI package version or the npm package version. npm publication SHALL not be required for GitHub Release creation.

#### Scenario: npm version mismatch

- **WHEN** a `cli-v<version>` tag matches `cli/Cargo.toml` but differs from `cli/npm/package.json`
- **THEN** the workflow fails before building or publishing release assets
