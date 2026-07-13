# ShareSlices CLI Artifact Management

Status: ready-for-agent

## Problem Statement

ShareSlices users and agent Skills can authenticate through the CLI, but they cannot yet manage Artifacts from the terminal. Uploading still requires callers to understand Web or HTTP implementation details, and there is no stable CLI contract for packaging selected local content, waiting for a ready Version, publishing it or removing its Publication, managing the Share link, listing Artifacts, exporting a Version, or deleting an Artifact.

The command surface must remain understandable to non-programmers while also being deterministic for agents and scripts. It must preserve the product distinction between Upload, Publish, and Share; avoid implicit local-directory binding; keep the Server authoritative; and avoid compound commands that could accidentally make uploaded content externally accessible.

## Solution

Add a GitHub CLI-style `artifact` command group to the existing Rust CLI. Keep one user-facing `artifact upload` command that accepts an existing ZIP directly or packages selected non-ZIP files and directories before upload. Use `--name` to upload a new Artifact and `--artifact` to upload a new immutable Version to an existing Artifact.

Add atomic commands for list, publish, unpublish, Share-link view and edit, export, and permanent delete. Support guided selection when required input is omitted in a terminal and explicit flags for non-interactive use. Never infer a remote Artifact from the current directory. Return concise human-readable output by default and GitHub CLI-style selectable JSON fields for agents and scripts.

An Upload command is successful only after the Server commits a ready Version. Upload does not Publish. Publish does not change Share-link expiration. Share operations do not change Publication state. Export and list are read-only. Delete remains a separately confirmed destructive operation.

## User Stories

1. As a user, I want to upload a local directory as a new Artifact, so that ShareSlices can process content produced by my tools.
2. As a user, I want to upload an existing ZIP without repackaging it, so that my prepared archive remains the exact submitted package.
3. As a user, I want to upload a single standalone HTML file, so that simple self-contained output does not require manual ZIP creation.
4. As a user, I want a single-file Upload to exclude sibling files, so that unrelated or sensitive local content is not included implicitly.
5. As a user, I want to select several files and directories explicitly, so that an Artifact can contain only part of a mixed working directory.
6. As a user, I want selected inputs packaged relative to a clear root, so that their archive paths are predictable.
7. As a user, I want CLI-expanded glob patterns, so that multi-file selection behaves consistently across supported operating systems.
8. As a user, I want an unmatched glob to fail, so that a typo cannot silently produce an incomplete Artifact.
9. As a user, I want ZIP input to be the only input in its Upload, so that ZIP merging and overwrite semantics are never ambiguous.
10. As a user, I want a new Artifact name defaulted from a safe single source path, so that common uploads require less typing.
11. As a user, I want to override the default Artifact name, so that the management label matches my intent.
12. As a user, I want the CLI to prefer a root `index.html` or the only root HTML file as the Entry file, so that common packages work without extra flags.
13. As a user, I want ambiguous Entry files resolved through a terminal selector, so that the CLI never guesses between valid candidates.
14. As an agent, I want to provide the Entry file explicitly, so that Upload is deterministic without prompts.
15. As a user, I want to choose between a new Artifact and an existing Artifact during an interactive Upload, so that one Upload command covers both user intents.
16. As an agent, I want `--name` and `--artifact` to be mutually exclusive, so that the Upload target is unambiguous.
17. As an owner, I want to upload new content to an existing Artifact, so that ShareSlices creates another immutable Version without renaming or publishing it.
18. As an owner, I want the CLI to wait for a ready Version, so that a successful Upload result is immediately usable by later commands.
19. As an owner, I want a processing failure to make Upload fail with a stable reason and corrective action, so that I do not mistake Server acceptance for success.
20. As a user, I want byte progress during packaging and transfer, so that long uploads do not appear stalled.
21. As a user, I want processing represented by an activity indicator or measured Server stage, so that the CLI does not fabricate a percentage.
22. As an agent, I want `--no-progress`, so that transient progress does not consume model tokens.
23. As a user, I want transient transfer errors retried safely, so that ordinary network interruption does not force me to restart manually.
24. As an owner, I want retry to replace only the temporary ZIP of the same incomplete Upload session, so that ready Versions remain immutable.
25. As an owner, I want a completed Server processing attempt to continue after local cancellation, so that Ctrl-C does not corrupt accepted work.
26. As a user, I want cancellation to return the standard cancellation exit code, so that scripts can distinguish it from failure.
27. As an owner, I want to list my Artifacts, so that I can identify an Artifact before acting on it.
28. As an owner, I want Artifact list results ordered by recent modification and limited by default, so that output remains useful as my collection grows.
29. As an owner, I want to filter the list by Publication and processing state, so that I can find Published, Unpublished, ready, processing, or failed Artifacts.
30. As an owner, I want an interactive Artifact selector when an ID is omitted, so that I do not need to copy identifiers for terminal use.
31. As an agent, I want missing Artifact IDs to fail when prompts are unavailable or disabled, so that automation never waits for input.
32. As an owner, I want to Publish an explicitly selected ready Version, so that people with the Share link see the intended content.
33. As an owner, I want to select a ready Version interactively, so that I can Publish without memorizing its ID.
34. As an agent, I want Publish to require a Version ID in non-interactive use, so that it never assumes the latest Version.
35. As an owner, I want republishing the current Version to succeed without changing the business result, so that retries are safe.
36. As an owner, I want Publish to leave Share-link expiration unchanged, so that access timing is managed independently.
37. As an owner, I want to Unpublish an Artifact, so that people outside the Owner context can no longer access content through its Share link.
38. As an owner, I want Unpublish to preserve the Artifact, Versions, and stable Share link, so that access can be restored later.
39. As an owner, I want repeated Unpublish to have the same result, so that retries are safe.
40. As an owner, I want to view the stable Share link, Publication state, expiration, and accessibility, so that I understand what recipients can access.
41. As an owner, I want to set a future Share-link expiration, so that access ends at an explicit instant.
42. As an owner, I want to set expiration to `never`, so that the stable Share link becomes permanent again.
43. As an owner, I want Share-link edits to leave Publication unchanged, so that changing expiration cannot accidentally publish content.
44. As an owner, I want to export an explicit ready Version as a normalized ZIP, so that I can retain or move a local copy.
45. As an owner, I want Export to work for Published and Unpublished Artifacts, so that public access does not control my download rights.
46. As a user, I want Export to use a predictable default filename, so that common downloads need no output flag.
47. As a user, I want Export to refuse overwriting an existing file by default, so that local data is not lost.
48. As a user, I want `--clobber` to explicitly allow replacement, so that intentional overwrite remains possible.
49. As an owner, I want to permanently delete an Artifact only after confirmation, so that destructive actions are deliberate.
50. As an agent, I want an explicit Artifact ID and `--yes` to skip Delete confirmation, so that automation is safe and deterministic.
51. As an owner, I want `--yes` ignored when the Artifact ID is omitted, so that an interactive selection cannot be deleted without confirmation.
52. As an owner, I want Delete rejected while processing is active, so that an in-flight Artifact is not removed inconsistently.
53. As an owner, I want Delete to remove all Versions, Publication, Share link, and stored objects, so that the Artifact is permanently gone.
54. As a user, I want concise human-readable output by default, so that normal terminal use is easy to scan.
55. As an agent, I want `--json <fields>`, so that I receive only the stable fields needed for the next action.
56. As an agent, I want `--jq` and `--template`, so that I can transform selected resource output without parsing presentation text.
57. As an agent, I want progress and diagnostics on stderr, so that formatted stdout remains valid.
58. As a security-conscious user, I want credentials, Cookies, Session IDs, Share slugs, and raw Artifact content excluded from logs and formatting fields, so that CLI output does not leak secrets.
59. As a user, I want authentication-required failures to use the GitHub CLI-compatible exit code, so that scripts can direct me to sign in.
60. As an operator, I want every CLI request to carry version and operating-system compatibility metadata, so that incompatible clients stop before mutations.

## Implementation Decisions

- Extend the existing Rust CLI rather than creating another executable or runtime.
- Follow GitHub CLI conventions for resource command groups, optional interactive selection, explicit non-interactive flags, list limits, destructive confirmation, selectable JSON fields, jq and template formatting, progress on stderr, and exit codes.
- Keep the command surface atomic. Do not add a compound Upload-and-Publish or Share shortcut.
- Keep one `artifact upload` command. Input shape determines local preparation; `--name` versus `--artifact` determines whether the Server creates a new Artifact or a new Version.
- Accept zero or more local paths. No paths means the current directory. Accept files, directories, and CLI-expanded glob patterns. A single ZIP is a complete package and cannot be combined with another input.
- Package non-ZIP input deterministically into a temporary ZIP. Normalize separators, sort paths, exclude known operating-system metadata, reject links and special files, and preserve relative paths without rewriting content.
- Use a root directory to define archive-relative paths for multiple inputs. Require every selected path to remain under that root.
- Do not collect sibling files for a single-file Upload.
- Resolve common local defaults in the CLI, then send complete values to the Server. The Server remains authoritative and does not infer omitted CLI intent.
- Never bind a local directory implicitly to a remote Artifact. An omitted Artifact ID opens a selector only when prompts are available.
- Make Upload wait until a ready Version or terminal failure. Server acceptance alone is not success.
- Keep transfer percentage based on measured bytes. Use a stage indicator for Server processing unless the Server exposes measured progress.
- Enable progress by default and provide `--no-progress`. Keep all transient output on stderr.
- Preserve existing idempotency and recovery guarantees. Retry may replace temporary input only for the same incomplete Upload session; it never overwrites a ready Version.
- Keep the current browser authorization and operating-system credential-store behavior unchanged.
- Add list with Publication and processing filters plus a default limit of 30. Follow Server pagination internally until reaching the requested limit.
- Require explicit or interactively selected ready Versions for Publish and Export. Never infer the latest Version for those operations.
- Keep Publish atomic and Unpublish idempotent.
- Model Share-link reading and editing as `artifact share view` and `artifact share edit`. Use an RFC 3339 timestamp or `never` for expiration.
- Give Export a predictable Artifact-name-and-Version filename in the current directory. Refuse overwrite unless `--clobber` is present.
- Require confirmation for Delete. Skip it only when both an explicit Artifact ID and `--yes` are present.
- Support resource formatting through command-specific `--json <fields>`, `--jq`, and `--template`, not a global boolean JSON mode.
- Use standard exit codes: success 0, failure 1, cancellation 2, and authentication required 4. Add no extra code without a documented caller need.
- Extend the checked OpenAPI and YAML/Python contract whenever CLI-required Server behavior is absent. Do not let the CLI bypass Server validation or encode product lifecycle policy independently.
- Keep Artifact intake, management, Publication, Share-link, and export rules in existing application modules. Add interfaces only where a real production and test Adapter pair exists.
- Keep the official Skill outside this PRD. It will consume the completed CLI in a later change.

## Testing Decisions

- Use the complete CLI process as the primary seam. Execute the compiled binary against temporary local inputs and a fake HTTP Server, then assert externally visible stdout, stderr, exit code, generated or downloaded files, and observed HTTP requests.
- Cover command parsing, interactive selection, prompt-disabled failure, defaults, explicit overrides, mutual exclusion, progress suppression, formatted output, cancellation, and destructive confirmation at the CLI process seam.
- Cover single ZIP pass-through; single-file packaging; directory packaging; multiple selected paths; glob expansion; root-relative paths; deterministic order; ignored metadata; and rejection of traversal, links, special files, nested archives, unmatched patterns, and ZIP-plus-other-input at the CLI process seam.
- Cover new-Artifact Upload, existing-Artifact Upload, transfer retry, replacement of incomplete temporary input, wait-to-ready, processing failure, cancellation after acceptance, and immutable ready Version behavior at the CLI process seam with scripted fake Server responses.
- Cover list, Publish, Unpublish, Share view/edit, Export, and Delete through the same process seam rather than separate command-internal unit tests.
- Reuse existing fake HTTP and credential Adapters where they remain the highest practical seam for authentication-specific behavior.
- Test Server request validation, authorization, idempotency, state transitions, pagination, processing status, Publication, Share expiration, export, and deletion through existing application service tests and checked YAML/Python HTTP contracts.
- Add OpenAPI contract assertions for every new or changed response, parameter, error code, and authorization seam.
- Test only observable behavior. Do not assert private Rust module layout, helper calls, temporary implementation names, or progress-renderer internals.
- Run focused CLI, API, and contract tests during implementation; finish with the Rust workspace checks and the repository quality gate.

## Out of Scope

- A compound command that uploads, publishes, and returns a Share link in one operation.
- Automatic Publish after Upload.
- Automatic Share-link expiration changes during Publish.
- A persistent binding between a local directory and a remote Artifact.
- A general `artifact view` command.
- A separate `artifact create`, package, or Version-upload command.
- Automatic collection of files referenced by a standalone HTML file.
- Combining an existing ZIP with additional local files.
- Resumable partial-byte transfer or a user-visible idempotency key.
- Overwriting or mutating a ready Version.
- Root-absolute URL rewriting or content rewriting during packaging.
- Private Share links, access keys, allowlists, organizations, teams, or workspaces.
- AK/SK, API-key, service-account, or other unattended authentication.
- The official agent Skill implementation.
- Mobile or tablet Web changes.

## Further Notes

- `cli/README.md` is the detailed target command contract and should remain synchronized as implementation decisions change.
- `CONTEXT.md` defines Artifact, Version, Publication, Share link, Owner, Viewer, Upload, Upload session, and Idempotency key.
- The accepted CLI-interface ADR records the intentional GitHub CLI alignment and the rejection of separate create/package/Version-upload commands.
- The current CLI implements browser authentication only. Artifact commands must remain identified as target behavior until they land.
- The current Server already contains Artifact intake, management, Publication, Share expiration, export, deletion, processing, and recovery foundations, but implementation must verify each CLI-required contract rather than assuming it exists.
