# Normalize Artifact Archives — Design

## Context

The Worker currently validates every regular ZIP entry as Artifact content and requires a root `index.html`. A macOS-created ZIP can therefore fail because an AppleDouble `._*` entry has an `.html` suffix but binary metadata content. A ZIP containing one valid root HTML page under a document-derived filename then fails the entry-file requirement even though the intended entry is unambiguous.

This change separates three concepts:

- **Raw archive**: the immutable ZIP uploaded by the client and retained only according to existing recovery policy.
- **Effective archive**: the safe, normalized set of entries the Worker treats as Artifact content.
- **Validation report**: structured blocking issues and non-blocking warnings produced while deriving and validating the effective archive.

## Goals

- Absorb deterministic operating-system packaging noise without user action.
- Accept a non-`index.html` entry only when the intended root HTML is unambiguous.
- Preserve relative paths and never rewrite uploaded HTML.
- Return enough structured information for Web, CLI, and direct API clients to explain what failed and how to correct it.
- Keep the Worker as the authoritative security boundary.

## Non-goals

- Guess among multiple HTML entry candidates.
- Rewrite HTML, CSS, JavaScript, or root-absolute asset references.
- Repair malformed ZIP structures or unsafe paths.
- Accept unsupported content because a client preflight missed it.
- Define the future CLI command interface in this change.

## Normalization pipeline

The Worker applies these steps in order:

1. Parse the ZIP and enforce the raw archive-size snapshot.
2. Normalize and validate every entry path, reject duplicates, and reject links or special files.
3. Classify known operating-system metadata.
4. Derive the effective archive without classified metadata.
5. Remove one common top-level wrapper directory only when every effective entry is below it and stripping it creates no empty or duplicate path.
6. Resolve the entry file from normalized effective paths.
7. Enforce effective file-count, expanded-size, single-file-size, extension, and content rules.
8. Store only validated effective files and their normalized paths.

Path safety runs before metadata classification. An unsafe path cannot become acceptable by resembling ignored metadata.

Each validated entry retains both `sourcePath`, used to read the immutable raw ZIP, and `effectivePath`, used for staging keys, committed keys, manifest assets, validation details, and Viewer routing. Metadata filtering leaves no entry to extract. Wrapper removal changes only `effectivePath`; extraction never looks up the rewritten path in the raw ZIP.

## Known operating-system metadata

The initial compatibility set is deliberately narrow:

- any entry below a top-level `__MACOSX/` directory;
- any file whose basename starts with `._`;
- any file whose basename is `.DS_Store`.

Ignored metadata remains part of the raw ZIP and therefore counts toward the raw archive-size limit. It does not count toward effective file-count, expanded-size, or single-file limits; it is not format-validated, stored as a committed asset, or included in the manifest.

The report contains one bounded `ignored_system_metadata` warning with the ignored count and a bounded sample of sanitized paths. Adding other operating-system files requires a future explicit policy decision; this change does not introduce a generic hidden-file ignore rule.

## Wrapper-directory normalization

The Worker removes exactly one top-level directory when all effective files share that directory. It strips the prefix from every effective path together, preserving relative relationships. It does not repeatedly flatten nested directories and does not strip when any effective file already exists at the root.

The Worker emits `wrapper_directory_removed` with the removed directory name. A normalization that would create an empty path or duplicate normalized path is rejected.

## Entry-file resolution

Entry resolution runs after metadata filtering and optional wrapper removal:

1. If the effective root contains exactly `index.html`, use it.
2. Otherwise, if the effective root contains exactly one `.html` file, use that file.
3. If no root HTML exists, return `missing_entry_file` and include a bounded list of nested HTML candidates when present.
4. If multiple root HTML files exist without `index.html`, return `ambiguous_entry_file` and include the candidates.

The inferred file retains its normalized filename. The manifest records it as `entryFile`, and Preview and Viewer root routes serve that committed file. ShareSlices does not create a synthetic `index.html` and does not rewrite content. Successful inference emits `entry_file_inferred`.

## Validation report contract

Processing produces a report with one primary blocking issue, optional additional blocking issues, and non-blocking warnings:

```json
{
  "primaryIssue": {
    "code": "single_file_too_large",
    "message": "The file exceeds the allowed size.",
    "action": "Reduce or split the file, then upload a new ZIP.",
    "details": {
      "path": "data/report.json",
      "actualBytes": 66479718,
      "limitBytes": 52428800
    }
  },
  "issues": [],
  "warnings": []
}
```

Each report item contains:

- a stable lower-snake-case `code`;
- a safe user-facing `message` describing what was found;
- a safe user-facing `action` describing the next step;
- structured `details` appropriate to that code.

Details may include a sanitized normalized path, extension, expected validation kind, candidate paths, actual values, limit values, and counts. They never include object keys, raw exception text, stack traces, credentials, or Share slugs.

The first implementation returns at most 20 blocking issues and at most 20 warning paths per warning category. It may stop scanning when continuing would violate a size boundary, consume unbounded resources, or reduce safety. `primaryIssue` is the first issue according to the deterministic validation order, not an arbitrary database or concurrency order.

Initial blocking codes include:

- `archive_too_large`
- `invalid_zip`
- `unsafe_archive_path`
- `duplicate_archive_path`
- `unsupported_file_type`
- `nested_archive`
- `unsupported_format`
- `invalid_file_content`
- `expanded_size_exceeded`
- `file_count_exceeded`
- `single_file_too_large`
- `missing_entry_file`
- `ambiguous_entry_file`

Initial warning codes include:

- `ignored_system_metadata`
- `wrapper_directory_removed`
- `entry_file_inferred`

Existing public codes are migrated deliberately. The synchronous API code `archive_too_large` remains unchanged. Worker codes that gain path or limit details map as follows when a structured report is written:

| Existing Worker code | Structured report code |
| --- | --- |
| `archive_size_exceeded` | `archive_too_large` |
| `archive_path_traversal` | `unsafe_archive_path` |
| `missing_root_index` | `missing_entry_file` or `ambiguous_entry_file` according to candidates |
| `unsupported_extension` | `unsupported_format` |
| `invalid_content` | `invalid_file_content` |
| `single_file_size_exceeded` | `single_file_too_large` |

Unlisted codes already match the structured report taxonomy. Legacy scalar failure columns remain readable during migration but are not the source of new deterministic validation copy.

## Synchronous upload rejection

Some failures occur before an Artifact or Upload session exists. In particular, the API can reject a streamed request as `archive_too_large`. These responses use the normal HTTP error envelope extended with the same structured `action` and `details` meanings as report items. They are never persisted as an Upload-session report because no product resource was created.

The API response includes `actualBytes` only when the complete observed value is known. When streaming stops immediately after crossing the boundary, it includes `limitBytes` and MAY omit `actualBytes` rather than report the partial byte count as the final archive size.

## Validation ownership across clients

The active upload-policy endpoint remains the source for configured limits and enabled formats. Client validation improves feedback but does not authorize content.

- Web preflight checks the raw ZIP size and, in a background worker, performs practical archive structure, entry, extension, and limit checks before upload.
- The future CLI removes known metadata when packaging a directory, chooses a deterministic entry, and performs practical preflight for a supplied ZIP.
- The API enforces authentication, request shape, and streamed raw archive size.
- The Worker always repeats the complete authoritative normalization and validation against the Upload session policy snapshot.

Clients consume the same stable issue codes and detail field meanings. Cross-runtime conformance fixtures cover representative archives and expected reports so Web, future CLI, and Worker behavior cannot drift silently.

## Persistence and projection

The processing attempt keeps sanitized operational exception evidence under the existing logging contract. User-facing validation reports are stored separately from exceptions so product feedback is stable and safe.

An Upload session exposes its latest validation report through Artifact management projection. Failed processing exposes `primaryIssue`, `issues`, and warnings. Successful processing may expose normalization warnings so clients can explain what ShareSlices adjusted. Replacing the file creates a new Upload session and therefore a new report; historical reports do not become the current Artifact state.

Existing scalar failure fields remain available for retryable infrastructure and reconciliation failures. A deterministic archive validation failure writes the structured report and keeps the scalar reason code aligned for state transitions and operational search. Management clients prefer the structured report when present and fall back to the scalar failure projection for legacy or non-validation failures.

## Testing

Checked fixtures cover at least:

- a normal root `index.html` archive;
- one root named HTML plus `__MACOSX/._*` metadata;
- `.DS_Store` and AppleDouble entries that are ignored only after safe-path validation;
- one wrapper directory containing one named HTML and relative assets;
- multiple root HTML candidates;
- no root HTML with nested candidates;
- metadata-only archives;
- unsafe paths resembling ignored metadata;
- each size and count limit with actual and allowed values;
- unsupported extensions and signature/content mismatches with the affected path;
- deterministic report ordering and result bounds.

API contract tests assert the structured projection. Web tests assert that the path, actual value, limit, and action are visible without exposing raw exception evidence.
