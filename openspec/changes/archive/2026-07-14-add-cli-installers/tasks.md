# CLI Installer Tasks

## 1. Installer Assets

- [x] 1.1 Add a Shell installer for supported macOS and Linux targets with explicit-version support and SHA-256 verification.
- [x] 1.2 Add a PowerShell installer for Windows x86-64 with SHA-256 verification and user PATH handling.
- [x] 1.3 Attach both installer scripts and checksums to every CLI GitHub Release.

## 2. Homebrew Distribution

- [x] 2.1 Create a public `walnut1024/homebrew-tap` repository and Formula backed by immutable Release archives.
- [x] 2.2 Add a post-Release Formula synchronization job gated by repository configuration.

## 3. Documentation and Verification

- [x] 3.1 Document Shell, PowerShell, and Homebrew installation commands and supported targets.
- [x] 3.2 Publish and verify installer assets in a GitHub Release.
- [x] 3.3 Configure a cross-repository token and enable automatic Formula synchronization.
