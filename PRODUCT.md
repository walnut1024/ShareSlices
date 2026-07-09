# ShareSlices product

ShareSlices turns agent-generated HTML reports, presentations, and slice decks into stable links people can share.

This document defines the product contract. Engineering choices belong in `AGENTS.md`.

## Product boundary

ShareSlices is the share layer for static web artifacts created by agents such as Claude, Codex, and similar tools.

An artifact has an HTML entry file and supporting assets such as JavaScript, CSS, images, fonts, and data files. ShareSlices turns that local static web artifact into a shareable web page.

The product starts where an agent finishes. ShareSlices takes local agent output, creates a shareable web address, and keeps that address stable as the content changes.

## Who it is for

ShareSlices is for non-programmer users who ask an agent to create a report, presentation, or keynote-style slice deck.

The agent is the primary product entry point. The expected path is that the agent calls the ShareSlices Skill, the Skill calls the command-line interface (CLI), and the user receives a link they can share.

Programmers and automation workflows can integrate directly, but product decisions prioritize non-programmer users.

## User accounts

Users sign up and sign in with email first. Product planning also includes phone, Google, and WeChat sign-in methods.

The account identity is anchored by a ShareSlices user ID. Email, phone, Google identity, and WeChat identity are authentication methods attached to that user. ShareSlices maps a proven authentication method to one user instead of creating duplicate accounts for the same person.

Email verification is a deployment policy. A deployment or future administration setting can require or skip email verification for email sign up and sign in. Phone sign in requires a verified one-time code. Google sign in uses the Google provider subject as the external identity. WeChat sign in uses `unionid` when available and otherwise falls back to the current-app `openid`.

External identity sign in should prove the provider account first, then resolve or create the ShareSlices user account through the same account resolution rules. Provider profile fields such as nickname and avatar do not prove ownership and must not merge accounts.

## Roadmap: user administration

Administrative user account management covers user search, user deactivation, user reactivation, soft deletion, forced sign out, session revocation, email verification policy, and administrative audit history.

Deactivating a user blocks future sign-in and revokes active management sessions. It does not automatically unpublish artifacts; artifact takedown is a separate product decision.

Deleting a user should start as soft deletion because artifacts and audit records can reference the user. Physical deletion requires a separate retention and export policy.

## Roadmap: enterprise organizations

Enterprise use introduces organizations as a separate scope from personal use. An organization groups users through memberships and owns organization-managed artifacts, settings, verified domains, and identity connections.

Enterprise SSO and directory provisioning map external identities to organization memberships. They do not replace the ShareSlices user ID. A person can keep one user account while belonging to personal and organization scopes.

Organization policy, private organization sharing, teams, and workspace administration are enterprise-scope product work.

## How people use ShareSlices

Share is the core user outcome. Upload and publish exist to make sharing reliable:

- **Upload**: Send a local artifact to ShareSlices
- **Publish**: Choose the version that the share link should show
- **Share**: Copy the public link and send it to other people

Upload creates history. Publish changes what viewers see. Share gives people the stable link.

The Skill and CLI handle collection and submission. The web app lets the signed-in user review their artifacts, preview versions, publish a version, and copy the share link.

## Core workflow

The main workflow starts inside an agent session:

1. The user asks an agent to create slices
2. The agent creates a local static web artifact
3. The agent calls the ShareSlices Skill
4. The Skill finds or receives the entry file, then calls the CLI
5. The CLI uploads the artifact to ShareSlices
6. ShareSlices creates a new immutable version
7. The user or agent publishes that version
8. ShareSlices returns the artifact share link

Each artifact owns one stable share link:

```text
https://view.example.com/a/{artifact_slug}/
```

The viewer opens the latest published version for that artifact.

## Artifact rules

`CONTEXT.md` owns durable glossary definitions. This section records product rules for artifact behavior.

Every upload creates a new version. A version never changes after creation.

Publishing preserves version content and updates the artifact so the share link opens the selected version.

Publishing an older version creates a new publication that points to that version. Product language calls this publishing a historical version.

## Artifact limits

Upload validation enforces product limits on archive size, expanded size, file count, and allowed file types. The limits are deployment configuration with product-defined defaults.

The default values are a product decision owned by this section. They must be recorded here before the first upload capability ships; the worker's validation thresholds have no other source.

## Artifact ownership and cleanup

Signed-in users manage only artifacts they own.

Whether an owner can unpublish an artifact, delete an artifact entirely, or prune old versions are open product decisions owned by this section. They must be decided here before any user-facing cleanup or deletion capability ships. Until then, ShareSlices exposes no user-facing deletion, and share links for published artifacts stay live.

## Public sharing model

Anyone with the artifact share link can view the latest published version. Private links, access keys, restricted sharing, allowlists, organizations, teams, and workspaces are roadmap product work.

ShareSlices exposes public web addresses at the artifact level. Signed-in users can preview and publish historical versions for artifacts they own from the management surface.

## Reliability expectations

ShareSlices must tolerate client retries, network interruption, service restarts, and background worker crashes without creating duplicate versions, exposing partial files, or moving a share link to invalid content.

Account sign up, sign in, linking, and recovery flows must tolerate repeated submissions, provider callback replay, and concurrent attempts without creating duplicate users or binding an authentication method to the wrong user.

Upload and publish requests should be idempotent when the caller repeats the same operation with the same idempotency key.

Processing can be asynchronous and at-least-once. Repeated processing attempts must either produce the same ready version or stop in a recoverable failed state.

Publishing is atomic: the share link should keep showing the previous published version until the selected version is ready and the publication pointer is updated successfully.

Partial uploads, expired sessions, abandoned staging files, and expired processing leases must be recoverable through reconciliation instead of leaving the artifact permanently stuck.
