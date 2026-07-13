---
name: shareslices
description: Publish and manage local static artifacts through the ShareSlices CLI. Use when an agent needs to share HTML, a built static site, a ZIP, or selected local files; upload a new Artifact or Version; publish or unpublish a ready Version; inspect Publication state; export an Artifact; or return a ShareSlices Share link.
---

# ShareSlices

Use the `shareslices` CLI as the only ShareSlices integration. Discover local input, invoke the CLI non-interactively, and summarize the durable result.

## Establish the CLI boundary

1. Run `command -v shareslices`.
2. If the command is missing, stop and tell the user that the ShareSlices CLI must be installed. Do not replace it with direct HTTP requests.
3. Honor a user-provided `SHARESLICES_API_URL` or `--api-url`. Otherwise, retain the CLI default.
4. Set `SHARESLICES_PROMPT_DISABLED=1` for agent-driven commands. Add `--no-progress` to transfer commands.
5. Use `shareslices <command> --help` when exact flags or output fields are uncertain. Treat installed CLI help as the current command contract.

## Prepare the input

1. Resolve every selected path inside the user's authorized workspace.
2. Prefer an existing built static output or prepared ZIP. If a build is required, follow the repository's own build instructions before invoking ShareSlices.
3. Preserve relative asset paths by choosing the correct root. Do not gather unselected sibling files.
4. Pass `--entry <path>` when the user named an entry file or the root HTML choice is ambiguous. Otherwise, let the CLI and Server validate or infer the entry.
5. Use the user's Artifact name. If none was supplied, derive a concise name from the selected file or directory and state that choice.
6. Do not publish credential files, environment files, private keys, dependency directories, or unrelated build output. If the requested selection appears to include secrets, stop and identify the risky paths.

## Choose the workflow

Use the one-step workflow unless the user explicitly wants to inspect the uploaded Version before publishing:

```bash
SHARESLICES_PROMPT_DISABLED=1 shareslices publish <paths...> \
  --name <artifact-name> \
  --no-progress
```

Add only options required by the request:

- `--root <directory>` to define relative paths across multiple selections.
- `--entry <path>` to select the entry file.
- `--duration <seconds>` or `--expires-at <RFC3339>` to set a requested Publication end.
- `--replace-link --confirm-replace-link` only when the user explicitly requests permanent Share-link replacement and understands that the previous link will stop working.

Use stepwise commands when review is required:

```bash
SHARESLICES_PROMPT_DISABLED=1 shareslices artifact upload <paths...> \
  --name <artifact-name> \
  --no-progress \
  --json artifact,version,publication

SHARESLICES_PROMPT_DISABLED=1 shareslices artifact publish <artifact-id> \
  --version <version-id> \
  --json artifactId,versionId,publicationState,expiresAt,url,copyEligible
```

Use `shareslices artifact --help` to select the implemented command for listing, uploading another Version, viewing or editing Publication state, ending a Publication early, exporting, or deleting. Supply every required identifier and flag; never depend on an interactive selector in agent-driven work.

## Handle authentication and failures

1. Run `shareslices auth status` before the first authenticated operation when authentication state is unknown.
2. If sign-in is required, run `shareslices auth login`, show the verification instructions, and wait for the user to approve the browser flow before retrying.
3. Never request, print, store, or transmit the user's email password or CLI credential.
4. If the Server requires a newer CLI, report the required upgrade and stop.
5. Treat a nonzero exit as failure. Preserve the CLI's actionable error, avoid claiming that content was published, and retry only after resolving the reported cause.
6. Do not bypass CLI or Server validation. Do not invent a Share link from an Artifact ID or slug.

## Report the result

Return only durable outcome details:

- Artifact name and identifier when available.
- Version identifier when available.
- Publication state and expiration when available.
- Exact Share link returned by the CLI when publishing succeeds.
- Any user action still required.

Do not include transient progress output, credentials, raw API responses, or unsupported lifecycle claims.
