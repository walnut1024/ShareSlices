---
name: shareslices
description: Publish, upload, inspect, export, or manage local static artifacts through the installed ShareSlices CLI. Use for ShareSlices Artifact, Version, Publication, Share-link, Gallery sharing, authentication, export, delete, or local static-content sharing requests. Preserve Upload-only, Share-with-link, and Share-to-Gallery intent.
---

# ShareSlices

Act as a thin intent adapter over the installed `shareslices` CLI. The CLI owns packaging,
validation, authentication mechanics, retries, and product state. Never call the ShareSlices HTTP
API, database, or object storage directly.

## Establish the machine contract

1. Check `command -v shareslices`. If it is absent, tell the user to install the ShareSlices CLI.
2. Run `shareslices --agent capabilities` before the first operation. Require Agent protocol `1`
   and the intended operation. If either is unavailable, report the install-or-upgrade action and
   stop. Do not parse human output or use selected-field JSON as a fallback.
3. Use installed `shareslices ... --help` only to discover current flags. Do not infer flags from
   this file.
4. Invoke operations with `--agent --agent-protocol 1`. Agent mode is non-interactive and returns
   one typed envelope; do not add `--json`, `--jq`, or `--template`.
5. Honor a user-provided API URL. Otherwise retain the CLI default.

## Select only the requested operation

- Upload intent means create an Artifact or Version without making it public. Choose
  `artifact.upload`; never turn it into Publish.
- Publish or share-link intent means publish. Choose the high-level local Publish operation unless
  the user explicitly asks to review the uploaded Version first.
- Share to Gallery is a distinct public-community operation. Use `artifact.gallery.view` first,
  then `artifact.gallery.share`, `artifact.gallery.update`, or `artifact.gallery.withdraw` exactly
  as requested. Ambiguous “share” wording must be resolved before choosing link or Gallery.
- For Gallery Share or Update, choose a ready Version deterministically or ask, collect the first
  public display name and optional biography without deriving either from email, present the exact
  current permission grant, and pass `--accept-permission` only after current acceptance. A missing
  current grant is unavailable, never inferred from historical evidence. Metadata-only updates may
  still require renewed acceptance.
- Require current confirmation for permanent Gallery withdrawal and for an irreversible replacement
  after reversed Administrator Removal. Permission acceptance is a separate `accept_permission`
  action and never satisfies an irreversible confirmation.
- Existing-Artifact, Publication, Export, Delete, authentication, and inspection requests map to
  their matching advertised operation. Do not widen one management request into another.

Resolve only local inputs authorized by the request. Prefer an existing build output or prepared
ZIP. Follow repository build instructions when the user also authorized a build. Preserve relative
paths, select no unrelated siblings, and never include credentials, environment files, private
keys, or dependency directories.

If one deterministic Entry or name follows from the authorized input, use it and state a mutable
name suggestion. Ask the user when there are multiple plausible Entries or targets, a misleading
name, possible secret exposure, a material content change, or any ambiguity that changes what will
be uploaded. Local repair is allowed only when the original request authorizes it and the repair
does not materially change intended content.

## Follow the envelope

Use `operation`, `outcome`, `resources`, `error`, `nextAction`, and `continuation` as the complete
execution contract. Do not branch on human-readable error messages.

- `completed`: report only confirmed durable resources.
- `in_progress`: report accepted resources and inspect state only as directed.
- `partial`: report what completed, what did not, and the exact next action. Never claim Publish
  completed merely because Upload did.
- `action_required`: tell the user exactly what they must do. The Skill may ask the user whenever
  uncertainty cannot be resolved safely from authorized evidence.
- `indeterminate`: preserve known resources and inspect durable state before any replay. Never
  blindly repeat a mutation.
- `failed` or `cancelled`: report the evidence and stop unless the declared next action is safe and
  still within the user's request.

For `authorize`, show the verification instructions, retain only the opaque continuation ID in the
working conversation, and invoke `auth login --continue` as a new Agent operation after the user
approves. Then reconstruct the original business command from current user intent and workspace
state; a continuation never stores or replays it.

Require the user's current confirmation for permanent Delete, Gallery withdrawal, Gallery replacement,
and Share-link replacement. Explicit
Publish and Unpublish need no redundant confirmation. For `install_or_upgrade`,
`resolve_ambiguity`, `confirm_irreversible`, or `contact_support`, stop and tell the user what to do.
Follow `change_local_input`, `inspect_state`, or `retry_later` only when the action is safe,
authorized, and consistent with the returned timing and resource evidence.

## Report the result

Return Artifact and Version identifiers, Publication state and expiration, exact output path, or
exact Share link only when present in the envelope. Clearly distinguish accepted processing,
partial completion, and uncertainty. Never invent a link, state, identifier, success, retry policy,
or Server behavior.
