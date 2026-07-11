# ShareSlices product

ShareSlices turns agent-generated HTML reports, presentations, and slice decks into stable links people can share.

This document defines the product contract. Engineering choices belong in `AGENTS.md`.

## Product boundary

ShareSlices is the share layer for static web artifacts created by agents such as Claude, Codex, and similar tools.

An artifact has an HTML entry file and supporting assets such as JavaScript, CSS, images, fonts, and data files. ShareSlices turns that local static web artifact into a shareable web page.

The product starts where an agent finishes. ShareSlices takes local agent output, creates a shareable web address, and keeps that address stable as the content changes.

## Supported clients

ShareSlices-owned Web UI and Viewer surfaces support desktop browsers only. Mobile browsers, tablet layouts, touch-specific interaction, and responsive mobile layouts are outside the supported product scope. ShareSlices serves uploaded artifacts as provided and does not adapt their layouts for different devices.

## Who it is for

ShareSlices is for non-programmer users who ask an agent to create a report, presentation, or keynote-style slice deck.

The agent is the primary product entry point. The expected path is that the agent calls the ShareSlices Skill, the Skill calls the command-line interface (CLI), and the user receives a link they can share.

Programmers and automation workflows can integrate directly, but product decisions prioritize non-programmer users.

## User accounts

Users sign up and sign in with email first. Product planning also includes phone, Google, and WeChat sign-in methods.

After a successful Web sign-in, ShareSlices opens the signed-in user's Artifact list without requiring a separate confirmation action.

A signed-in user can sign out of the current browser Session from the Web account menu. Sign out leaves every other Session active; signing out all Sessions remains part of later account-management work.

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

The Skill and CLI handle collection and submission. The web app lets the signed-in user review their artifacts, preview and export ready versions, publish a version, manage Share link expiration, rename or delete an Artifact, and copy the Share link.

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

Each artifact has one active share link. The link stays the same while the owner publishes, unpublishes, or republishes content:

```text
https://view.example.com/a/{share_slug}/
```

When the artifact is published, the viewer opens its current published version. When it is unpublished, the same link opens a status page instead of artifact content.

## Artifact rules

`CONTEXT.md` owns durable glossary definitions. This section records product rules for artifact behavior.

An Artifact name is trimmed and contains 1 to 120 characters. Names are mutable owner-facing labels and do not need to be unique; the Artifact ID is the stable identity.

Every upload creates a new version. A version never changes after creation.

Publishing preserves version content and updates the artifact so the share link opens the selected version.

Publishing an older version creates a new publication that points to that version. Product language calls this publishing a historical version.

## Artifact limits

Upload validation enforces product limits on archive size, expanded size, file count, and allowed file types. The limits are deployment configuration with product-defined defaults.

The default upload limits are:

- ZIP archive size: 50 MiB
- Expanded total size: 200 MiB
- Expanded regular files: 1,000
- Single expanded file: 50 MiB

The first upload capability accepts one ZIP with an unambiguous root HTML entry. It accepts document-oriented static web resources and rejects audio, video, WebAssembly, arbitrary binary attachments, nested archives, links, and special files.

ShareSlices ignores known operating-system metadata that does not belong to Artifact content. When a safe normalization leaves no root `index.html`, ShareSlices may use the only unambiguous root HTML file as the entry file. It does not guess when multiple entry candidates remain. Validation failures identify the affected file, the violated rule, relevant actual and allowed values, and a user-actionable correction whenever that information is available.

The default enabled formats are:

| Kind | Extensions | Content type | Validation |
| --- | --- | --- | --- |
| HTML | `.html` | `text/html` | UTF-8 text |
| CSS | `.css` | `text/css` | UTF-8 text |
| JavaScript | `.js`, `.mjs` | `text/javascript` | UTF-8 text |
| JSON | `.json` | `application/json` | UTF-8 JSON |
| Plain text | `.txt` | `text/plain` | UTF-8 text |
| CSV | `.csv` | `text/csv` | UTF-8 text |
| TSV | `.tsv` | `text/tab-separated-values` | UTF-8 text |
| PNG | `.png` | `image/png` | PNG signature |
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` | JPEG signature |
| GIF | `.gif` | `image/gif` | GIF signature |
| WebP | `.webp` | `image/webp` | RIFF WebP signature |
| AVIF | `.avif` | `image/avif` | ISO base media file format AVIF brand |
| SVG | `.svg` | `image/svg+xml` | UTF-8 XML with an SVG root |
| Icon | `.ico` | `image/x-icon` | ICO signature |
| WOFF | `.woff` | `font/woff` | WOFF signature |
| WOFF2 | `.woff2` | `font/woff2` | WOFF2 signature |

Internal HTML, CSS, and JavaScript references must use relative URLs. For example, an entry page at `/a/{share_slug}/` resolves `assets/app.js` to `/a/{share_slug}/assets/app.js`; root-absolute references such as `/assets/app.js` are unsupported in version 0.0.1. ShareSlices does not rewrite uploaded HTML.

Artifact build tools must therefore produce relative base paths. Existing output that already uses relative references needs no modification; output that contains root-absolute asset paths must be rebuilt or corrected before upload.

Version 0.0.1 renders accepted packaged HTML, JavaScript, CSS, images, fonts, and data files. Advanced Viewer isolation and browser-capability restrictions are future hardening work rather than release blockers for the first complete sharing flow.

## Artifact ownership and cleanup

Signed-in users manage only artifacts they own.

An owner can unpublish and republish an artifact without changing its active share link. Removing the current publication makes the active link show an unpublished status page.

An owner can permanently delete an Artifact. Deletion removes its management record, Versions, Publication, Share link, and stored raw, staging, and committed objects. Deletion is unavailable while the Artifact is accepted or processing. Version pruning without deleting the Artifact remains future work.

## Public sharing model

Anyone with an active share link can view the artifact's current published version. Private links, access keys, restricted sharing, allowlists, organizations, teams, and workspaces are roadmap product work.

Owner and Viewer are contextual roles, not separate account types. A person who follows a share link is treated as a Viewer even when the same browser is signed in as that artifact's owner. A share-link visit never implicitly reveals unpublished content; an owner starts Preview explicitly from the authenticated management surface.

Preview uses the owner's current signed-in management session to render one ready Version without changing publication state. Version 0.0.1 does not create a separate Preview session, grant, expiry, or shareable Preview link.

An artifact has at most one active Share link. The link is permanent by default. The owner can set or clear an expiration date; once that time passes, Viewer requests return the expired-link state. Link rotation and manual revocation remain future work.

Viewer HTML routes represent known link state as follows:

- An active, published link returns artifact content with `200`.
- An active, unpublished link returns a `200` status page explaining that the artifact is not currently published and provides a generic route back to ShareSlices management.
- A known expired or retired link returns a `410` status page explaining why the link is unavailable.
- An unknown link returns `404`.

Non-content status pages do not expose the artifact name, owner, or historical content and are excluded from search indexing. Signed-in owners can preview ready versions without changing publication state.

Version 0.0.1 Viewer and Preview responses are not cached so Publish and Unpublish state changes are visible immediately.

## Reliability expectations

ShareSlices must tolerate client retries, network interruption, service restarts, and background worker crashes without creating duplicate versions, exposing partial files, or moving a share link to invalid content.

Account sign up, sign in, linking, and recovery flows must tolerate repeated submissions, provider callback replay, and concurrent attempts without creating duplicate users or binding an authentication method to the wrong user.

Upload and publish requests should be idempotent when the caller repeats the same operation with the same idempotency key.

Processing can be asynchronous and at-least-once. Repeated processing attempts must either produce the same ready version or stop in a recoverable failed state.

Publishing is atomic: the share link should keep showing the previous published version until the selected version is ready and the publication pointer is updated successfully.

Partial uploads, expired sessions, abandoned staging files, and expired processing leases must be recoverable through reconciliation instead of leaving the artifact permanently stuck.
