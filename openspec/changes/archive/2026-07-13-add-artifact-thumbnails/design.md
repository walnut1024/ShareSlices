# Artifact thumbnail design

## Context

Ready Artifact cards use a generic placeholder even though ShareSlices already stores an immutable manifest and serves owner Preview content. Rendering the page live inside every card would execute untrusted HTML and JavaScript in the management UI, consume browser resources per card, and couple list performance to Artifact behavior.

## Goals / Non-Goals

**Goals:** Produce a stable visual summary for each ready Version, keep thumbnail failure independent from core content readiness, preserve private storage and owner authorization, and replace only the grid-card placeholder when an image is ready.

**Non-Goals:** Live iframe cards, thumbnails in list or detail views, a Version gallery, user-triggered regeneration, external-network rendering, full-page screenshots, custom Artifact screenshot hooks, or a new screenshot service.

## Decisions

- The thumbnail belongs to an immutable Version. An Artifact grid card selects the thumbnail for its latest ready Version, regardless of the Version selected by Publication.
- Committing a ready Version enqueues a separate thumbnail job. Thumbnail state is independent from processing job, Version, and Publication state, so pending or terminal failure leaves the Version usable.
- The Rust Worker owns thumbnail leases and starts Chromium as a bounded child process. Thumbnail concurrency is limited separately from archive processing. Chromium's namespace sandbox is disabled inside the container because the default container seccomp boundary prevents the required namespace operation; the Worker container runs as UID 10001, drops all capabilities, forbids privilege escalation, and retains RuntimeDefault seccomp.
- Chromium loads a non-public internal content route with a short-lived, single-use capture grant scoped to one Version. The grant is a service credential, not an Owner Session, and cannot access management APIs or another Version.
- The render route resolves only committed manifest paths. Chromium blocks every external network request.
- Capture uses a fixed `1440x900` viewport with reduced motion and disabled animations and transitions. It waits for `load`, `document.fonts.ready`, and two animation frames under one 10-second deadline, then writes an approximately `480x300` WebP.
- Classified transient failures receive at most three automatic retries with backoff. Deterministic failures, including render timeout, become terminal. The first version exposes no user retry action.
- The owner-authorized Version thumbnail endpoint streams the private object and may return `Cache-Control: private, max-age=31536000, immutable`. Pending, absent, and terminally failed thumbnails do not expose internal failures to the card; the Web shows its local placeholder.
- The grid preview adopts a fixed 16:10 region to prevent layout movement and unintended crop. List and detail views remain unchanged.

## Risks / Trade-offs

- **[Risk] Chromium increases Worker image size and operational complexity.** → Pin the browser version, keep the process isolated, and cap screenshot concurrency independently.
- **[Risk] Untrusted Artifact code consumes CPU or attempts network access.** → Apply a hard deadline, non-root container isolation, no capabilities or privilege escalation, RuntimeDefault seccomp, reduced motion, manifest-only routing, and outbound request blocking.
- **[Trade-off] Pages that depend on remote resources may look incomplete.** → Prefer deterministic, self-contained Version content over unstable or unsafe remote rendering.
- **[Trade-off] Disabling animation may differ from the initial interactive Preview frame.** → Favor a repeatable static summary instead of timing-dependent captures.

## Open Questions

None.
