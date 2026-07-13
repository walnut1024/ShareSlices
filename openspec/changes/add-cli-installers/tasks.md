# CLI Installer Tasks

## 1. Installer Assets

- [x] 1.1 Add a Shell installer for supported macOS and Linux targets with explicit-version support and SHA-256 verification.
- [x] 1.2 Add a PowerShell installer for Windows x86-64 with SHA-256 verification and user PATH handling.
- [x] 1.3 Attach both installer scripts and checksums to every CLI GitHub Release.

## 2. npm Distribution

- [x] 2.1 Add a thin `@shareslices/cli` npm launcher that downloads and verifies its matching Release binary during installation.
- [x] 2.2 Enforce matching Rust, npm, and release-tag versions before building Release artifacts.
- [x] 2.3 Add a post-Release npm Trusted Publishing job gated by repository configuration.

## 3. Documentation and Verification

- [x] 3.1 Document Shell, PowerShell, and npm installation commands and supported targets.
- [ ] 3.2 Publish and verify installer assets in a GitHub Release.
- [ ] 3.3 Configure the `@shareslices` npm scope for Trusted Publishing and publish the npm package.
