# CLI GitHub Release Design

## Context

The Rust CLI already embeds the package version in compatibility requests. Distribution must preserve that version as an immutable, user-installable binary without creating a second implementation of CLI behavior.

## Goals / Non-Goals

**Goals:**

- Use GitHub Releases as the canonical binary source.
- Produce native release artifacts for the principal desktop and server targets.
- Make releases reproducible from a version tag and reject accidental tag/package mismatches.
- Publish checksums alongside every downloadable binary archive.

**Non-Goals:**

- Shell or PowerShell installers, self-update, uninstall support, package managers, code signing, notarization, or an npm wrapper.
- Linux ARM64 and Windows ARM64 binaries.
- Changing CLI commands, Server compatibility policy, or Skill behavior.

## Decisions

- **CLI-specific tags.** A `cli-v<version>` tag releases only the CLI. This avoids coupling CLI releases to future Web, API, or Worker deployment tags.
- **Hosted runners with an explicit Rust target.** Linux and Windows build natively. Both macOS targets build on the available Apple Silicon macOS runner; the Intel target is cross-compiled with the Apple SDK already present on that runner. This avoids making Release availability depend on the constrained Intel macOS runner queue.
- **One archive per target.** Unix targets use `.tar.gz`; Windows uses `.zip`. Each archive contains the platform-native `shareslices` executable at its root.
- **Checksums are a Release asset.** The publishing job generates `SHA256SUMS` from the exact uploaded archives and attaches it to the same Release.
- **Manifest version is authoritative.** The release tag version must equal `cli/Cargo.toml`; a mismatch fails before any artifacts are built.

## Risks / Trade-offs

- **Unsigned binaries may produce OS warnings** → signing and notarization remain explicit follow-up work; checksums provide first-release integrity verification.
- **Hosted-runner availability can change** → use GitHub-maintained runner labels and keep the target matrix localized in one workflow.
- **A release only proves native build success** → retain local Rust quality gates and add package-manager or installer testing only when those distribution paths exist.
