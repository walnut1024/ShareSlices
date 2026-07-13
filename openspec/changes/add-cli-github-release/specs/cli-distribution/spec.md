# CLI Distribution Specification Delta

## ADDED Requirements

### Requirement: Publish versioned CLI binaries from GitHub Releases

The repository SHALL create a GitHub Release when a `cli-v<version>` tag is pushed and `<version>` equals the `shareslices-cli` package version. The Release SHALL contain native archives for macOS Intel, macOS Apple Silicon, Linux x86-64, and Windows x86-64.

#### Scenario: Matching CLI release tag

- **WHEN** a `cli-v<version>` tag matching `cli/Cargo.toml` is pushed
- **THEN** the workflow publishes the `shareslices` executable archives and generated release notes in a GitHub Release for that tag

#### Scenario: Mismatched CLI release tag

- **WHEN** a `cli-v<version>` tag does not match `cli/Cargo.toml`
- **THEN** the workflow fails before building or publishing any release artifact

### Requirement: Publish checksums for every CLI archive

Every CLI GitHub Release SHALL contain a `SHA256SUMS` asset listing a SHA-256 checksum for every published CLI archive.

#### Scenario: Consumer verifies a downloaded archive

- **WHEN** a consumer downloads a CLI archive and the Release `SHA256SUMS` file
- **THEN** the file contains a checksum entry named for that archive
