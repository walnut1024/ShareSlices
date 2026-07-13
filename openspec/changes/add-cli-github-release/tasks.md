# CLI GitHub Release Tasks

## 1. Release Contract

- [x] 1.1 Define the CLI-only tag format, supported target matrix, archive names, and checksum asset.
- [x] 1.2 Define the release tag/package-version compatibility check.

## 2. GitHub Release Workflow

- [x] 2.1 Build the CLI on native macOS Intel, macOS Apple Silicon, Linux x86-64, and Windows x86-64 runners.
- [x] 2.2 Package and collect one executable archive for each target.
- [x] 2.3 Generate `SHA256SUMS` and create a GitHub Release with generated notes.

## 3. Documentation and Verification

- [x] 3.1 Document the tag and artifact contract in the CLI documentation.
- [ ] 3.2 Push a real `cli-v<version>` tag and verify the GitHub Release artifacts from the hosted workflow.
