# CLI Installer Design

## Context

GitHub Releases are the canonical source for ShareSlices CLI binaries. Installation channels must not become alternate binary builders or bypass Release checksums.

## Goals / Non-Goals

**Goals:**

- Support common macOS/Linux Shell, Windows PowerShell, and npm installation flows.
- Resolve the current supported OS and CPU architecture deterministically.
- Verify each downloaded archive against the Release `SHA256SUMS` asset before installation.
- Keep npm as a thin launcher over the exact binary version that it declares.

**Non-Goals:**

- Homebrew, WinGet, self-update commands, uninstall commands, code signing, notarization, or support for unsupported target triples.
- A Node.js reimplementation or a REST fallback for the CLI.
- Publishing to npm before the `@shareslices` scope configures GitHub Trusted Publishing.

## Decisions

- **One Release source.** Shell, PowerShell, and npm download immutable archives from the matching GitHub Release. Each installer also downloads `SHA256SUMS` and refuses an archive with a different SHA-256 digest.
- **Stable installer asset names.** `install.sh` and `install.ps1` are attached to every CLI Release. GitHub's `releases/latest/download` path makes the default installation command select the newest release; installer options select an explicit version.
- **Supported target mapping.** Shell supports macOS Apple Silicon, macOS Intel, and Linux x86-64. PowerShell supports Windows x86-64. npm supports the same matrix and fails before download for other platform/architecture pairs.
- **User-local installations.** Shell defaults to `~/.local/bin` and does not rewrite shell startup files. PowerShell defaults to `%LOCALAPPDATA%\\ShareSlices\\bin` and adds that directory to the user PATH when absent.
- **Strict three-way version contract.** The `cli-v<version>` tag, Rust package version, and `@shareslices/cli` version must match before Release builds begin. npm publication is a separate post-Release job gated by `NPM_PUBLISH_ENABLED=true` and npm Trusted Publishing configuration.

## Risks / Trade-offs

- **Piping remote scripts executes new code immediately** → Release assets remain visible and downloadable for inspection, and every binary archive is checksum-verified before installation.
- **npm requires a Node runtime at installation time** → npm is optional; the installed CLI remains a native binary and does not require Node to run.
- **The npm scope is not configured yet** → preserve a gated Trusted Publishing job rather than storing an npm credential in the repository or making GitHub Release availability depend on npm publication.
