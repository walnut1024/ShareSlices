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

### Requirement: Homebrew Formula installs the matching verified native binary

The `walnut1024/homebrew-tap` Formula SHALL install only a native archive from an explicit CLI GitHub Release version and SHALL declare the corresponding SHA-256 checksum.

#### Scenario: Homebrew installation

- **WHEN** a supported-platform user runs `brew install walnut1024/tap/shareslices`
- **THEN** Homebrew installs the checksum-verified native CLI binary for that platform

### Requirement: Preserve the CLI distribution version contract

The GitHub Release workflow SHALL reject a release when its tag version differs from the Rust CLI package version. Formula synchronization SHALL not be required for GitHub Release creation.

#### Scenario: release version mismatch

- **WHEN** a `cli-v<version>` tag differs from `cli/Cargo.toml`
- **THEN** the workflow fails before building or publishing release assets
