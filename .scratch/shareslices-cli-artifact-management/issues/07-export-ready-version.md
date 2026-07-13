# Export an explicit ready Version

Status: done

## Parent

[ShareSlices CLI Artifact Management PRD](../PRD.md)

## What to build

Add Artifact Export for an explicit or interactively selected ready Version. Download the normalized ZIP to a predictable local filename, protect existing files by default, and keep Export independent from Publication state.

User stories covered: 44–48 and 54–60.

## Acceptance criteria

- [ ] Export accepts explicit Artifact and Version identifiers or resolves them through terminal selectors.
- [ ] Non-interactive Export never infers a Version and fails when required identifiers are absent.
- [ ] The default output filename combines a safe Artifact name and Version identifier in the current directory.
- [ ] `--output` selects a destination and the parent directory must exist.
- [ ] Existing output is preserved unless `--clobber` is present.
- [ ] Export works for Published and Unpublished Artifacts and does not modify Server state.
- [ ] The downloaded ZIP contains the complete normalized ready Version and never exposes object-storage URLs.
- [ ] Progress stays on stderr and `--no-progress` supports token-efficient agent use.
- [ ] Complete CLI-process, API service, OpenAPI, and YAML/Python contract tests cover download bytes, filenames, overwrite safety, authorization, and state gates.

## Blocked by

- [01-list-artifacts-with-gh-style-output](./01-list-artifacts-with-gh-style-output.md)
