# CLI Installer Design

## Context

GitHub Releases are the canonical source for ShareSlices CLI binaries. Installation channels must not become alternate binary builders or bypass Release checksums.

## Goals / Non-Goals

**Goals:**

- Support common macOS/Linux Shell, Windows PowerShell, and Homebrew installation flows.
- Resolve the current supported OS and CPU architecture deterministically.
- Verify each downloaded archive against the Release `SHA256SUMS` asset before installation.
- Keep Homebrew as a Formula over the exact published binary archive.

**Non-Goals:**

- npm, WinGet, self-update commands, uninstall commands, code signing, notarization, or support for unsupported target triples.
- A REST fallback for the CLI.
- Automatic Formula updates before a cross-repository GitHub token is configured.

## Decisions

- **One Release source.** Shell, PowerShell, and Homebrew download immutable archives from the matching GitHub Release. Each installer also downloads `SHA256SUMS` and refuses an archive with a different SHA-256 digest; the Formula records the corresponding immutable SHA-256 value.
- **Stable installer asset names.** `install.sh` and `install.ps1` are attached to every CLI Release. GitHub's `releases/latest/download` path makes the default installation command select the newest release; installer options select an explicit version.
- **Supported target mapping.** Shell and Homebrew support macOS Apple Silicon and Linux x86-64. PowerShell supports Windows x86-64.
- **User-local installations.** Shell defaults to `~/.local/bin` and does not rewrite shell startup files. PowerShell defaults to `%LOCALAPPDATA%\\ShareSlices\\bin` and adds that directory to the user PATH when absent.
- **Formula synchronization.** The `walnut1024/homebrew-tap` Formula is updated manually for the first release. Future synchronization is a post-Release job gated by `HOMEBREW_TAP_SYNC_ENABLED=true` and a cross-repository GitHub token.

## Risks / Trade-offs

- **Piping remote scripts executes new code immediately** → Release assets remain visible and downloadable for inspection, and every binary archive is checksum-verified before installation.
- **Formula updates require a second repository write** → preserve a gated synchronization job rather than storing a cross-repository credential in source or making GitHub Release availability depend on the tap update.
